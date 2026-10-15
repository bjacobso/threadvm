import { PendingRequest } from "../domain/runtime.js";
import { Context, Effect, Layer, Schema } from "effect";
import { appendFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Run, RunEvent } from "../domain/outline.js";
import {
  ThoughtsRepo,
  OutlineError,
  outlineIO,
  atomicWrite,
} from "./ThoughtsRepo.js";

export const projectRuns = (events: ReadonlyArray<RunEvent>): Run[] => {
  const runs = new Map<string, Run>();
  for (const event of events) {
    if (event.run) runs.set(event.runId, event.run);
    const run = runs.get(event.runId);
    if (!run)
      throw new OutlineError(`Event references unknown run ${event.runId}`);
    if (event.nodeId !== run.nodeId)
      throw new OutlineError("Run event node mismatch");
    const signal = event.agent;
    let projected = run;
    if (signal?.type === "initialized")
      projected = new Run({
        ...projected,
        agentCapabilities: (signal.payload as { agentCapabilities?: unknown })
          ?.agentCapabilities,
      });
    if (signal?.type === "session")
      projected = new Run({ ...projected, acpSessionId: signal.sessionId });
    if (
      (signal?.type === "permission" || signal?.type === "question") &&
      signal.requestId
    )
      projected = new Run({
        ...projected,
        pendingRequests: [
          ...(projected.pendingRequests ?? []).filter(
            (r) => r.id !== signal.requestId,
          ),
          new PendingRequest({
            id: signal.requestId,
            kind: signal.type,
            title: signal.title ?? "Agent requests input",
            options: signal.options ?? [],
            payload: signal.payload,
            response: "live",
          }),
        ],
      });
    if (
      signal?.type === "permission_resolved" ||
      signal?.type === "question_resolved"
    )
      projected = new Run({
        ...projected,
        pendingRequests: (projected.pendingRequests ?? []).filter(
          (r) => r.id !== signal.requestId,
        ),
      });
    if (signal?.type === "cancelled")
      projected = new Run({ ...projected, pendingRequests: [] });
    runs.set(run.id, projected);
    if (event.kind === "started")
      runs.set(run.id, new Run({ ...projected, status: "running" }));
    if (event.kind === "finished" || event.kind === "failed")
      runs.set(
        run.id,
        new Run({
          ...projected,
          pendingRequests: (projected.pendingRequests ?? []).map(
            (request) =>
              new PendingRequest({
                ...request,
                response: (
                  projected.agentCapabilities as { loadSession?: boolean }
                )?.loadSession
                  ? "message"
                  : "expired",
              }),
          ),
          status:
            event.kind === "failed" ||
            (event.exitCode !== undefined && event.exitCode !== 0)
              ? "failed"
              : "finished",
          endedAt: event.time,
          exitCode: event.exitCode,
        }),
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
              (run) => run.id === event.runId,
            );
            if (
              (previous?.status === "finished" ||
                previous?.status === "failed") &&
              !(event.kind === "starting" && event.run?.status === "starting")
            ) {
              if (event.kind === "finished" || event.kind === "failed") return;
              throw new OutlineError("Run has already finished");
            }
            projectRuns([...events, event]);
            if (!text.endsWith("\n") && text.length)
              await writeFile(path, text.slice(0, text.lastIndexOf("\n") + 1));
            await appendFile(path, `${JSON.stringify(event)}\n`);
            const current = projectRuns([...events, event]).find(
              (r) => r.id === event.runId,
            )!;
            await mkdir(join(repo.dir, "runs", event.runId), {
              recursive: true,
            });
            await atomicWrite(
              join(repo.dir, "runs", event.runId, "state.json"),
              JSON.stringify(current),
            );
          }),
        ),
    };
  }),
);
