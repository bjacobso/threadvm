import { Context, Effect, Layer, Schema } from "effect";
import { posix } from "node:path";
import {
  CreateThreadVmRequest,
  CreateThreadVmResponse,
  Port,
  ProvisioningStep,
  Project,
  ThreadVm,
  ThreadVmDevLogResponse,
  ThreadVmLifecycleResponse,
  ThreadVmMetadata,
  ThreadVmPortStatus,
  ThreadVmPortsResponse
} from "../domain/schema.js";
import type { CommandResult } from "./CommandService.js";
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

const tagify = (input: string) =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "unknown";

const shortComment = (input: string) =>
  input.replace(/\s+/g, " ").trim().slice(0, 120);

const threadVmStateTags = [
  "discovering",
  "creating",
  "bootstrapping",
  "ready",
  "running",
  "blocked",
  "stopped",
  "failed",
  "destroying",
  "unknown"
].map((state) => `threadvm-state-${state}`);

const threadVmMutableTags = [...threadVmStateTags, "threadvm-pinned"];

export class WorkspaceService extends Context.Service<
  WorkspaceService,
  {
    readonly listThreadVms: Effect.Effect<ReadonlyArray<ThreadVm>, WorkspaceError>;
    readonly getThreadVm: (id: string) => Effect.Effect<ThreadVm, WorkspaceError>;
    readonly readDevLog: (
      id: string
    ) => Effect.Effect<ThreadVmDevLogResponse, WorkspaceError>;
    readonly checkPorts: (
      id: string
    ) => Effect.Effect<ThreadVmPortsResponse, WorkspaceError>;
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

const commandErrorFromCause = (cause: unknown) => {
  const nested = cause instanceof WorkspaceError ? cause.cause : cause;
  return nested instanceof SshError ? nested.cause : nested;
};

const truncateMiddle = (input: string, maxLength = 2_000) => {
  const trimmed = input.trim();
  if (trimmed.length <= maxLength) {
    return trimmed || undefined;
  }
  const half = Math.floor((maxLength - 15) / 2);
  return `${trimmed.slice(0, half)}\n... truncated ...\n${trimmed.slice(-half)}`;
};

const commandResultExcerpt = (result: CommandResult) =>
  truncateMiddle(
    [
      result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : "",
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : ""
    ]
      .filter(Boolean)
      .join("\n\n")
  );

const provisioningOutputExcerpt = (value: unknown) => {
  if (Array.isArray(value)) {
    return truncateMiddle(
      value
        .map((entry, index) => {
          const excerpt = commandResultExcerpt(entry as CommandResult);
          return excerpt ? `command ${index + 1}:\n${excerpt}` : "";
        })
        .filter(Boolean)
        .join("\n\n")
    );
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "stdout" in value &&
    "stderr" in value
  ) {
    return commandResultExcerpt(value as CommandResult);
  }

  return undefined;
};

const provisioningFailureOutputExcerpt = (cause: unknown) => {
  const commandError = commandErrorFromCause(cause);
  if (
    commandError instanceof Object &&
    "stdout" in commandError &&
    "stderr" in commandError &&
    typeof commandError.stdout === "string" &&
    typeof commandError.stderr === "string"
  ) {
    return commandResultExcerpt({
      stdout: commandError.stdout,
      stderr: commandError.stderr,
      exitCode:
        "exitCode" in commandError && typeof commandError.exitCode === "number"
          ? commandError.exitCode
          : 1
    });
  }
  return undefined;
};

export const WorkspaceServiceLive = Layer.effect(
  WorkspaceService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const exe = yield* ExeDevService;
    const store = yield* LocalStore;
    const ssh = yield* SshService;
    const decodeMetadata = Schema.decodeUnknownEffect(ThreadVmMetadata);

    const previewPortsForProject = (threadVm: ThreadVm, project: Project) =>
      project.dev.ports.map(
        (port) =>
          new Port({
            label: `dev:${port}`,
            port,
            url: `https://${threadVm.host}:${port}`
          })
      );

    const tagsForMetadata = (metadata: ThreadVmMetadata) => [
      "threadvm",
      "threadvm-managed",
      ...(metadata.pinned ? ["threadvm-pinned"] : []),
      ...(metadata.project ? [`threadvm-project-${tagify(metadata.project)}`] : []),
      ...(metadata.slug ? [`threadvm-slug-${tagify(metadata.slug)}`] : []),
      ...(metadata.state ? [`threadvm-state-${tagify(metadata.state)}`] : []),
      ...(metadata.branch ? [`threadvm-branch-${tagify(metadata.branch)}`] : [])
    ];

    const writeExeMetadata = (threadVm: ThreadVm, metadata: ThreadVmMetadata) =>
      exe
        .untagVm(threadVm.id, threadVmMutableTags)
        .pipe(Effect.catch(() => Effect.void))
        .pipe(Effect.andThen(exe.tagVm(threadVm.id, tagsForMetadata(metadata))))
        .pipe(
          Effect.andThen(
            metadata.summary
              ? exe.commentVm(threadVm.id, shortComment(metadata.summary))
              : Effect.void
          ),
          Effect.mapError(
            toWorkspaceError(`Failed to write exe.dev metadata for ${threadVm.name}`)
          )
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
            startingPrompt: metadata.startingPrompt,
            pinned: metadata.pinned,
            repo: metadata.repo,
            branch: metadata.branch,
            ports: metadata.ports.length > 0 ? metadata.ports : threadVm.ports,
            metadataPath: metadata.metadataPath,
            devPidPath: metadata.devPidPath,
            devLogPath: metadata.devLogPath,
            lastProvisioningError: metadata.lastProvisioningError,
            provisioningSteps: metadata.provisioningSteps,
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt
          });

    const metadataFromThreadVm = (
      threadVm: ThreadVm,
      project: Project,
      slug: string,
      summary: string,
      startingPrompt: string | undefined,
      pinned: boolean | undefined,
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
        startingPrompt,
        pinned,
        repo: project.repo,
        branch,
        ports: previewPortsForProject(threadVm, project),
        metadataPath: posix.join(workspaceMetadataDir, "threadvm.json"),
        devPidPath: `/tmp/threadvm/${threadVm.id}/dev.pid`,
        devLogPath: `/tmp/threadvm/${threadVm.id}/dev.log`,
        provisioningSteps: [],
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
          startingPrompt: metadata.startingPrompt,
          pinned: metadata.pinned,
          repo: metadata.repo,
          branch: metadata.branch,
          ports: metadata.ports,
          metadataPath,
          devPidPath: metadata.devPidPath,
          devLogPath: metadata.devLogPath,
          lastProvisioningError: metadata.lastProvisioningError,
          provisioningSteps: metadata.provisioningSteps,
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

    const readRemoteMetadata = (
      threadVm: ThreadVm,
      projects: ReadonlyArray<Project>
    ): Effect.Effect<ThreadVmMetadata | undefined, never> => {
      if (threadVm.source === "mock" || projects.length === 0) {
        return Effect.succeed(undefined);
      }

      const candidatePaths = projects
        .filter(
          (project) =>
            threadVm.name === project.id ||
            threadVm.name.startsWith(`${project.id}-`)
        )
        .map((project) => posix.join(project.workdir, ".harness", "threadvm.json"));

      if (candidatePaths.length === 0) {
        return Effect.succeed(undefined);
      }
      const script = [
        "set -euo pipefail",
        "for path in \"$@\"; do",
        "  if [ -s \"$path\" ]; then",
        "    cat \"$path\"",
        "    exit 0",
        "  fi",
        "done",
        "exit 3"
      ].join("\n");

      return ssh
        .exec(
          threadVm.host,
          `bash -s -- ${candidatePaths.map(shellQuote).join(" ")} <<'THREADVM_READ_METADATA'\n${script}\nTHREADVM_READ_METADATA`,
          { timeoutMs: 30_000 }
        )
        .pipe(
          Effect.flatMap((result) =>
            Effect.try({
              try: () => JSON.parse(result.stdout) as unknown,
              catch: () => undefined
            })
          ),
          Effect.flatMap((parsed) =>
            parsed === undefined ? Effect.succeed(undefined) : decodeMetadata(parsed)
          ),
          Effect.map((metadata) =>
            metadata?.id === threadVm.id ? metadata : undefined
          ),
          Effect.catch(() => Effect.succeed(undefined))
        );
    };

    const resolveMetadata = (
      threadVm: ThreadVm,
      localMetadata: ThreadVmMetadata | undefined,
      projects: ReadonlyArray<Project>
    ) =>
      localMetadata
        ? Effect.succeed(localMetadata)
        : readRemoteMetadata(threadVm, projects).pipe(
            Effect.tap((metadata) =>
              metadata ? rememberThreadVm(metadata) : Effect.void
            )
          );

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

    const withProvisioningStep = (
      metadata: ThreadVmMetadata,
      step: ProvisioningStep
    ) => {
      const existingSteps = metadata.provisioningSteps ?? [];
      return updateMetadata(metadata, {
        provisioningSteps: [
          ...existingSteps.filter((candidate) => candidate.id !== step.id),
          step
        ]
      });
    };

    const setProvisioningStep = (
      metadata: ThreadVmMetadata,
      id: string,
      label: string,
      status: ProvisioningStep["status"],
      message?: string,
      outputExcerpt?: string
    ) => {
      const existing = (metadata.provisioningSteps ?? []).find(
        (step) => step.id === id
      );
      const now = Date.now();
      return withProvisioningStep(
        metadata,
        new ProvisioningStep({
          id,
          label,
          status,
          startedAt:
            status === "running" ? now : existing?.startedAt ?? metadata.updatedAt,
          finishedAt:
            status === "succeeded" || status === "failed" ? now : undefined,
          message,
          outputExcerpt
        })
      );
    };

    const persistProvisioningMetadata = (
      threadVm: ThreadVm,
      project: Project,
      metadata: ThreadVmMetadata
    ) =>
      rememberThreadVm(metadata).pipe(
        Effect.andThen(
          writeExeMetadata(threadVm, metadata).pipe(Effect.catch(() => Effect.void))
        ),
        Effect.andThen(
          writeRemoteMetadata(threadVm, project, metadata).pipe(
            Effect.catch(() => Effect.void)
          )
        )
      );

    const runProvisioningStep = (
      threadVm: ThreadVm,
      project: Project,
      metadata: ThreadVmMetadata,
      id: string,
      label: string,
      work: Effect.Effect<unknown, WorkspaceError>
    ) => {
      const running = setProvisioningStep(metadata, id, label, "running");
      return persistProvisioningMetadata(threadVm, project, running).pipe(
        Effect.andThen(() => work),
        Effect.andThen((result) => {
          const succeeded = setProvisioningStep(
            running,
            id,
            label,
            "succeeded",
            undefined,
            provisioningOutputExcerpt(result)
          );
          return persistProvisioningMetadata(threadVm, project, succeeded).pipe(
            Effect.as(succeeded)
          );
        }),
        Effect.catch((cause) => {
          const message = commandFailureMessage(cause);
          const failed = setProvisioningStep(
            running,
            id,
            label,
            "failed",
            message,
            provisioningFailureOutputExcerpt(cause)
          );
          return persistProvisioningMetadata(threadVm, project, failed).pipe(
            Effect.andThen(Effect.fail(cause))
          );
        })
      );
    };

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
        { concurrency: 1 }
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

        let current = yield* runProvisioningStep(
          threadVm,
          project,
          bootstrapping,
          "prepare-repo",
          "Prepare repository and branch",
          prepareRepo(threadVm, project, metadata.branch)
        );
        current = yield* runProvisioningStep(
          threadVm,
          project,
          current,
          "write-metadata",
          "Write VM metadata",
          writeRemoteMetadata(threadVm, project, current)
        );
        current = yield* runProvisioningStep(
          threadVm,
          project,
          current,
          "bootstrap",
          "Run bootstrap commands",
          runBootstrap(threadVm, project)
        );
        current = yield* runProvisioningStep(
          threadVm,
          project,
          current,
          "start-dev",
          "Start dev command",
          startDevServer(threadVm, project, current)
        );
        current = yield* runProvisioningStep(
          threadVm,
          project,
          current,
          "probe-ports",
          "Probe configured ports",
          probeConfiguredPorts(threadVm, project)
        );

        const ready = updateMetadata(current, {
          state: "ready",
          lastProvisioningError: undefined
        });
        yield* rememberThreadVm(ready);
        yield* writeRemoteMetadata(threadVm, project, ready);
        return ready;
      });

    const listThreadVms = Effect.gen(function* () {
      const [vms, metadata, projects] = yield* Effect.all(
        [
          exe.listVms.pipe(
            Effect.mapError(toWorkspaceError("Failed to list ThreadVMs"))
          ),
          store.listThreadVmMetadata.pipe(
            Effect.mapError(toWorkspaceError("Failed to load ThreadVM metadata"))
          ),
          config.listProjects.pipe(
            Effect.mapError(toWorkspaceError("Failed to load project config"))
          )
        ] as const,
        { concurrency: 2 }
      );
      const metadataById = new Map(metadata.map((entry) => [entry.id, entry]));
      return yield* Effect.forEach(
        vms,
        (threadVm) =>
          resolveMetadata(
            threadVm,
            metadataById.get(threadVm.id),
            projects
          ).pipe(
            Effect.map((resolvedMetadata) =>
              enrichThreadVm(threadVm, resolvedMetadata)
            )
          ),
        { concurrency: 4 }
      );
    });

    const getThreadVm = (id: string) =>
      Effect.gen(function* () {
        const [threadVm, metadata, projects] = yield* Effect.all(
          [
            exe.getVm(id).pipe(
              Effect.mapError(toWorkspaceError(`Failed to get ${id}`))
            ),
            store.getThreadVmMetadata(id).pipe(
              Effect.mapError(
                toWorkspaceError(`Failed to load ThreadVM metadata for ${id}`)
              )
            ),
            config.listProjects.pipe(
              Effect.mapError(toWorkspaceError("Failed to load project config"))
            )
          ] as const,
          { concurrency: 2 }
        );
        const resolvedMetadata = yield* resolveMetadata(
          threadVm,
          metadata,
          projects
        );
        return enrichThreadVm(threadVm, resolvedMetadata);
      });

    const readDevLog = (id: string) =>
      Effect.gen(function* () {
        const threadVm = yield* getThreadVm(id);
        const path = threadVm.devLogPath;
        if (!path) {
          return yield* Effect.fail(
            new WorkspaceError(`No dev log path is recorded for ${threadVm.name}`)
          );
        }

        const byteLimit = 32_000;
        const result = yield* runRemote(
          threadVm,
          [
            "set -euo pipefail",
            `path=${shellQuote(path)}`,
            `limit=${byteLimit}`,
            "if [ ! -e \"$path\" ]; then",
            "  exit 4",
            "fi",
            "size=$(wc -c < \"$path\" | tr -d ' ')",
            "if [ \"$size\" -gt \"$limit\" ]; then",
            "  echo THREADVM_LOG_TRUNCATED",
            "else",
            "  echo THREADVM_LOG_FULL",
            "fi",
            "tail -c \"$limit\" \"$path\""
          ].join("\n"),
          30_000
        );

        const markerEnd = result.stdout.indexOf("\n");
        const marker =
          markerEnd === -1 ? result.stdout.trim() : result.stdout.slice(0, markerEnd);
        const content =
          markerEnd === -1 ? "" : result.stdout.slice(markerEnd + 1);

        return new ThreadVmDevLogResponse({
          threadVmId: id,
          path,
          content,
          truncated: marker === "THREADVM_LOG_TRUNCATED",
          observedAt: Date.now()
        });
      });

    const unknownPortStatuses = (threadVm: ThreadVm, message: string) => {
      const observedAt = Date.now();
      return new ThreadVmPortsResponse({
        threadVmId: threadVm.id,
        observedAt,
        ports: threadVm.ports.map(
          (port) =>
            new ThreadVmPortStatus({
              ...port,
              status: "unknown",
              message,
              observedAt
            })
        )
      });
    };

    const checkPorts = (id: string) =>
      Effect.gen(function* () {
        const threadVm = yield* getThreadVm(id);
        const observedAt = Date.now();
        if (threadVm.ports.length === 0) {
          return new ThreadVmPortsResponse({
            threadVmId: id,
            ports: [],
            observedAt
          });
        }

        if (threadVm.source === "mock") {
          return unknownPortStatuses(threadVm, "Port probes are skipped for mock VMs");
        }

        const ports = threadVm.ports.map((port) => String(port.port)).join(" ");
        const result = yield* runRemote(
          threadVm,
          [
            "set -euo pipefail",
            `ports=${shellQuote(ports)}`,
            "for port in $ports; do",
            "  if timeout 1 bash -lc \"</dev/tcp/127.0.0.1/$port\" >/dev/null 2>&1; then",
            "    printf '%s reachable\\n' \"$port\"",
            "  else",
            "    printf '%s unreachable\\n' \"$port\"",
            "  fi",
            "done"
          ].join("\n"),
          30_000
        );

        const statusByPort = new Map(
          result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim().split(/\s+/))
            .filter(
              (parts): parts is [string, "reachable" | "unreachable"] =>
                parts.length >= 2 &&
                (parts[1] === "reachable" || parts[1] === "unreachable")
            )
            .map(([port, status]) => [Number(port), status] as const)
        );

        return new ThreadVmPortsResponse({
          threadVmId: id,
          observedAt,
          ports: threadVm.ports.map((port) => {
            const status = statusByPort.get(port.port) ?? "unknown";
            return new ThreadVmPortStatus({
              ...port,
              status,
              message:
                status === "unknown"
                  ? "No probe result was returned for this port"
                  : undefined,
              observedAt
            });
          })
        });
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
          request.startingPrompt,
          request.pinned,
          branch,
          "creating"
        );
        yield* rememberThreadVm(metadata);
        yield* writeExeMetadata(threadVm, metadata).pipe(
          Effect.catch(() => Effect.void)
        );
        const bootstrapping = updateMetadata(metadata, {
          state: "bootstrapping",
          lastProvisioningError: undefined
        });
        yield* rememberThreadVm(bootstrapping);
        yield* writeExeMetadata(threadVm, bootstrapping).pipe(
          Effect.catch(() => Effect.void)
        );
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
      readDevLog,
      checkPorts,
      createThreadVm,
      stopThreadVm,
      removeThreadVm
    } as const;
  })
);
