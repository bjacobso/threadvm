import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse
} from "effect/unstable/http";
import { Socket } from "effect/unstable/socket";
import { Effect, Fiber, Layer, Queue, Result, Schema, Stream } from "effect";
import {
  TerminalClientMessage,
  TerminalErrorMessage,
  TerminalOutputMessage,
  TerminalPongMessage,
  TerminalReadyMessage,
  TerminalSocketRequest,
  TerminalStatusMessage,
  type TerminalServerMessageModel
} from "@threadvm/shared/domain";
import {
  TerminalBridge,
  type TerminalAttachment
} from "@threadvm/shared/services/TerminalBridge";
import { WorkspaceService } from "@threadvm/shared/services/WorkspaceService";

const ThreadVmParams = Schema.Struct({
  threadVmId: Schema.String
});

const decodeSocketRequest = Schema.decodeUnknownEffect(TerminalSocketRequest);
const decodeClientMessage = Schema.decodeUnknownEffect(TerminalClientMessage);

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);

const isAllowedOrigin = (
  origin: string | undefined,
  host: string | undefined
) => {
  if (!origin) {
    return true;
  }
  try {
    const url = new URL(origin);
    return (
      url.host === host ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
};

const terminalSocketRoute = HttpRouter.add(
  "GET",
  "/rpc/terminal/:threadVmId/socket",
  Effect.gen(function* () {
    const { threadVmId } = yield* HttpRouter.schemaPathParams(ThreadVmParams);
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!isAllowedOrigin(request.headers.origin, request.headers.host)) {
      return HttpServerResponse.text("WebSocket origin is not allowed", {
        status: 403
      });
    }

    const url = new URL(request.url, "http://threadvm.local");
    const socketRequestResult = yield* Effect.result(
      decodeSocketRequest({
        threadVmId,
        cols: Number(url.searchParams.get("cols")),
        rows: Number(url.searchParams.get("rows")),
        restart:
          url.searchParams.get("restart") === "1" ||
          url.searchParams.get("restart") === "true"
      })
    );
    if (Result.isFailure(socketRequestResult)) {
      return HttpServerResponse.jsonUnsafe(
        {
          message: `Invalid terminal socket request: ${errorMessage(socketRequestResult.failure)}`
        },
        { status: 400 }
      );
    }
    const socketRequest = socketRequestResult.success;

    const socket = yield* request.upgrade;
    const writer = yield* socket.writer;
    const send = (message: TerminalServerMessageModel) =>
      writer(JSON.stringify(message));
    const close = (code: number, reason: string) =>
      writer(new Socket.CloseEvent(code, reason));

    let attachment: TerminalAttachment | undefined;
    const clientMessages = yield* Queue.bounded<string>(256);
    const handleClientMessage = (raw: string) =>
      Effect.gen(function* () {
        const parsed = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (cause) =>
            new Error(`Invalid terminal WebSocket JSON: ${errorMessage(cause)}`)
        });
        const message = yield* decodeClientMessage(parsed).pipe(
          Effect.mapError(
            (cause) => new Error(`Invalid terminal message: ${cause}`)
          )
        );

        switch (message.type) {
          case "input":
            if (!attachment) {
              return;
            }
            yield* attachment.write(message.data);
            break;
          case "resize":
            if (!attachment) {
              return;
            }
            yield* attachment.resize(message.cols, message.rows);
            yield* Effect.log("Terminal attachment resized").pipe(
              Effect.annotateLogs({
                threadVmId,
                attachmentId: attachment.id,
                cols: message.cols,
                rows: message.rows
              })
            );
            break;
          case "ping":
            yield* send(
              new TerminalPongMessage({
                type: "pong",
                timestamp: message.timestamp
              })
            );
            break;
        }
      }).pipe(
        Effect.catch((cause) =>
          send(
            new TerminalErrorMessage({
              type: "error",
              message: errorMessage(cause)
            })
          ).pipe(Effect.andThen(close(1008, "invalid-terminal-message")))
        )
      );
    const inputLoop = socket.runString((raw) => {
      if (!Queue.offerUnsafe(clientMessages, raw)) {
        return close(1013, "terminal-input-overflow");
      }
    });
    const inputFiber = yield* Effect.forkScoped(inputLoop);
    const messageLoop = Stream.runForEach(
      Stream.fromQueue(clientMessages),
      handleClientMessage
    );
    yield* Effect.forkScoped(messageLoop);

    yield* send(
      new TerminalStatusMessage({ type: "status", status: "connecting" })
    );

    const workspaces = yield* WorkspaceService;
    const bridge = yield* TerminalBridge;
    const openedResult = yield* Effect.result(
      Effect.gen(function* () {
        const vm = yield* workspaces.getThreadVm(socketRequest.threadVmId);
        return yield* bridge.open(vm, socketRequest);
      })
    );
    if (Result.isFailure(openedResult)) {
      yield* send(
        new TerminalErrorMessage({
          type: "error",
          message: errorMessage(openedResult.failure)
        })
      );
      yield* close(1011, "terminal-attach-failed");
      return HttpServerResponse.empty();
    }
    const openedAttachment = openedResult.success;
    attachment = openedAttachment;

    yield* send(
      new TerminalReadyMessage({
        type: "ready",
        attachmentId: openedAttachment.id,
        sessionName: openedAttachment.sessionName,
        createdAt: openedAttachment.createdAt,
        reused: openedAttachment.reused
      })
    );
    yield* send(
      new TerminalStatusMessage({ type: "status", status: "attached" })
    );

    const outputLoop = Stream.runForEach(openedAttachment.output, (data) =>
      send(new TerminalOutputMessage({ type: "output", data }))
    );
    yield* Effect.forkScoped(outputLoop);

    const processExit = openedAttachment.exited.pipe(
      Effect.flatMap((reason) =>
        send(
          new TerminalStatusMessage({
            type: "status",
            status: "disconnected"
          })
        ).pipe(
          Effect.andThen(
            close(
              1000,
              reason === "replaced" ? "terminal-replaced" : "terminal-exited"
            )
          )
        )
      ),
      Effect.catch((cause) =>
        send(
          new TerminalErrorMessage({
            type: "error",
            message: errorMessage(cause)
          })
        ).pipe(Effect.andThen(close(1011, "terminal-failed")))
      )
    );

    yield* Effect.raceFirst(
      Fiber.join(inputFiber).pipe(Effect.catch(() => Effect.void)),
      processExit
    );

    yield* Effect.log("Terminal attachment closed").pipe(
      Effect.annotateLogs({
        threadVmId,
        attachmentId: openedAttachment.id
      })
    );
    return HttpServerResponse.empty();
  }).pipe(
    Effect.catch((cause) =>
      Effect.gen(function* () {
        yield* Effect.logError("Terminal WebSocket failed", cause);
        return HttpServerResponse.jsonUnsafe(
          { message: errorMessage(cause) },
          { status: 500 }
        );
      })
    )
  )
);

export const TerminalRoutesLive = Layer.mergeAll(terminalSocketRoute);
