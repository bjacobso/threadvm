import { Effect } from "effect";
import { Runtime } from "foldkit";

import { Message } from "./message.ts";
import { Flags, Model, init } from "./model.ts";
import { managedResources } from "./socket.ts";
import { subscriptions } from "./subscriptions.ts";
import { update } from "./update.ts";
import { view } from "./view/app.ts";
import { readThemePreference } from "./theme.ts";

const randomId = (length: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) =>
    "abcdefghijkmnpqrstuvwxyz23456789".charAt(byte % 32),
  ).join("");

/** Each outline lives at `/o/<id>`; the root starts a fresh one. The homepage embed has just one. */
const flags = Effect.sync((): Flags => {
  if (import.meta.env.MODE === "embed") return { outlineId: "demo", sessionId: randomId(6) };
  const match = /^\/o\/([A-Za-z0-9_-]{1,64})\/?$/u.exec(location.pathname);
  const outlineId =
    match?.[1] ??
    (document.querySelector('meta[name="threadvm-local"]')
      ? "local"
      : randomId(10));
  if (match === null) history.replaceState(null, "", `/o/${outlineId}`);
  return { outlineId, sessionId: randomId(6) };
});

const application = Runtime.makeApplication({
  Model,
  Flags,
  init: (flags: Flags) => ({ model: { ...init(flags), theme: readThemePreference() } }),
  update,
  view,
  subscriptions,
  managedResources,
  container: document.getElementById("root"),
  devTools: {
    Message,
    show: "Development",
    position: "BottomLeft",
    excludeFromHistory: ["TickedCountdowns"],
  },
});

Runtime.run(application, { flags });
