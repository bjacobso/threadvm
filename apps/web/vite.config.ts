import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const webPort = Number(process.env.THREADVM_WEB_PORT ?? "5173");
const apiPort = Number(process.env.THREADVM_PORT ?? "3333");
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const apiWsOrigin = `ws://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": apiOrigin,
      "/rpc": {
        target: apiWsOrigin,
        ws: true
      }
    }
  },
  build: {
    outDir: "dist"
  }
});
