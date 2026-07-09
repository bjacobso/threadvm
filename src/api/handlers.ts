import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Layer } from "effect";
import { ApiError } from "../domain/schema.js";
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
    handlers.handle("list", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        return yield* config.listProjects.pipe(
          Effect.mapError(toApiError("Failed to load projects"))
        );
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
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const workspaces = yield* WorkspaceService;
          return yield* workspaces.createThreadVm(payload).pipe(
            Effect.mapError(toApiError("Failed to create ThreadVM"))
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
