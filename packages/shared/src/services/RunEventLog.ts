import { Context, Effect, Layer, Schema } from "effect";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Run, RunEvent } from "../domain/outline.js";
import { ThoughtsRepo, OutlineError, outlineIO } from "./ThoughtsRepo.js";

export const projectRuns = (events: ReadonlyArray<RunEvent>): Run[] => {
  const runs = new Map<string, Run>();
  for (const event of events) {
    if (event.run) runs.set(event.runId, event.run);
    const run = runs.get(event.runId);
    if (!run)
      throw new OutlineError(`Event references unknown run ${event.runId}`);
    if (event.nodeId !== run.nodeId)
      throw new OutlineError("Run event node mismatch");
    if (event.kind === "started")
      runs.set(run.id, new Run({ ...run, status: "running" }));
    if (event.kind === "finished" || event.kind === "failed")
      runs.set(
        run.id,
        new Run({
          ...run,
          status:
            event.kind === "failed" ||
            (event.exitCode !== undefined && event.exitCode !== 0)
              ? "failed"
              : "finished",
          endedAt: event.time,
          exitCode: event.exitCode
        })
      );
  }
  return [...runs.values()];
};

export class RunEventLog extends Context.Service<
  RunEventLog,
  {
    readonly read: Effect.Effect<ReadonlyArray<RunEvent>, OutlineError>;
    readonly append: (event: RunEvent) => Effect.Effect<void, OutlineError>;
  }
>()("RunEventLog") {}

export const RunEventLogLive = Layer.effect(
  RunEventLog,
  Effect.gen(function* () {
    const repo = yield* ThoughtsRepo;
    const path = join(repo.dir, "events.jsonl");
    const decode = Schema.decodeUnknownSync(RunEvent);
    const parse = (text: string) => {
      const lines = text.split("\n");
      // Only a torn final append is recoverable. Corruption in a complete line fails loudly.
      lines.pop();
      return lines.filter(Boolean).map((line) => decode(JSON.parse(line)));
    };
    const read = outlineIO(async () => parse(await readFile(path, "utf8")));
    return {
      read,
      append: (input) =>
        repo.withLock(
          outlineIO(async () => {
            const event = decode(input);
            const text = await readFile(path, "utf8");
            const events = parse(text);
            if (events.some((e) => e.id === event.id)) return;
            const previous = projectRuns(events).find(
              (run) => run.id === event.runId
            );
            if (
              previous?.status === "finished" ||
              previous?.status === "failed"
            ) {
              if (event.kind === "finished" || event.kind === "failed") return;
              throw new OutlineError("Run has already finished");
            }
            projectRuns([...events, event]);
            if (!text.endsWith("\n") && text.length)
              await writeFile(path, text.slice(0, text.lastIndexOf("\n") + 1));
            await appendFile(path, `${JSON.stringify(event)}\n`);
          })
        )
    };
  })
);
