import { Context, Effect, Layer } from "effect";
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

export const WorkspaceServiceLive = Layer.effect(
  WorkspaceService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const exe = yield* ExeDevService;
    const store = yield* LocalStore;

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
            project: metadata.project,
            slug: metadata.slug,
            summary: metadata.summary,
            repo: metadata.repo,
            branch: metadata.branch,
            ports: metadata.ports.length > 0 ? metadata.ports : threadVm.ports
          });

    const metadataFromThreadVm = (
      threadVm: ThreadVm,
      project: Project,
      slug: string,
      summary: string,
      branch: string
    ) => {
      const now = Date.now();
      return new ThreadVmMetadata({
        id: threadVm.id,
        project: project.id,
        slug,
        summary,
        repo: project.repo,
        branch,
        ports: previewPortsForProject(threadVm, project),
        createdAt: now,
        updatedAt: now
      });
    };

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
          branch
        );
        yield* rememberThreadVm(metadata);

        return new CreateThreadVmResponse({
          threadVm: enrichThreadVm(
            new ThreadVm({
              ...threadVm,
              state: "creating"
            }),
            metadata
          ),
          message:
            "VM create/clone was requested. Repo bootstrap, dev server startup, and optional Herdr setup are the next implementation steps."
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
