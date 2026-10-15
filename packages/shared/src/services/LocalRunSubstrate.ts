import { Context, Effect, Layer, Schema } from "effect";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Run, RunEvent, Agent, ObserveRequest, OutlineId } from "../domain/outline.js";
import { ThoughtsRepo, OutlineError, outlineIO } from "./ThoughtsRepo.js";
import { OutlineStore, renderMarkdown } from "./OutlineStore.js";
import { RunEventLog, projectRuns } from "./RunEventLog.js";
import { CommandService } from "./CommandService.js";
import type { PreparedRemoteTerminalSession } from "./RemoteTerminalSession.js";

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
export class LocalRunSubstrate extends Context.Service<LocalRunSubstrate, {
  readonly start: (nodeId: string, agent: typeof Agent.Type) => Effect.Effect<Run, OutlineError>;
  readonly list: Effect.Effect<ReadonlyArray<Run>, OutlineError>;
  readonly observe: (request: ObserveRequest) => Effect.Effect<void, OutlineError>;
  readonly authorize: (runId: string, capability?: string) => Effect.Effect<Run, OutlineError>;
  readonly prepare: (runId: string) => Effect.Effect<PreparedRemoteTerminalSession, OutlineError>;
}>()("LocalRunSubstrate") {}

export const LocalRunSubstrateLive = Layer.effect(LocalRunSubstrate, Effect.gen(function* () {
  const repo = yield* ThoughtsRepo;
  const outline = yield* OutlineStore;
  const events = yield* RunEventLog;
  const commands = yield* CommandService;
  const cliPath = fileURLToPath(new URL("../../../../apps/cli/dist/main.js", import.meta.url));
  const tmux = (args: ReadonlyArray<string>) => commands.execFile("tmux", args).pipe(
    Effect.map((r) => r.stdout.trim()), Effect.mapError((e) => new OutlineError(`${e.message}: ${e.stderr}`))
  );
  const record = (run: Run, kind: RunEvent["kind"], extra: Partial<RunEvent> = {}) => events.append(new RunEvent({
    id: randomUUID(), runId: run.id, nodeId: run.nodeId, time: Date.now(), kind, ...extra
  }));
  const rawRuns = events.read.pipe(Effect.map(projectRuns));
  const authorize = (runId: string, capability?: string) => Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(OutlineId)(runId).pipe(Effect.mapError((e) => new OutlineError(String(e))));
    const run = (yield* rawRuns).find((r) => r.id === runId);
    if (!run) return yield* Effect.fail(new OutlineError("Unknown run"));
    const token = yield* outlineIO(() => readFile(join(repo.dir, "runs", runId, "capability"), "utf8"));
    if (!capability || token !== capability) return yield* Effect.fail(new OutlineError("A valid run capability is required"));
    return run;
  });
  const list = Effect.gen(function* () {
    const runs = yield* rawRuns;
    for (const run of runs) {
      if (run.status !== "running" && run.status !== "starting") continue;
      const info = yield* Effect.result(tmux(["display-message", "-p", "-t", run.sessionName, "#{pane_dead}:#{pane_dead_status}"]));
      if (info._tag === "Failure" || info.success.startsWith("1:")) {
        // A starting record may have been written by another process still preparing the worktree.
        if (run.status === "starting" && Date.now() - run.startedAt < 60_000) continue;
        const exitCode = info._tag === "Success" ? Number(info.success.split(":")[1]) : 1;
        yield* record(run, exitCode === 0 ? "finished" : "failed", { exitCode, message: "Reconciled local tmux process" });
      }
    }
    return yield* rawRuns;
  });
  return {
    list, authorize,
    start: (nodeId, agent) => Effect.gen(function* () {
      yield* Schema.decodeUnknownEffect(Agent)(agent).pipe(Effect.mapError((e) => new OutlineError(String(e))));
      const snapshot = yield* outline.read;
      const node = snapshot.nodes.find((n) => n.id === nodeId);
      if (!node) return yield* Effect.fail(new OutlineError(`Unknown node ${nodeId}`));
      yield* tmux(["-V"]);
      const id = randomUUID();
      const runDir = join(repo.dir, "runs", id);
      const codeSha = yield* repo.projectGit(["rev-parse", "HEAD"]);
      const run = new Run({ id, nodeId, agent, branch: `threadvm/${nodeId}-${id.slice(0, 8)}`,
        worktree: join(repo.dir, "worktrees", id), sessionName: `threadvm-run-${id}`,
        codeSha, status: "starting", startedAt: Date.now()
      });
      const capability = randomBytes(32).toString("hex");
      yield* outlineIO(async () => {
        await mkdir(runDir, { recursive: true, mode: 0o700 });
        await writeFile(join(runDir, "capability"), capability, { mode: 0o600 });
      });
      yield* record(run, "starting", { run });
      const start = Effect.gen(function* () {
        yield* repo.projectGit(["worktree", "add", "-b", run.branch, run.worktree, codeSha]);
        const path = [node.text];
        let parent = node.parent;
        while (parent) {
          const ancestor = snapshot.nodes.find((n) => n.id === parent)!;
          path.unshift(ancestor.text); parent = ancestor.parent;
        }
        const subtreeIds = new Set([nodeId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const n of snapshot.nodes) if (n.parent && subtreeIds.has(n.parent) && !subtreeIds.has(n.id)) { subtreeIds.add(n.id); changed = true; }
        }
        const context = `# ThreadVM run ${id}\n\nIntent: ${path.join(" / ")}\nNode: ${nodeId}\nCode: ${codeSha}\nBranch: ${run.branch}\n\n${renderMarkdown({ ...snapshot, nodes: snapshot.nodes.filter((n) => subtreeIds.has(n.id)).map((n) => n.id === nodeId ? { ...n, parent: null } : n) })}\nYou execute this intent. Outline changes require human review. Do not launch other agents.\nUse the CLI write path (capability is already in your environment):\nthreadvm outline show\nthreadvm propose <batch.json|->  # {"baseRevision":${snapshot.revision},"operations":[...]}\nthreadvm observe ${id} 'progress or findings'\nthreadvm observe ${id} '<commit SHA>' --kind commit\nHuman edits, proposal review, remote changes and delegation are unavailable to this run.\n`;
        const binDir = join(runDir, "bin");
        const runner = join(runDir, "runner.sh");
        const agentCommand = agent === "shell" ? "bash --noprofile --norc -i" :
          agent === "codex" ? `codex ${quote(context)}` : `claude ${quote(context)}`;
        yield* outlineIO(async () => {
          await mkdir(binDir, { recursive: true });
          await writeFile(join(binDir, "threadvm"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cliPath)} "$@"\n`, { mode: 0o700 });
          await writeFile(join(runDir, "context.md"), context);
          await writeFile(runner, `#!/bin/bash\nexport THREADVM_PROJECT_DIR=${quote(repo.projectDir)}\nexport THREADVM_RUN_ID=${quote(id)}\nexport THREADVM_RUN_CAPABILITY=${quote(capability)}\nexport THREADVM_CONTEXT_FILE=${quote(join(runDir, "context.md"))}\nexport PATH=${quote(binDir)}:"$PATH"\nunset THREADVM_TERMINAL_COMMAND THREADVM_TERMINAL_LOCAL_TMUX\nprintf '%s\\n' ${quote(context)}\n${agentCommand}\nresult=$?\nthreadvm observe ${quote(id)} 'Local executor exited' --kind finished --exit-code "$result"\nexit "$result"\n`, { mode: 0o700 });
        });
        yield* repo.withLock(Effect.gen(function* () {
          yield* outlineIO(async () => {
            await mkdir(join(repo.dir, "summaries"), { recursive: true });
            await writeFile(join(repo.dir, "summaries", `${id}.md`), `${context}\nWorktree: ${run.worktree}\nSession: ${run.sessionName}\nEvents: ../events.jsonl (runId ${id})\n`);
          });
          yield* repo.git(["add", "--", `summaries/${id}.md`]);
          yield* repo.git(["-c", "commit.gpgsign=false", "commit", "--no-verify", "--only", "-m", `run: delegate ${nodeId} (${id})`, "--", `summaries/${id}.md`]);
        }));
        yield* tmux(["new-session", "-d", "-s", run.sessionName, "-c", run.worktree]);
        yield* tmux(["set-option", "-t", run.sessionName, "remain-on-exit", "on"]);
        yield* record(run, "started");
        yield* tmux(["respawn-pane", "-k", "-t", run.sessionName, `bash ${quote(runner)}`]);
        return new Run({ ...run, status: "running" });
      });
      return yield* start.pipe(Effect.catch((error) => record(run, "failed", { message: error.message, exitCode: 1 }).pipe(Effect.andThen(Effect.fail(error)))));
    }),
    observe: (request) => Effect.gen(function* () {
      const run = yield* authorize(request.runId, request.capability);
      if (run.status === "finished" || run.status === "failed") return yield* Effect.fail(new OutlineError("Run has already finished"));
      yield* record(run, request.kind, { message: request.message, codeSha: request.codeSha, exitCode: request.exitCode });
    }),
    prepare: (runId) => Effect.gen(function* () {
      const run = (yield* list).find((r) => r.id === runId);
      if (!run) return yield* Effect.fail(new OutlineError("Unknown run"));
      yield* tmux(["has-session", "-t", run.sessionName]);
      return { sessionName: run.sessionName, reused: true,
        command: { file: "tmux", args: ["attach-session", "-t", run.sessionName] }
      };
    })
  };
}));
