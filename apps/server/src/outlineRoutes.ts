import { Effect, Queue, Stream, Cause } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { decodeClient, encodeServer } from "@threadvm/outline-protocol";
import { OutlineRoom } from "./OutlineRoom.js";

export const OutlineRoutesLive = HttpRouter.add(
  "GET",
  "/api/outlines/:id/socket",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (
      request.headers.origin &&
      new URL(request.headers.origin).host !== request.headers.host
    )
      return HttpServerResponse.text("Origin is not allowed", { status: 403 });
    const socket = yield* request.upgrade,
      writer = yield* socket.writer;
    const room = yield* OutlineRoom;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Queue.bounded<string, Error | Cause.Done<void>>(
          256,
        );
        const release = yield* room.connect((message) => {
          if (!Queue.offerUnsafe(queue, encodeServer(message)))
            Queue.endUnsafe(queue);
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            release();
            Queue.endUnsafe(queue);
          }),
        );
        const incoming = socket.run((data) =>
          Effect.gen(function* () {
            const text =
              typeof data === "string" ? data : new TextDecoder().decode(data);
            const message = yield* Effect.try(() => decodeClient(text));
            yield* room
              .handle(message)
              .pipe(
                Effect.catch((e) =>
                  writer(
                    encodeServer({
                      _tag: "Error",
                      message: e.message,
                      ...(message._tag === "SaveDocument" && message.requestId
                        ? { requestId: message.requestId }
                        : {}),
                    }),
                  ),
                ),
              );
          }),
        );
        yield* Effect.raceFirst(
          incoming,
          Stream.fromQueue(queue).pipe(Stream.runForEach(writer)),
        );
        return HttpServerResponse.empty();
      }),
    );
  }),
);
