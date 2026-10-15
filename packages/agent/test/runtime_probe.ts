import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Effect, Fiber, Stream } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Sandboxes, SandboxProvidersLive } from "../src/Sandbox.ts";
import { AgentDriver, AcpDriverLive } from "../src/AgentDriver.ts";
const project = await mkdtemp(join(tmpdir(), "threadvm-sandbox-capabilities-"));
try {
  execFileSync("git", ["init", "--initial-branch=main", project]);
  execFileSync("git", ["-C", project, "config", "user.name", "Sandbox probe"]);
  execFileSync("git", [
    "-C",
    project,
    "config",
    "user.email",
    "probe@localhost",
  ]);
  await writeFile(join(project, "README.md"), "Sandbox capability probe\n");
  execFileSync("git", ["-C", project, "add", "."]);
  execFileSync("git", ["-C", project, "commit", "-m", "Seed"]);
  const ref = {
    provider: "local" as const,
    id: "capabilities",
    projectDir: project,
    workdir: join(project, "worktree"),
    branch: "probe/capabilities",
    sessionName: `threadvm-capabilities-${process.pid}`,
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* Sandboxes;
      const sandbox = yield* registry
        .provider("local")
        .provision({ ref, baseRef: "HEAD" });
      try {
        const driver = yield* AgentDriver;
        const session = yield* driver.open({
          profile: {
            id: "fixture",
            kind: "acp",
            command: process.execPath,
            args: [resolve("scripts/acp_capability_fixture.mjs")],
          },
          sandbox,
          sessionId: "capability-session",
        });
        let updates = 0;
        const writer = yield* session.events.pipe(
          Stream.runForEach((e) =>
            Effect.sync(() => {
              if (e.type === "update") updates++;
            }),
          ),
          Effect.forkScoped,
        );
        yield* session.ready;
        assert.equal(
          updates,
          700,
          "load replay drains while the bounded stream is consumed",
        );
        yield* session.prompt("Exercise client filesystem and terminals");
        assert.equal(
          yield* sandbox.readFile("via-acp.txt"),
          "first\nsecond\nthird",
        );
        assert.equal((yield* sandbox.pty).command.file, "tmux");
        assert.match(yield* sandbox.exposePort(4321), /127.0.0.1:4321/);
        assert.equal(
          (yield* Effect.result(sandbox.readFile("../../outside")))._tag,
          "Failure",
        );
        for (const provider of ["vercel", "cloudflare"] as const)
          assert.equal(
            (yield* Effect.result(
              registry
                .provider(provider)
                .provision({ ref: { ...ref, provider }, baseRef: "HEAD" }),
            ))._tag,
            "Failure",
          );
        yield* session.endEvents;
        yield* Fiber.join(writer);
      } finally {
        yield* sandbox.destroy;
      }
    }).pipe(
      Effect.scoped,
      Effect.provide(AcpDriverLive),
      Effect.provide(SandboxProvidersLive),
      Effect.provide(NodeServices.layer),
      Effect.timeout("30 seconds"),
    ),
  );
  console.log(
    "PASS Sandbox: local provision/attach, fs line reads and writes through ACP, client terminal execution/output/release, 700-update session/load replay, path boundary, PTY, ports and explicit Vercel/Cloudflare stubs.",
  );
} finally {
  await rm(project, { recursive: true, force: true });
}
