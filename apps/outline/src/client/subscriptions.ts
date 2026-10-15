import { Effect, Option, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";

import { Message } from "./message.ts";
import type { Model } from "./model.ts";
import { RoomSocket, roomMessages, type RoomSocketService } from "./socket.ts";
import { DEVICE_THEME_QUERY } from "./theme.ts";

const TICK_MS = 100;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);

export const subscriptions = Subscription.make<Model, Message, RoomSocketService>()((entry) => ({
  deviceTheme: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () => Stream.fromEventListener<MediaQueryListEvent>(
        window.matchMedia(DEVICE_THEME_QUERY),
        "change",
      ).pipe(Stream.map(() => Message.ChangedDeviceTheme())),
    },
  ),
  room: entry(
    { online: S.Boolean },
    {
      modelToDependencies: (model) => ({ online: model.connection === "Online" }),
      dependenciesToStream: ({ online }) =>
        online
          ? Stream.unwrap(
              RoomSocket.get.pipe(
                Effect.map(roomMessages),
                Effect.catchTag("ResourceNotAvailable", () => Effect.succeed(Stream.empty)),
              ),
            )
          : Stream.empty,
    },
  ),

  countdowns: entry(
    { counting: S.Boolean },
    {
      modelToDependencies: (model) => ({ counting: Object.keys(model.countdowns).length > 0 }),
      dependenciesToStream: ({ counting }) =>
        counting
          ? Stream.tick(`${TICK_MS} millis`).pipe(
              Stream.map(() => Message.TickedCountdowns({ elapsed: TICK_MS })),
            )
          : Stream.empty,
    },
  ),

  /** ⌘J (Ctrl+J elsewhere) jumps to the next thing an agent is waiting on. */
  shortcuts: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Subscription.fromEventFilterMap<KeyboardEvent, Message>({
          target: () => document,
          type: "keydown",
          toMessage: (event) => {
            const mod = isMac ? event.metaKey : event.ctrlKey;
            if (!mod || event.altKey || event.key.toLowerCase() !== "j") return Option.none();
            event.preventDefault();
            return Option.some(Message.JumpedToAttention({ kind: "Any" }));
          },
        }),
    },
  ),
}));
