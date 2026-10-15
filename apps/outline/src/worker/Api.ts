// The Worker in front of every outline: static assets for the Foldkit client,
// and a WebSocket per outline routed to that outline's Durable Object.
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import OutlineRoom from "./OutlineRoom.ts";

const SOCKET_PATH = /^\/api\/outlines\/([A-Za-z0-9_-]{1,64})\/socket$/u;

export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  {
    main: import.meta.url,
    assets: {
      directory: "./dist",
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    compatibility: { date: "2026-07-01" },
  },
  Effect.gen(function* () {
    const rooms = yield* OutlineRoom;
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const pathname = new URL(request.url, "http://outline").pathname;
        if (pathname === "/api/health")
          return yield* HttpServerResponse.json({ ok: true });
        const outlineId = SOCKET_PATH.exec(pathname)?.[1];
        if (outlineId === undefined)
          return HttpServerResponse.text("Not found", { status: 404 });
        if (request.headers.upgrade !== "websocket")
          return HttpServerResponse.text("Expected a WebSocket upgrade", {
            status: 426,
          });
        return yield* rooms.getByName(outlineId).fetch(request);
      }).pipe(
        Effect.tapCause((cause) => Effect.logError("Request failed", cause)),
        Effect.catch(() =>
          Effect.succeed(
            HttpServerResponse.text("Internal error", { status: 500 }),
          ),
        ),
      ),
    };
  }),
) {}
