// The connection to the outline's room. The socket is a managed resource: it
// opens while the model wants a connection and closes when it does not, and
// every frame is decoded with the shared protocol before it becomes a Message.
import { Duration, Effect, Option, Queue, Schema as S, Stream } from "effect";
import { Command, ManagedResource } from "foldkit";

import { ClientMessage, ClientMessageJson, ServerMessageJson } from "../shared/protocol.ts";
import { Message } from "./message.ts";
import type { Model } from "./model.ts";

export const RoomSocket = ManagedResource.tag<WebSocket>()("RoomSocket");
export type RoomSocketService = ManagedResource.ServiceOf<typeof RoomSocket>;

const CONNECT_TIMEOUT = Duration.seconds(6);

const socketUrl = (outlineId: string): string => {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/api/outlines/${encodeURIComponent(outlineId)}/socket`;
};

export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  roomSocket: entry(S.Option(S.String), {
    resource: RoomSocket,
    modelToMaybeRequirements: (model) =>
      model.connection === "Offline" ? Option.none() : Option.some(model.outlineId),
    acquire: (outlineId) =>
      Effect.callback<WebSocket, Error>((resume) => {
        const socket = new WebSocket(socketUrl(outlineId));
        const opened = () => {
          socket.removeEventListener("error", failed);
          resume(Effect.succeed(socket));
        };
        const failed = () => {
          socket.removeEventListener("open", opened);
          resume(Effect.fail(new Error("Could not reach the outline")));
        };
        socket.addEventListener("open", opened);
        socket.addEventListener("error", failed);
        return Effect.sync(() => {
          socket.removeEventListener("open", opened);
          socket.removeEventListener("error", failed);
        });
      }).pipe(
        Effect.timeout(CONNECT_TIMEOUT),
        Effect.catchTag("TimeoutError", () => Effect.fail(new Error("Connection timed out"))),
      ),
    release: (socket) => Effect.sync(() => socket.close()),
    onAcquired: () => Message.OpenedSocket(),
    onReleased: () => Message.ReleasedSocket(),
    onAcquireError: (error) =>
      Message.FailedSocket({ error: error instanceof Error ? error.message : "Unknown error" }),
  }),
}));

const decodeServerMessage = S.decodeUnknownOption(ServerMessageJson);

/** Frames from the room, until the socket closes. */
export const roomMessages = (socket: WebSocket) =>
  Stream.callback<Message>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const received = (event: MessageEvent) => {
          const message = decodeServerMessage(event.data);
          if (Option.isSome(message))
            Queue.offerUnsafe(queue, Message.ReceivedServerMessage({ message: message.value }));
        };
        const closed = () => {
          Queue.offerUnsafe(queue, Message.ClosedSocket());
          Queue.endUnsafe(queue);
        };
        socket.addEventListener("message", received);
        socket.addEventListener("close", closed);
        return { received, closed };
      }),
      ({ received, closed }) =>
        Effect.sync(() => {
          socket.removeEventListener("message", received);
          socket.removeEventListener("close", closed);
        }),
    ).pipe(Effect.flatMap(() => Effect.never)),
  );

const encodeClientMessage = S.encodeSync(ClientMessageJson);

/** Sends in order. Messages sent while disconnected are dropped; the next snapshot reconciles. */
export const Send = Command.define("SendToRoom", {
  args: { messages: S.Array(ClientMessage) },
  messages: [Message.CompletedSend],
  execute: ({ messages }) =>
    RoomSocket.get.pipe(
      Effect.flatMap((socket) =>
        Effect.try({
          try: () => {
            for (const message of messages) socket.send(encodeClientMessage(message));
            return Message.CompletedSend({ delivered: true });
          },
          catch: () => "send failed",
        }),
      ),
      Effect.catch(() => Effect.succeed(Message.CompletedSend({ delivered: false }))),
    ),
});

/** Waits before connecting again, longer after each failure. */
export const Reconnect = Command.define("ReconnectToRoom", {
  args: { attempt: S.Number },
  messages: [Message.Reconnected],
  execute: ({ attempt }) =>
    Effect.sleep(Duration.millis(Math.min(10_000, 500 * 2 ** attempt))).pipe(
      Effect.as(Message.Reconnected()),
    ),
});
