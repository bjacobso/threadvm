import { Context, Effect, Layer } from "effect";
import {
  CreateThreadVmRequest,
  CreateThreadVmResponse,
  ThreadVm,
  ThreadVmLifecycleResponse
} from "../domain/schema.js";
import { ConfigError, ConfigService } from "./ConfigService.js";
import { ExeDevError, ExeDevService } from "./ExeDevService.js";

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

    const listThreadVms = exe.listVms.pipe(
      Effect.mapError(toWorkspaceError("Failed to list ThreadVMs"))
    );

    const getThreadVm = (id: string) =>
      exe.getVm(id).pipe(Effect.mapError(toWorkspaceError(`Failed to get ${id}`)));

    const createThreadVm = (request: CreateThreadVmRequest) =>
      Effect.gen(function* () {
        const project = yield* config
          .getProject(request.project)
          .pipe(Effect.mapError(toWorkspaceError("Project lookup failed")));

        const slug = slugify(request.summary);
        const vmName = `${project.id}-${slug}`;
        const baseDevbox = request.baseDevbox ?? project.baseDevbox;
        const image = request.image ?? project.image ?? "exeuntu";

        const threadVm = yield* (baseDevbox
          ? exe.cloneVm(baseDevbox, vmName)
          : exe.createVm(vmName, image)
        ).pipe(Effect.mapError(toWorkspaceError("exe.dev VM creation failed")));

        return new CreateThreadVmResponse({
          threadVm: new ThreadVm({
            ...threadVm,
            project: project.id,
            slug,
            summary: request.summary,
            repo: project.repo,
            branch: request.branch ?? `${project.branchPrefix ?? ""}${slug}`,
            state: "creating"
          }),
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
