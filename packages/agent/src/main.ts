import { Effect, Fiber, Queue, Schema, Stream } from "effect";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { AcpDriverLive, AgentDriver, type AgentEvent } from "./AgentDriver.ts";

const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (e) => new Error(String(e)) });
const Configuration = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  persistent: Schema.optional(Schema.Boolean),
});
const Control = Schema.Struct({
  action: Schema.Literals(["permission", "cancel", "answer", "prompt"]),
  requestId: Schema.optional(Schema.String),
  optionId: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});
const project = process.env.THREADVM_PROJECT_DIR!;
const runId = process.env.THREADVM_RUN_ID!;
const runDir = join(project, ".threadvm/runs", runId);
const program = Effect.gen(function* () {
  const config = yield* io(async () =>
    Schema.decodeUnknownSync(Configuration)(
      JSON.parse(await readFile(join(runDir, "acp.json"), "utf8")),
    ),
  );
  const driver = yield* AgentDriver;
  const session = yield* driver.open({ ...config, cwd: process.cwd() });
  const record = (event: AgentEvent) =>
    io(async () => {
      // The same capability-scoped write path that vendor agents use. It owns locking and recovery.
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          "threadvm",
          [
            "observe",
            runId,
            event.title ?? event.type,
            "--kind",
            "agent",
            "--data",
            "-",
          ],
          { maxBuffer: 8 * 1024 * 1024 },
          (error) => (error ? reject(error) : resolve()),
        );
        child.stdin?.on("error", () => {}); // A failed child is reported by execFile.
        child.stdin?.end(JSON.stringify(event));
      });
      if (event.type === "update") {
        const payload = event.payload as {
          content?: { text?: string };
          title?: string;
        };
        const text = payload.content?.text ?? payload.title;
        if (text) process.stdout.write(text);
      } else console.log(`\n[${event.type}] ${event.title ?? session.id}`);
    });
  const writer = yield* session.events.pipe(
    Stream.runForEach(record),
    Effect.forkScoped,
  );
  const prompts = yield* Queue.unbounded<string>();
  // Commands are durable files, scoped to this run; the server never owns the ACP process.
  const controls = Effect.gen(function* () {
    for (const file of (yield* io(() => readdir(join(runDir, "control"))))
      .filter((f) => f.endsWith(".json"))
      .sort()) {
      const path = join(runDir, "control", file);
      const control = yield* io(async () =>
        Schema.decodeUnknownSync(Control)(
          JSON.parse(await readFile(path, "utf8")),
        ),
      );
      if (control.action === "cancel") {
        yield* session.cancel;
        return true;
      }
      if (control.action === "prompt")
        yield* Queue.offer(prompts, control.text ?? "");
      else if (control.action === "answer")
        yield* session.answer(control.requestId!, control.text ?? "");
      else
        yield* session
          .respondToPermission(control.requestId!, control.optionId!)
          .pipe(
            Effect.catch((e) => Effect.sync(() => console.error(e.message))),
          );
      yield* io(() => unlink(path));
    }
    return false;
  });
  const watch = Effect.gen(function* () {
    while (!(yield* controls)) yield* Effect.sleep("100 millis");
    // Give the agent an opportunity to acknowledge cancellation before scoped cleanup kills it.
    yield* Effect.sleep("500 millis");
  });
  const context = yield* io(() =>
    readFile(process.env.THREADVM_CONTEXT_FILE!, "utf8"),
  );
  const turns = Effect.gen(function* () {
    yield* session.prompt(context);
    if (config.persistent)
      while (true) yield* session.prompt(yield* Queue.take(prompts));
  });
  yield* Effect.raceFirst(Effect.raceFirst(turns, watch), Fiber.join(writer));
  yield* session.endEvents;
  yield* Fiber.join(writer);
}).pipe(
  Effect.scoped,
  Effect.provide(AcpDriverLive),
  Effect.provide(NodeServices.layer),
);
NodeRuntime.runMain(program);
