import { Context, Effect, Layer } from "effect";
import { posix } from "node:path";
import {
  CreateThreadVmRequest,
  CreateThreadVmResponse,
  Port,
  Project,
  ThreadVm,
  ThreadVmLifecycleResponse,
  ThreadVmMetadata
} from "../domain/schema.js";
import { ConfigError, ConfigService } from "./ConfigService.js";
import { ExeDevError, ExeDevService } from "./ExeDevService.js";
import { LocalStore } from "./LocalStore.js";
import { SshError, SshService } from "./SshService.js";

export class WorkspaceError {
  readonly _tag = "WorkspaceError";

  constructor(readonly message: string, readonly cause?: unknown) {}
}

const slugify = (input: string) =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "thread";

export class WorkspaceService extends Context.Service<
  WorkspaceService,
  {
    readonly listThreadVms: Effect.Effect<ReadonlyArray<ThreadVm>, WorkspaceError>;
    readonly getThreadVm: (id: string) => Effect.Effect<ThreadVm, WorkspaceError>;
    readonly createThreadVm: (
      request: CreateThreadVmRequest
    ) => Effect.Effect<CreateThreadVmResponse, WorkspaceError>;
    readonly stopThreadVm: (
      id: string
    ) => Effect.Effect<ThreadVmLifecycleResponse, WorkspaceError>;
    readonly removeThreadVm: (
      id: string
    ) => Effect.Effect<ThreadVmLifecycleResponse, WorkspaceError>;
  }
>()("WorkspaceService") {}

const toWorkspaceError = (message: string) => (cause: unknown) =>
  new WorkspaceError(message, cause);

const shellQuote = (input: string) => `'${input.replace(/'/g, `'\\''`)}'`;

const commandFailureMessage = (cause: unknown) => {
  const nested = cause instanceof WorkspaceError ? cause.cause : cause;
  const commandError = nested instanceof SshError ? nested.cause : nested;

  if (
    commandError instanceof Object &&
    "stderr" in commandError &&
    typeof commandError.stderr === "string" &&
    commandError.stderr.trim().length > 0
  ) {
    return commandError.stderr.trim();
  }

  if (nested instanceof SshError) {
    return nested.message;
  }

  if (cause instanceof WorkspaceError) {
    return cause.message;
  }

  return cause instanceof Error ? cause.message : String(cause);
};

export const WorkspaceServiceLive = Layer.effect(
  WorkspaceService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const exe = yield* ExeDevService;
    const store = yield* LocalStore;
    const ssh = yield* SshService;

    const previewPortsForProject = (threadVm: ThreadVm, project: Project) =>
      project.dev.ports.map(
        (port) =>
          new Port({
            label: `dev:${port}`,
            port,
            url: `https://${threadVm.host}:${port}`
          })
      );

    const enrichThreadVm = (
      threadVm: ThreadVm,
      metadata: ThreadVmMetadata | undefined
    ) =>
      metadata === undefined
        ? threadVm
        : new ThreadVm({
            ...threadVm,
            state:
              (threadVm.state === "running" ||
                threadVm.state === "creating" ||
                threadVm.state === "unknown") &&
              metadata.state
                ? metadata.state
                : threadVm.state,
            project: metadata.project,
            slug: metadata.slug,
            summary: metadata.summary,
            repo: metadata.repo,
            branch: metadata.branch,
            ports: metadata.ports.length > 0 ? metadata.ports : threadVm.ports,
            metadataPath: metadata.metadataPath,
            devPidPath: metadata.devPidPath,
            devLogPath: metadata.devLogPath,
            lastProvisioningError: metadata.lastProvisioningError,
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt
          });

    const metadataFromThreadVm = (
      threadVm: ThreadVm,
      project: Project,
      slug: string,
      summary: string,
      branch: string,
      state: ThreadVm["state"]
    ) => {
      const now = Date.now();
      const workspaceMetadataDir = posix.join(project.workdir, ".harness");
      return new ThreadVmMetadata({
        id: threadVm.id,
        state,
        project: project.id,
        slug,
        summary,
        repo: project.repo,
        branch,
        ports: previewPortsForProject(threadVm, project),
        metadataPath: posix.join(workspaceMetadataDir, "threadvm.json"),
        devPidPath: `/tmp/threadvm/${threadVm.id}/dev.pid`,
        devLogPath: `/tmp/threadvm/${threadVm.id}/dev.log`,
        createdAt: now,
        updatedAt: now
      });
    };

    const updateMetadata = (
      current: ThreadVmMetadata,
      patch: Partial<ThreadVmMetadata>
    ) =>
      new ThreadVmMetadata({
        ...current,
        ...patch,
        updatedAt: Date.now()
      });

    const remoteWorkdir = (project: Project, cwd: string | undefined) =>
      cwd ? posix.join(project.workdir, cwd) : project.workdir;

    const runRemote = (
      threadVm: ThreadVm,
      script: string,
      timeoutMs = 120_000
    ) =>
      ssh
        .exec(threadVm.host, script, { timeoutMs })
        .pipe(
          Effect.mapError(toWorkspaceError(`SSH command failed on ${threadVm.name}`))
        );

    const writeRemoteMetadata = (
      threadVm: ThreadVm,
      project: Project,
      metadata: ThreadVmMetadata
    ) => {
      const metadataPath =
        metadata.metadataPath ??
        posix.join(project.workdir, ".harness", "threadvm.json");
      const json = JSON.stringify(
        {
          id: metadata.id,
          state: metadata.state,
          project: metadata.project,
          slug: metadata.slug,
          summary: metadata.summary,
          repo: metadata.repo,
          branch: metadata.branch,
          ports: metadata.ports,
          devPidPath: metadata.devPidPath,
          devLogPath: metadata.devLogPath,
          lastProvisioningError: metadata.lastProvisioningError,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt
        },
        null,
        2
      );

      return runRemote(
        threadVm,
        [
          "set -euo pipefail",
          `mkdir -p ${shellQuote(posix.dirname(metadataPath))}`,
          `cat > ${shellQuote(metadataPath)} <<'THREADVM_METADATA'`,
          json,
          "THREADVM_METADATA"
        ].join("\n")
      );
    };

    const prepareRepo = (threadVm: ThreadVm, project: Project, branch: string) =>
      runRemote(
        threadVm,
        [
          "set -euo pipefail",
          `if [ ! -d ${shellQuote(posix.join(project.workdir, ".git"))} ]; then`,
          `  rm -rf ${shellQuote(project.workdir)}`,
          `  mkdir -p "$(dirname ${shellQuote(project.workdir)})"`,
          `  git clone ${shellQuote(project.repo)} ${shellQuote(project.workdir)}`,
          "fi",
          `git -C ${shellQuote(project.workdir)} fetch origin ${shellQuote(project.defaultBranch)}`,
          `if git -C ${shellQuote(project.workdir)} show-ref --verify --quiet ${shellQuote(`refs/heads/${branch}`)}; then`,
          `  git -C ${shellQuote(project.workdir)} checkout ${shellQuote(branch)}`,
          "else",
          `  git -C ${shellQuote(project.workdir)} checkout -B ${shellQuote(branch)} ${shellQuote(`origin/${project.defaultBranch}`)}`,
          "fi"
        ].join("\n"),
        300_000
      );

    const runBootstrap = (threadVm: ThreadVm, project: Project) =>
      Effect.forEach(
        project.bootstrap,
        (bootstrapCommand) =>
          runRemote(
            threadVm,
            [
              "set -euo pipefail",
              `cd ${shellQuote(project.workdir)}`,
              bootstrapCommand
            ].join("\n"),
            600_000
          ),
        { discard: true }
      );

    const startDevServer = (
      threadVm: ThreadVm,
      project: Project,
      metadata: ThreadVmMetadata
    ) => {
      const devDir = remoteWorkdir(project, project.dev.cwd);
      const pidPath = metadata.devPidPath ?? `/tmp/threadvm/${threadVm.id}/dev.pid`;
      const logPath = metadata.devLogPath ?? `/tmp/threadvm/${threadVm.id}/dev.log`;

      return runRemote(
        threadVm,
        [
          "set -euo pipefail",
          `mkdir -p ${shellQuote(posix.dirname(pidPath))}`,
          `cd ${shellQuote(devDir)}`,
          `if [ -s ${shellQuote(pidPath)} ] && kill -0 "$(cat ${shellQuote(pidPath)})" >/dev/null 2>&1; then`,
          "  exit 0",
          "fi",
          `nohup bash -lc ${shellQuote(project.dev.command)} > ${shellQuote(logPath)} 2>&1 < /dev/null &`,
          `echo $! > ${shellQuote(pidPath)}`
        ].join("\n")
      );
    };

    const probeConfiguredPorts = (threadVm: ThreadVm, project: Project) => {
      if (project.dev.ports.length === 0) {
        return Effect.void;
      }

      const ports = project.dev.ports.map(String).join(" ");
      return runRemote(
        threadVm,
        [
          "set -euo pipefail",
          `ports=${shellQuote(ports)}`,
          "deadline=$((SECONDS + 60))",
          "while [ $SECONDS -lt $deadline ]; do",
          "  missing=0",
          "  for port in $ports; do",
          "    if ! timeout 1 bash -lc \"</dev/tcp/127.0.0.1/$port\" >/dev/null 2>&1; then",
          "      missing=1",
          "      break",
          "    fi",
          "  done",
          "  if [ \"$missing\" -eq 0 ]; then",
          "    exit 0",
          "  fi",
          "  sleep 2",
          "done",
          "echo \"Configured dev ports did not become ready: $ports\" >&2",
          "exit 1"
        ].join("\n"),
        75_000
      );
    };

    const provisionThreadVm = (
      threadVm: ThreadVm,
      project: Project,
      metadata: ThreadVmMetadata
    ) =>
      Effect.gen(function* () {
        if (!metadata.branch) {
          return metadata;
        }
        const bootstrapping = updateMetadata(metadata, {
          state: "bootstrapping",
          lastProvisioningError: undefined
        });
        yield* rememberThreadVm(bootstrapping);

        yield* prepareRepo(threadVm, project, metadata.branch);
        yield* writeRemoteMetadata(threadVm, project, bootstrapping);
        yield* runBootstrap(threadVm, project);
        yield* startDevServer(threadVm, project, bootstrapping);
        yield* probeConfiguredPorts(threadVm, project);

        const ready = updateMetadata(bootstrapping, {
          state: "ready",
          lastProvisioningError: undefined
        });
        yield* rememberThreadVm(ready);
        yield* writeRemoteMetadata(threadVm, project, ready);
        return ready;
      });

    const listThreadVms = Effect.gen(function* () {
      const [vms, metadata] = yield* Effect.all(
        [
          exe.listVms.pipe(
            Effect.mapError(toWorkspaceError("Failed to list ThreadVMs"))
          ),
          store.listThreadVmMetadata.pipe(
            Effect.mapError(toWorkspaceError("Failed to load ThreadVM metadata"))
          )
        ] as const,
        { concurrency: 2 }
      );
      const metadataById = new Map(metadata.map((entry) => [entry.id, entry]));
      return vms.map((threadVm) =>
        enrichThreadVm(threadVm, metadataById.get(threadVm.id))
      );
    });

    const getThreadVm = (id: string) =>
      Effect.gen(function* () {
        const [threadVm, metadata] = yield* Effect.all(
          [
            exe.getVm(id).pipe(
              Effect.mapError(toWorkspaceError(`Failed to get ${id}`))
            ),
            store.getThreadVmMetadata(id).pipe(
              Effect.mapError(
                toWorkspaceError(`Failed to load ThreadVM metadata for ${id}`)
              )
            )
          ] as const,
          { concurrency: 2 }
        );
        return enrichThreadVm(threadVm, metadata);
      });

    const rememberThreadVm = (metadata: ThreadVmMetadata) =>
      store.upsertThreadVmMetadata(metadata).pipe(
        Effect.mapError(toWorkspaceError("Failed to write ThreadVM metadata"))
      );

    const forgetThreadVm = (id: string) =>
      store.removeThreadVmMetadata(id).pipe(
        Effect.mapError(toWorkspaceError("Failed to remove ThreadVM metadata"))
      );

    const createThreadVm = (request: CreateThreadVmRequest) =>
      Effect.gen(function* () {
        const project = yield* config
          .getProject(request.project)
          .pipe(Effect.mapError(toWorkspaceError("Project lookup failed")));

        const slug = slugify(request.summary);
        const vmName = `${project.id}-${slug}`;
        const baseDevbox = request.baseDevbox ?? project.baseDevbox;
        const image = request.image ?? project.image ?? "exeuntu";
        const branch = request.branch ?? `${project.branchPrefix ?? ""}${slug}`;

        const threadVm = yield* (baseDevbox
          ? exe.cloneVm(baseDevbox, vmName)
          : exe.createVm(vmName, image)
        ).pipe(Effect.mapError(toWorkspaceError("exe.dev VM creation failed")));

        const metadata = metadataFromThreadVm(
          threadVm,
          project,
          slug,
          request.summary,
          branch,
          "creating"
        );
        yield* rememberThreadVm(metadata);
        const bootstrapping = updateMetadata(metadata, {
          state: "bootstrapping",
          lastProvisioningError: undefined
        });
        yield* rememberThreadVm(bootstrapping);
        yield* provisionThreadVm(threadVm, project, metadata).pipe(
          Effect.catch((cause) =>
            Effect.gen(function* () {
              const failed = updateMetadata(bootstrapping, {
                state: "failed",
                lastProvisioningError: commandFailureMessage(cause)
              });
              yield* rememberThreadVm(failed);
              yield* writeRemoteMetadata(threadVm, project, failed).pipe(
                Effect.catch(() => Effect.void)
              );
            })
          ),
          Effect.forkDetach
        );

        return new CreateThreadVmResponse({
          threadVm: enrichThreadVm(
            new ThreadVm({
              ...threadVm,
              state: "bootstrapping"
            }),
            bootstrapping
          ),
          message:
            "VM was created. Repo bootstrap and dev command startup are running in the background."
        });
      });

    const stopThreadVm = (id: string) =>
      Effect.gen(function* () {
        const threadVm = yield* getThreadVm(id);
        yield* exe
          .stopVm(id)
          .pipe(Effect.mapError(toWorkspaceError(`Failed to stop ${id}`)));
        return new ThreadVmLifecycleResponse({
          threadVm: new ThreadVm({
            ...threadVm,
            state: "stopped"
          }),
          message: `Stop requested for ${threadVm.name}.`
        });
      });

    const removeThreadVm = (id: string) =>
      Effect.gen(function* () {
        const threadVm = yield* getThreadVm(id);
        yield* exe
          .removeVm(id)
          .pipe(Effect.mapError(toWorkspaceError(`Failed to remove ${id}`)));
        yield* forgetThreadVm(id);
        return new ThreadVmLifecycleResponse({
          threadVm: new ThreadVm({
            ...threadVm,
            state: "destroying"
          }),
          message: `Remove requested for ${threadVm.name}.`
        });
      });

    return {
      listThreadVms,
      getThreadVm,
      createThreadVm,
      stopThreadVm,
      removeThreadVm
    } as const;
  })
);
