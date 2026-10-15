import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: process.env.SITE_URL || undefined,
  server: { port: 4321, host: true },
});
