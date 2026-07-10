import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";
import { HttpMiddleware, HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ThreadVmApi } from "@threadvm/shared/api";
import { ThreadVmApiHandlersLive } from "@threadvm/shared/api/handlers";
import { CommandServiceLive } from "@threadvm/shared/services/CommandService";
import { ConfigServiceLive } from "@threadvm/shared/services/ConfigService";
import { ExeDevServiceLive } from "@threadvm/shared/services/ExeDevService";
import { TerminalBridgeLive } from "@threadvm/shared/services/TerminalBridge";
import { WorkspaceServiceLive } from "@threadvm/shared/services/WorkspaceService";
import { ReconciliationRoutesLive } from "./reconciliationRoutes.js";
import { TerminalRoutesLive } from "./terminalRoutes.js";

const port = Number(process.env.THREADVM_PORT ?? "3333");
const distClient = fileURLToPath(new URL("../../web/dist", import.meta.url));

const ApiRoutesLive = HttpApiBuilder.layer(ThreadVmApi, {
  openapiPath: "/docs/openapi.json"
}).pipe(Layer.provide(ThreadVmApiHandlersLive));

const DocsRouteLive = HttpApiScalar.layer(ThreadVmApi, {
  path: "/docs"
});

const StaticRoutesLive = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/",
    existsSync(join(distClient, "index.html"))
      ? HttpServerResponse.file(join(distClient, "index.html"))
      : HttpServerResponse.html(
          "<!doctype html><title>ThreadVM</title><body><h1>ThreadVM API</h1><p>Run <code>npm run dev</code> and open the Vite client at <code>http://127.0.0.1:5173</code>.</p><p>API docs are at <a href=\"/docs\">/docs</a>.</p></body>"
        )
  ),
  HttpRouter.add(
    "GET",
    "/assets/*",
    (request) =>
      HttpServerResponse.file(
        join(distClient, request.url.replace(/^\//, ""))
      ).pipe(
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("Not found", { status: 404 }))
        )
      )
  )
);

const ExeDevServiceComposed = ExeDevServiceLive.pipe(
  Layer.provide(CommandServiceLive)
);

const WorkspaceServiceComposed = WorkspaceServiceLive.pipe(
  Layer.provide(Layer.mergeAll(ConfigServiceLive, ExeDevServiceComposed))
);

const AppServicesLive = Layer.mergeAll(
  ConfigServiceLive,
  ExeDevServiceComposed,
  WorkspaceServiceComposed,
  TerminalBridgeLive
);

const RoutesLive = Layer.mergeAll(
  ApiRoutesLive,
  DocsRouteLive,
  ReconciliationRoutesLive,
  TerminalRoutesLive,
  StaticRoutesLive
);

HttpRouter.serve(RoutesLive, {
  middleware: HttpMiddleware.logger
}).pipe(
  Layer.provide(AppServicesLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port })),
  Layer.launch,
  NodeRuntime.runMain
);
