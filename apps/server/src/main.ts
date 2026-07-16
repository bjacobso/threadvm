import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";
import { HttpMiddleware, HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";
import { ThreadVmApi } from "@threadvm/shared/api";
import { ThreadVmApiHandlersLive } from "@threadvm/shared/api/handlers";
import { CommandServiceLive } from "@threadvm/shared/services/CommandService";
import { ConfigServiceLive } from "@threadvm/shared/services/ConfigService";
import { ExeDevServiceLive } from "@threadvm/shared/services/ExeDevService";
import { LocalStoreLive } from "@threadvm/shared/services/LocalStore";
import { RemoteTerminalSessionLive } from "@threadvm/shared/services/RemoteTerminalSession";
import { SshServiceLive } from "@threadvm/shared/services/SshService";
import { TerminalBridgeLive } from "@threadvm/shared/services/TerminalBridge";
import { WorkspaceServiceLive } from "@threadvm/shared/services/WorkspaceService";
import {
  HarnessConfigError,
  resolveHarnessConfig
} from "@threadvm/shared/config";
import { ReconciliationRoutesLive } from "./reconciliationRoutes.js";
import { TerminalRoutesLive } from "./terminalRoutes.js";

const projectDirectory = process.env.THREADVM_PROJECT_DIR ?? process.cwd();
try {
  const resolvedConfig = await resolveHarnessConfig({
    cwd: projectDirectory,
    environmentPath: process.env.HARNESS_CONFIG
  });
  if (resolvedConfig) {
    process.env.HARNESS_CONFIG = resolvedConfig.path;
    console.info(
      `Loaded Harness config from ${resolvedConfig.path} (${resolvedConfig.source})`
    );
  }
} catch (cause) {
  console.error(
    cause instanceof HarnessConfigError
      ? cause.message
      : `Failed to resolve Harness config: ${String(cause)}`
  );
  process.exit(1);
}

const port = Number(process.env.THREADVM_PORT ?? "3333");
const webPort = Number(process.env.THREADVM_WEB_PORT ?? "5173");
const distClient = fileURLToPath(new URL("../../web/dist", import.meta.url));
const indexPath = join(distClient, "index.html");
const devFallbackHtml =
  `<!doctype html><title>ThreadVM</title><body><h1>ThreadVM API</h1><p>Run <code>pnpm dev</code> and open the Vite client at <code>http://127.0.0.1:${webPort}</code>.</p><p>API docs are at <a href="/docs">/docs</a>.</p></body>`;
const reservedBrowserPrefixes = ["/api", "/rpc", "/docs", "/assets"] as const;

const notFound = HttpServerResponse.text("Not found", { status: 404 });
const notFoundEffect = Effect.succeed(notFound);

const indexResponse = () =>
  existsSync(indexPath)
    ? HttpServerResponse.file(indexPath)
    : Effect.succeed(HttpServerResponse.html(devFallbackHtml));

const requestPath = (url: string) => {
  try {
    return new URL(url, "http://threadvm.local").pathname;
  } catch {
    return "/";
  }
};

const assetResponse = (url: string) => {
  const pathname = requestPath(url);
  const staticPath = resolve(distClient, pathname.replace(/^\//, ""));
  const relativePath = relative(distClient, staticPath);
  const escaped =
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(relativePath) === relativePath;

  if (escaped) {
    return notFoundEffect;
  }

  return HttpServerResponse.file(staticPath).pipe(
    Effect.catch(() => notFoundEffect)
  );
};

const spaFallbackResponse = (url: string) => {
  const pathname = requestPath(url);
  if (
    reservedBrowserPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  ) {
    return notFoundEffect;
  }

  return indexResponse();
};

const ApiRoutesLive = HttpApiBuilder.layer(ThreadVmApi, {
  openapiPath: "/docs/openapi.json"
}).pipe(Layer.provide(ThreadVmApiHandlersLive));

const DocsRouteLive = HttpApiScalar.layer(ThreadVmApi, {
  path: "/docs"
});

const StaticRoutesLive = Layer.mergeAll(
  HttpRouter.add("GET", "/", indexResponse()),
  HttpRouter.add(
    "GET",
    "/assets/*",
    (request) => assetResponse(request.url)
  ),
  HttpRouter.add("GET", "*", (request) => spaFallbackResponse(request.url))
);

const ExeDevServiceComposed = ExeDevServiceLive.pipe(
  Layer.provide(CommandServiceLive)
);

const SshServiceComposed = SshServiceLive.pipe(Layer.provide(CommandServiceLive));

const RemoteTerminalSessionComposed = RemoteTerminalSessionLive.pipe(
  Layer.provide(SshServiceComposed)
);

const TerminalBridgeComposed = TerminalBridgeLive.pipe(
  Layer.provide(RemoteTerminalSessionComposed)
);

const WorkspaceServiceComposed = WorkspaceServiceLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      ConfigServiceLive,
      ExeDevServiceComposed,
      LocalStoreLive,
      RemoteTerminalSessionComposed,
      SshServiceComposed
    )
  )
);

const AppServicesLive = Layer.mergeAll(
  ConfigServiceLive,
  ExeDevServiceComposed,
  LocalStoreLive,
  SshServiceComposed,
  WorkspaceServiceComposed,
  RemoteTerminalSessionComposed,
  TerminalBridgeComposed
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
