import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse
} from "effect/unstable/http";
import { Effect, Layer, Schedule, Schema, Stream } from "effect";
import {
  TerminalInputRequest,
  TerminalResizeRequest
} from "../../domain/schema.js";
import { TerminalBridge } from "../../services/TerminalBridge.js";

const SessionParams = Schema.Struct({
  sessionId: Schema.String
});

const jsonError = (message: string, status = 500) =>
  HttpServerResponse.jsonUnsafe({ message }, { status });

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);

const terminalStreamRoute = HttpRouter.add(
  "GET",
  "/rpc/terminal/:sessionId/stream",
  Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.schemaPathParams(SessionParams);
    const bridge = yield* TerminalBridge;
    const stream = yield* bridge.stream(sessionId).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          Stream.make(
            new TextEncoder().encode(
              `event: error\ndata: ${JSON.stringify(errorMessage(error))}\n\n`
            )
          )
        )
      )
    );

    const heartbeat = Stream.make(
      new TextEncoder().encode(": heartbeat\n\n")
    ).pipe(Stream.repeat(Schedule.spaced("15 seconds")));

    return HttpServerResponse.stream(stream.pipe(Stream.merge(heartbeat)), {
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive"
      },
      contentType: "text/event-stream"
    });
  })
);

const terminalInputRoute = HttpRouter.add(
  "POST",
  "/rpc/terminal/:sessionId/input",
  Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.schemaPathParams(SessionParams);
    const body = yield* HttpServerRequest.schemaBodyJson(TerminalInputRequest);
    const bridge = yield* TerminalBridge;
    yield* bridge.write(sessionId, body.data).pipe(
      Effect.catch((error) =>
        Effect.fail(new Error(`terminal input failed: ${errorMessage(error)}`))
      )
    );
    return HttpServerResponse.jsonUnsafe({ ok: true });
  }).pipe(Effect.catch((error) => Effect.succeed(jsonError(String(error)))))
);

const terminalResizeRoute = HttpRouter.add(
  "POST",
  "/rpc/terminal/:sessionId/resize",
  Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.schemaPathParams(SessionParams);
    const body = yield* HttpServerRequest.schemaBodyJson(TerminalResizeRequest);
    const bridge = yield* TerminalBridge;
    yield* bridge.resize(sessionId, body.cols, body.rows).pipe(
      Effect.catch((error) =>
        Effect.fail(new Error(`terminal resize failed: ${errorMessage(error)}`))
      )
    );
    return HttpServerResponse.jsonUnsafe({ ok: true });
  }).pipe(Effect.catch((error) => Effect.succeed(jsonError(String(error)))))
);

const terminalCloseRoute = HttpRouter.add(
  "DELETE",
  "/rpc/terminal/:sessionId",
  Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.schemaPathParams(SessionParams);
    const bridge = yield* TerminalBridge;
    yield* bridge.close(sessionId).pipe(
      Effect.catch((error) =>
        Effect.fail(new Error(`terminal close failed: ${errorMessage(error)}`))
      )
    );
    return HttpServerResponse.jsonUnsafe({ ok: true });
  }).pipe(Effect.catch((error) => Effect.succeed(jsonError(String(error)))))
);

export const TerminalRoutesLive = Layer.mergeAll(
  terminalStreamRoute,
  terminalInputRoute,
  terminalResizeRoute,
  terminalCloseRoute
);
