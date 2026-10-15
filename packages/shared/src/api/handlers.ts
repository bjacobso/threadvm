import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Layer } from "effect";
import { ApiError, ProjectRegistryResponse } from "../domain/schema.js";
import { ConfigService } from "../services/ConfigService.js";
import { WorkspaceService } from "../services/WorkspaceService.js";
import { OutlineView } from "../domain/outline.js";
import { OutlineStore } from "../services/OutlineStore.js";
import { ThoughtsRepo } from "../services/ThoughtsRepo.js";
import { RunEventLog } from "../services/RunEventLog.js";
import { LocalRunSubstrate } from "../services/LocalRunSubstrate.js";
import { ThreadVmApi } from "./ThreadVmApi.js";

const toApiError = (message: string) => (cause: unknown) =>
  new ApiError({
    message,
    detail: cause instanceof Error ? cause.message : String(cause)
  });

export const ProjectsApiLive = HttpApiBuilder.group(
  ThreadVmApi,
  "projects",
  (handlers) =>
    handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const config = yield* ConfigService;
          return yield* config.listProjects.pipe(
            Effect.mapError(toApiError("Failed to load projects"))
          );
        })
      )
      .handle("save", ({ params: { id }, payload }) =>
        Effect.gen(function* () {
          const config = yield* ConfigService;
          const projects = yield* config.saveProject(id, payload).pipe(
            Effect.mapError(toApiError(`Failed to save project ${id}`))
          );
          return new ProjectRegistryResponse({
            projects,
            project: payload,
            message: `Saved project ${id}`
          });
        })
      )
      .handle("remove", ({ params: { id } }) =>
        Effect.gen(function* () {
          const config = yield* ConfigService;
          const projects = yield* config.deleteProject(id).pipe(
            Effect.mapError(toApiError(`Failed to remove project ${id}`))
          );
          return new ProjectRegistryResponse({
            projects,
            message: `Removed project ${id}`
          });
        })
      )
);

export const ThreadVmsApiLive = HttpApiBuilder.group(
  ThreadVmApi,
  "threadvms",
  (handlers) =>
    handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const workspaces = yield* WorkspaceService;
          return yield* workspaces.listThreadVms.pipe(
            Effect.mapError(toApiError("Failed to list ThreadVMs"))
          );
        })
      )
      .handle("get", ({ params: { id } }) =>
        Effect.gen(function* () {
          const workspaces = yield* WorkspaceService;
          return yield* workspaces.getThreadVm(id).pipe(
            Effect.mapError(toApiError(`Failed to load ${id}`))
          );
        })
      )
      .handle("devLog", ({ params: { id } }) =>
        Effect.gen(function* () {
          const workspaces = yield* WorkspaceService;
          return yield* workspaces.readDevLog(id).pipe(
            Effect.mapError(toApiError(`Failed to read dev log for ${id}`))
          );
        })
      )
      .handle("ports", ({ params: { id } }) =>
        Effect.gen(function* () {
          const workspaces = yield* WorkspaceService;
          return yield* workspaces.checkPorts(id).pipe(
            Effect.mapError(toApiError(`Failed to check ports for ${id}`))
          );
        })
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const workspaces = yield* WorkspaceService;
          return yield* workspaces.createThreadVm(payload).pipe(
            Effect.mapError(toApiError("Failed to create ThreadVM"))
          );
        })
      )
      .handle("stop", ({ params: { id } }) =>
        Effect.gen(function* () {
          const workspaces = yield* WorkspaceService;
          return yield* workspaces.stopThreadVm(id).pipe(
            Effect.mapError(toApiError(`Failed to stop ${id}`))
          );
        })
      )
      .handle("remove", ({ params: { id } }) =>
        Effect.gen(function* () {
          const workspaces = yield* WorkspaceService;
          return yield* workspaces.removeThreadVm(id).pipe(
            Effect.mapError(toApiError(`Failed to remove ${id}`))
          );
        })
      )
);

export const OutlineApiLive = HttpApiBuilder.group(ThreadVmApi, "outline", (handlers) => handlers
  .handle("read", () => Effect.gen(function* () {
    const store = yield* OutlineStore;
    const runs = yield* LocalRunSubstrate;
    const events = yield* RunEventLog;
    const repo = yield* ThoughtsRepo;
    return new OutlineView({ projectDir: repo.projectDir, snapshot: yield* store.read,
      runs: yield* runs.list, events: yield* events.read });
  }).pipe(Effect.mapError(toApiError("Failed to read outline; run threadvm init first"))))
  .handle("apply", ({ payload }) => Effect.gen(function* () {
    return yield* (yield* OutlineStore).apply(payload);
  }).pipe(Effect.mapError(toApiError("Failed to apply outline batch"))))
  .handle("propose", ({ payload }) => Effect.gen(function* () {
    if (payload.runId) yield* (yield* LocalRunSubstrate).authorize(payload.runId, payload.capability);
    return yield* (yield* OutlineStore).propose(payload.batch, payload.runId);
  }).pipe(Effect.mapError(toApiError("Failed to submit proposal"))))
  .handle("review", ({ payload }) => Effect.gen(function* () {
    return yield* (yield* OutlineStore).review(payload);
  }).pipe(Effect.mapError(toApiError("Failed to review proposal"))))
  .handle("run", ({ payload }) => Effect.gen(function* () {
    return yield* (yield* LocalRunSubstrate).start(payload.nodeId, payload.agent);
  }).pipe(Effect.mapError(toApiError("Failed to start local run"))))
  .handle("observe", ({ payload }) => Effect.gen(function* () {
    yield* (yield* LocalRunSubstrate).observe(payload);
  }).pipe(Effect.mapError(toApiError("Failed to record observation"))))
);

export const ThreadVmApiHandlersLive = Layer.mergeAll(
  OutlineApiLive,
  ProjectsApiLive,
  ThreadVmsApiLive
);
