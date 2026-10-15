import { Context, Effect, Layer, Schema } from "effect";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Run,
  RunControlRequest,
  AcpConfiguration,
  RunEvent,
  Agent,
  ObserveRequest,
  OutlineId,
} from "../domain/outline.js";
import {
  ThoughtsRepo,
  OutlineError,
  outlineIO,
  atomicWrite,
} from "./ThoughtsRepo.js";
import { OutlineStore, renderMarkdown } from "./OutlineStore.js";
import { RunEventLog, projectRuns } from "./RunEventLog.js";
import { CommandService } from "./CommandService.js";
import type { PreparedRemoteTerminalSession } from "./RemoteTerminalSession.js";

export interface StartOptions {
  readonly acp?: AcpConfiguration;
  readonly threadId?: string;
  readonly executor?: string;
  readonly parentThreadId?: string | null;
  readonly instruction?: string;
  readonly persistent?: boolean;
}
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
export class LocalRunSubstrate extends Context.Service<
  LocalRunSubstrate,
  {
    readonly start: (
      nodeId: string,
      agent: typeof Agent.Type,
      options?: StartOptions,
    ) => Effect.Effect<Run, OutlineError>;
    readonly control: (
      request: RunControlRequest,
    ) => Effect.Effect<void, OutlineError>;
    readonly list: Effect.Effect<ReadonlyArray<Run>, OutlineError>;
    readonly observe: (
      request: ObserveRequest,
    ) => Effect.Effect<void, OutlineError>;
    readonly authorize: (
      runId: string,
      capability?: string,
    ) => Effect.Effect<Run, OutlineError>;
    readonly prepare: (
      runId: string,
    ) => Effect.Effect<PreparedRemoteTerminalSession, OutlineError>;
  }
>()("LocalRunSubstrate") {}

export const LocalRunSubstrateLive = Layer.effect(
  LocalRunSubstrate,
  Effect.gen(function* () {
    const repo = yield* ThoughtsRepo;
    const outline = yield* OutlineStore;
    const events = yield* RunEventLog;
    const commands = yield* CommandService;
    const cliPath = fileURLToPath(
      new URL("../../../../apps/cli/dist/main.js", import.meta.url),
    );
    const tmux = (args: ReadonlyArray<string>) =>
      commands.execFile("tmux", args).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.mapError((e) => new OutlineError(`${e.message}: ${e.stderr}`)),
      );
    const summarize = (
      run: Run,
      kind: "finished" | "failed",
      exitCode?: number,
    ) =>
      repo.withLock(
        Effect.gen(function* () {
          const summaryPath = `summaries/${run.id}.md`;
          const committed = yield* Effect.result(
            repo.git(["show", `HEAD:${summaryPath}`]),
          );
          const previous =
            committed._tag === "Success"
              ? committed.success
              : `# ThreadVM run ${run.id}\n\nNode: ${run.nodeId}\nBranch: ${run.branch}\nCode: ${run.codeSha}\n`;
          if (previous.includes("\n## Result\n")) return;
          const head = yield* commands
            .execFile("git", ["rev-parse", "HEAD"], { cwd: run.worktree })
            .pipe(
              Effect.map((r) => r.stdout.trim()),
              Effect.catch(() => Effect.succeed(run.codeSha)),
            );
          yield* outlineIO(async () => {
            await mkdir(join(repo.dir, "summaries"), { recursive: true });
            await writeFile(
              join(repo.dir, summaryPath),
              `${previous}\n\n## Result\n\nStatus: ${kind === "failed" || (exitCode ?? 0) !== 0 ? "failed" : "finished"}\nExit code: ${exitCode ?? "unknown"}\nCode HEAD: ${head}\nExecution history: events.jsonl, runId ${run.id} (local, excluded from Git)\n`,
            );
          });
          yield* repo.git(["add", "--", summaryPath]);
          yield* repo.git([
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--no-verify",
            "--only",
            "-m",
            `run: summarize ${run.id}`,
            "--",
            summaryPath,
          ]);
        }),
      );
    const record = (
      run: Run,
      kind: RunEvent["kind"],
      extra: Partial<RunEvent> = {},
    ) =>
      Effect.gen(function* () {
        yield* events.append(
          new RunEvent({
            id: randomUUID(),
            runId: run.id,
            nodeId: run.nodeId,
            time: Date.now(),
            kind,
            ...extra,
          }),
        );
        if (kind === "finished" || kind === "failed")
          yield* summarize(run, kind, extra.exitCode);
      });
    const rawRuns = events.read.pipe(Effect.map(projectRuns));
    const authorize = (runId: string, capability?: string) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(OutlineId)(runId).pipe(
          Effect.mapError((e) => new OutlineError(String(e))),
        );
        const run = (yield* rawRuns).find((r) => r.id === runId);
        if (!run) return yield* Effect.fail(new OutlineError("Unknown run"));
        const token = yield* outlineIO(() =>
          readFile(join(repo.dir, "runs", runId, "capability"), "utf8"),
        );
        if (!capability || token !== capability)
          return yield* Effect.fail(
            new OutlineError("A valid run capability is required"),
          );
        return run;
      });
    const list = Effect.gen(function* () {
      const runs = yield* rawRuns;
      for (const run of runs) {
        if (run.status === "finished" || run.status === "failed") {
          // Repair a crash between the durable finish event and its thought summary.
          yield* summarize(run, run.status, run.exitCode);
          continue;
        }
        const info = yield* Effect.result(
          tmux([
            "display-message",
            "-p",
            "-t",
            run.sessionName,
            "#{pane_dead}:#{pane_dead_status}",
          ]),
        );
        if (run.status === "starting" && Date.now() - run.startedAt >= 60_000) {
          yield* record(run, "failed", {
            exitCode: 1,
            message: "Local run startup was interrupted",
          });
          continue;
        }
        if (info._tag === "Failure" || info.success.startsWith("1:")) {
          // A starting record may have been written by another process still preparing the worktree.
          if (run.status === "starting" && Date.now() - run.startedAt < 60_000)
            continue;
          const exitCode =
            info._tag === "Success" ? Number(info.success.split(":")[1]) : 1;
          yield* record(run, exitCode === 0 ? "finished" : "failed", {
            exitCode,
            message: "Reconciled local tmux process",
          });
        }
      }
      return yield* rawRuns;
    });
    return {
      list,
      authorize,
      control: (request) =>
        repo.withLock(
          Effect.gen(function* () {
            const run = (yield* rawRuns).find((r) => r.id === request.runId);
            if (!run || run.status !== "running")
              return yield* Effect.fail(
                new OutlineError("Control requires a running session"),
              );
            if (run.agent !== "acp") {
              if (request.action !== "cancel")
                return yield* Effect.fail(
                  new OutlineError(
                    "Use the attached terminal for this executor",
                  ),
                );
              yield* tmux([
                "send-keys",
                "-t",
                run.sessionName,
                "C-c",
                "exit",
                "Enter",
              ]);
              return;
            }
            if (
              request.action === "permission" ||
              request.action === "answer"
            ) {
              const history = (yield* events.read).filter(
                (e) => e.runId === run.id,
              );
              const permission = history.find(
                (e) =>
                  e.agent?.type ===
                    (request.action === "answer" ? "question" : "permission") &&
                  e.agent.requestId === request.requestId,
              )?.agent;
              if (
                !permission ||
                (request.action === "permission" &&
                  !permission.options?.some(
                    (o) => o.id === request.optionId,
                  )) ||
                history.some(
                  (e) =>
                    (e.agent?.type === "permission_resolved" ||
                      e.agent?.type === "question_resolved") &&
                    e.agent.requestId === request.requestId,
                )
              )
                return yield* Effect.fail(
                  new OutlineError("Unknown or resolved permission request"),
                );
            }
            yield* outlineIO(() =>
              atomicWrite(
                join(
                  repo.dir,
                  "runs",
                  run.id,
                  "control",
                  `${Date.now()}-${randomUUID()}.json`,
                ),
                JSON.stringify(request),
              ),
            );
          }),
        ),
      start: (nodeId, agent, options = {}) =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(Agent)(agent).pipe(
            Effect.mapError((e) => new OutlineError(String(e))),
          );
          const snapshot = yield* outline.read;
          const node = snapshot.nodes.find((n) => n.id === nodeId);
          if (!node)
            return yield* Effect.fail(
              new OutlineError(`Unknown node ${nodeId}`),
            );
          const acpConfiguration =
            agent === "acp"
              ? (options.acp ??
                (yield* outlineIO(async () =>
                  Schema.decodeUnknownSync(AcpConfiguration)(
                    JSON.parse(
                      await readFile(join(repo.dir, "acp.json"), "utf8"),
                    ),
                  ),
                )))
              : undefined;
          yield* tmux(["-V"]);
          const id = randomUUID();
          const runDir = join(repo.dir, "runs", id);
          const codeSha = yield* repo.projectGit(["rev-parse", "HEAD"]);
          const contextIds = new Set([nodeId]);
          for (let changed = true; changed; ) {
            changed = false;
            for (const n of snapshot.nodes)
              if (
                n.parent &&
                contextIds.has(n.parent) &&
                !contextIds.has(n.id)
              ) {
                contextIds.add(n.id);
                changed = true;
              }
          }
          for (let parent = node.parent; parent; ) {
            contextIds.add(parent);
            parent =
              snapshot.nodes.find((n) => n.id === parent)?.parent ?? null;
          }
          const run = new Run({
            id,
            nodeId,
            agent,
            branch: `threadvm/${nodeId}-${id.slice(0, 8)}`,
            worktree: join(repo.dir, "worktrees", id),
            sessionName: `threadvm-run-${id}`,
            codeSha,
            status: "starting",
            startedAt: Date.now(),
            threadId: options.threadId,
            executor: options.executor,
            parentThreadId: options.parentThreadId,
            instruction: options.instruction ?? node.text,
            contextNodes: snapshot.nodes.filter((n) => contextIds.has(n.id)),
            persistent: options.persistent ?? false,
          });
          const capability = randomBytes(32).toString("hex");
          yield* outlineIO(async () => {
            await mkdir(runDir, { recursive: true, mode: 0o700 });
            await mkdir(join(runDir, "control"), { mode: 0o700 });
            if (acpConfiguration)
              await writeFile(
                join(runDir, "acp.json"),
                JSON.stringify({
                  ...acpConfiguration,
                  persistent: options.persistent ?? false,
                }),
                { mode: 0o600 },
              );
            await writeFile(join(runDir, "capability"), capability, {
              mode: 0o600,
            });
          });
          yield* record(run, "starting", { run });
          const start = Effect.gen(function* () {
            yield* repo.projectGit([
              "worktree",
              "add",
              "-b",
              run.branch,
              run.worktree,
              codeSha,
            ]);
            const path = [node.text];
            let parent = node.parent;
            while (parent) {
              const ancestor = snapshot.nodes.find((n) => n.id === parent)!;
              path.unshift(ancestor.text);
              parent = ancestor.parent;
            }
            const subtreeIds = new Set([nodeId]);
            let changed = true;
            while (changed) {
              changed = false;
              for (const n of snapshot.nodes)
                if (
                  n.parent &&
                  subtreeIds.has(n.parent) &&
                  !subtreeIds.has(n.id)
                ) {
                  subtreeIds.add(n.id);
                  changed = true;
                }
            }
            const context = `# ThreadVM run ${id}\n\nIntent: ${path.join(" / ")}\nNode: ${nodeId}\nCode: ${codeSha}\nBranch: ${run.branch}\n\n${renderMarkdown({ ...snapshot, nodes: snapshot.nodes.filter((n) => subtreeIds.has(n.id)).map((n) => (n.id === nodeId ? { ...n, parent: null } : n)) })}\nYou execute this intent. Outline changes require human review. Do not launch other agents.\nUse the CLI write path (capability is already in your environment):\nthreadvm outline show\nthreadvm propose <batch.json|->  # {"baseRevision":${snapshot.revision},"operations":[...]}\nUse snapshot.revision from a fresh outline show. Operations are:\ninsert: {"type":"insert","parent":"parent_id or null","after":"sibling_id or null (optional)","node":{"id":"unique_new_id","text":"task","done":false}}\nupdate: {"type":"update","id":"node_id","patch":{"text":"new intent","done":false}}\nmove: {"type":"move","id":"node_id","parent":null,"after":null}\ndelete: {"type":"delete","id":"node_id"} (includes descendants)\nUse actual JSON null for root/first anchor; omitted after appends. IDs are immutable and never reused.\nthreadvm observe ${id} 'progress or findings'\nthreadvm observe ${id} '<commit SHA>' --kind commit\nHuman edits, proposal review, remote changes and delegation are unavailable to this run.\n${options.instruction ? `\nAdditional instruction: ${options.instruction}\n` : ""}`;
            const binDir = join(runDir, "bin");
            const runner = join(runDir, "runner.sh");
            const agentCommand =
              agent === "acp"
                ? `${quote(process.execPath)} ${quote(fileURLToPath(new URL("../../../agent/dist/main.js", import.meta.url)))}`
                : agent === "shell"
                  ? "bash --noprofile --norc -i"
                  : agent === "codex"
                    ? `codex ${quote(context)}`
                    : `claude ${quote(context)}`;
            yield* outlineIO(async () => {
              await mkdir(binDir, { recursive: true });
              await writeFile(
                join(binDir, "threadvm"),
                `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cliPath)} "$@"\n`,
                { mode: 0o700 },
              );
              await writeFile(join(runDir, "context.md"), context);
              await writeFile(
                runner,
                `#!/bin/bash\nexport THREADVM_PROJECT_DIR=${quote(repo.projectDir)}\nexport THREADVM_RUN_ID=${quote(id)}\nexport THREADVM_RUN_CAPABILITY=${quote(capability)}\nexport THREADVM_CONTEXT_FILE=${quote(join(runDir, "context.md"))}\nexport PATH=${quote(`${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`)}\nunset THREADVM_TERMINAL_COMMAND THREADVM_TERMINAL_LOCAL_TMUX\nprintf '%s\\n' ${quote(`ThreadVM · ${agent} · ${id.slice(0, 8)}\nIntent: ${path.join(" / ")}\n\nFull instructions: ${join(runDir, "context.md")}\nUse threadvm outline show, propose, and observe to collaborate.\n`)}\n${agentCommand}\nresult=$?\nthreadvm observe ${quote(id)} 'Local executor exited' --kind finished --exit-code "$result"\nexit "$result"\n`,
                { mode: 0o700 },
              );
            });
            yield* repo.withLock(
              Effect.gen(function* () {
                yield* outlineIO(async () => {
                  await mkdir(join(repo.dir, "summaries"), { recursive: true });
                  await writeFile(
                    join(repo.dir, "summaries", `${id}.md`),
                    `${context}\nWorktree: ${run.worktree}\nSession: ${run.sessionName}\nEvents: ../events.jsonl (runId ${id})\n`,
                  );
                });
                yield* repo.git(["add", "--", `summaries/${id}.md`]);
                yield* repo.git([
                  "-c",
                  "commit.gpgsign=false",
                  "commit",
                  "--no-verify",
                  "--only",
                  "-m",
                  `run: delegate ${nodeId} (${id})`,
                  "--",
                  `summaries/${id}.md`,
                ]);
              }),
            );
            yield* tmux([
              "new-session",
              "-d",
              "-s",
              run.sessionName,
              "-c",
              run.worktree,
            ]);
            yield* tmux([
              "set-option",
              "-t",
              run.sessionName,
              "remain-on-exit",
              "on",
            ]);
            yield* record(run, "started");
            yield* tmux([
              "respawn-pane",
              "-k",
              "-t",
              run.sessionName,
              `bash ${quote(runner)}`,
            ]);
            return new Run({ ...run, status: "running" });
          });
          return yield* start.pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* tmux(["kill-session", "-t", run.sessionName]).pipe(
                  Effect.catch(() => Effect.void),
                );
                yield* record(run, "failed", {
                  message: error.message,
                  exitCode: 1,
                });
                return yield* Effect.fail(error);
              }),
            ),
          );
        }),
      observe: (request) =>
        Effect.gen(function* () {
          const run = yield* authorize(request.runId, request.capability);
          if (run.status === "finished" || run.status === "failed")
            return yield* Effect.fail(
              new OutlineError("Run has already finished"),
            );
          yield* record(run, request.kind, {
            message: request.message,
            agent: request.agent,
            codeSha: request.codeSha,
            exitCode: request.exitCode,
          });
        }),
      prepare: (runId) =>
        Effect.gen(function* () {
          const run = (yield* list).find((r) => r.id === runId);
          if (!run) return yield* Effect.fail(new OutlineError("Unknown run"));
          yield* tmux(["has-session", "-t", run.sessionName]);
          return {
            sessionName: run.sessionName,
            reused: true,
            command: {
              file: "tmux",
              args: ["attach-session", "-t", run.sessionName],
            },
          };
        }),
    };
  }),
);
