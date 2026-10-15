import { foldkit } from "@foldkit/vite-plugin";
import { foldworksLayers } from "@foldworks/ui/vite";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";

// `alchemy dev` serves the Worker and its Durable Objects on 1337; Vite proxies
// the outline sockets to it so the client keeps same-origin URLs.
const local = process.env.THREADVM_LOCAL === "1";
const worker = local
  ? `http://127.0.0.1:${process.env.THREADVM_PORT ?? "3333"}`
  : (process.env.OUTLINE_WORKER_URL ?? "http://localhost:1337");

export default defineConfig(({ mode }) => ({
  plugins: [
    {
      name: "threadvm-backend",
      transformIndexHtml: (html) =>
        local
          ? html.replace(
              "<head>",
              '<head><meta name="threadvm-local" content="true">',
            )
          : html,
    },
    stylex.vite({
      dev: mode === "development",
      runtimeInjection: false,
      useCSSLayers: { before: foldworksLayers },
    }),
    foldkit(),
  ],
  server: {
    port: Number(
      local
        ? (process.env.THREADVM_WEB_PORT ?? 5173)
        : (process.env.OUTLINE_PORT ?? 5180),
    ),
    proxy: {
      "/api": { target: worker, ws: true },
      "/rpc": { target: worker, ws: true },
      "/terminal": { target: worker },
      "/inventory": { target: worker },
      ...(local ? { "/assets": { target: worker } } : {}),
    },
  },
  optimizeDeps: {
    entries: ["src/client/entry.ts"],
    exclude: [
      "@foldkit/ui",
      "@foldworks/agent",
      "@foldworks/outliner",
      "@foldworks/text-intelligence",
      "@foldworks/ui",
      "effect",
      "foldkit",
    ],
  },
}));
