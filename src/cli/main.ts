#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0] ?? "web";

if (command !== "web" && command !== "dev") {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: threadvm web");
  process.exit(1);
}

await import("../app/server/main.js");
