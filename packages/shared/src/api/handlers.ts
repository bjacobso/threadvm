import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Layer } from "effect";
import { ApiError, ProjectRegistryResponse } from "../domain/schema.js";
import { ConfigService } from "../services/ConfigService.js";
import { TerminalBridge } from "../services/TerminalBridge.js";
import { WorkspaceService } from "../services/WorkspaceService.js";
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

export const TerminalApiLive = HttpApiBuilder.group(
  ThreadVmApi,
  "terminal",
  (handlers) =>
    handlers.handle("attach", ({ payload }) =>
      Effect.gen(function* () {
        const workspaces = yield* WorkspaceService;
        const bridge = yield* TerminalBridge;
        const vm = yield* workspaces.getThreadVm(payload.threadVmId).pipe(
          Effect.mapError(toApiError(`Failed to load ${payload.threadVmId}`))
        );
        return yield* bridge
          .attach(vm, { restart: payload.restart })
          .pipe(Effect.mapError(toApiError("Failed to attach terminal")));
      })
    )
);

export const ThreadVmApiHandlersLive = Layer.mergeAll(
  ProjectsApiLive,
  ThreadVmsApiLive,
  TerminalApiLive
);
