import { foldkit } from "@foldkit/vite-plugin";
import { foldworksLayers } from "@foldworks/ui/vite";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";

// `alchemy dev` serves the Worker and its Durable Objects on 1337; Vite proxies
// the outline sockets to it so the client keeps same-origin URLs.
const worker = process.env.OUTLINE_WORKER_URL ?? "http://localhost:1337";

export default defineConfig(({ mode }) => ({
  plugins: [
    stylex.vite({
      dev: mode === "development",
      runtimeInjection: false,
      useCSSLayers: { before: foldworksLayers },
    }),
    foldkit(),
  ],
  server: {
    port: Number(process.env.OUTLINE_PORT ?? 5180),
    proxy: { "/api": { target: worker, ws: true } },
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
