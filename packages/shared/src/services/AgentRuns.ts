import { AgentConfiguration } from "./AgentConfiguration.js";
import { AgentProfile, SandboxRef, PendingRequest } from "../domain/runtime.js";
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
  AgentSignal,
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
  readonly sandbox?: string;
}
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
export class AgentRuns extends Context.Service<
  AgentRuns,
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
>()("AgentRuns") {}

export const AgentRunsLive = Layer.effect(
  AgentRuns,
  Effect.gen(function* () {
    const repo = yield* ThoughtsRepo;
    const outline = yield* OutlineStore;
    const events = yield* RunEventLog;
    const configuration = yield* AgentConfiguration;
    const commands = yield* CommandService;
    const cliPath = fileURLToPath(
      new URL("../../../../apps/cli/dist/main.js", import.meta.url),
    );
    const sandboxRpc = (
      action: string,
      ref: SandboxRef,
      extra: Record<string, unknown> = {},
    ) =>
      commands
        .execFile(
          process.execPath,
          [
            fileURLToPath(
              new URL("../../../agent/dist/sandbox-main.js", import.meta.url),
            ),
            JSON.stringify({ action, ref, ...extra }),
          ],
          { timeoutMs: 120000 },
        )
        .pipe(
          Effect.flatMap((r) => outlineIO(async () => JSON.parse(r.stdout))),
          Effect.mapError((e) => new OutlineError(e.message)),
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
          const head = run.sandboxRef
            ? yield* sandboxRpc("exec", run.sandboxRef, {
                script: "git rev-parse HEAD",
              }).pipe(
                Effect.map((result) => String(result.stdout).trim()),
                Effect.catch(() => Effect.succeed(run.codeSha)),
              )
            : yield* commands
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
    const resume = (run: Run) =>
      Effect.gen(function* () {
        if (
          !run.acpSessionId ||
          !(run.agentCapabilities as { loadSession?: boolean })?.loadSession
        )
          return yield* Effect.fail(
            new OutlineError(
              "This agent cannot resume its persisted ACP session",
            ),
          );
        const configPath = join(repo.dir, "runs", run.id, "acp.json");
        yield* outlineIO(async () => {
          const config = JSON.parse(await readFile(configPath, "utf8"));
          await atomicWrite(
            configPath,
            JSON.stringify({
              ...config,
              sessionId: run.acpSessionId,
              persistent: true,
            }),
          );
        });
        const restarting = new Run({
          ...run,
          status: "starting",
          endedAt: undefined,
          exitCode: undefined,
          persistent: true,
          pendingRequests: (run.pendingRequests ?? []).map(
            (r) => new PendingRequest({ ...r, response: "message" }),
          ),
        });
        yield* record(restarting, "starting", {
          run: restarting,
          message: "Loading persisted ACP session",
        });
        const existing = yield* Effect.result(
          tmux(["has-session", "-t", run.sessionName]),
        );
        if (existing._tag === "Failure")
          yield* tmux([
            "new-session",
            "-d",
            "-s",
            run.sessionName,
            "-c",
            repo.projectDir,
          ]);
        yield* tmux([
          "set-option",
          "-t",
          run.sessionName,
          "remain-on-exit",
          "on",
        ]);
        yield* record(restarting, "started");
        yield* tmux([
          "respawn-pane",
          "-k",
          "-t",
          run.sessionName,
          `bash ${quote(join(repo.dir, "runs", run.id, "runner.sh"))}`,
        ]);
        return new Run({ ...restarting, status: "running" });
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
        Effect.gen(function* () {
          let run = (yield* list).find((r) => r.id === request.runId);
          if (request.action === "permission" || request.action === "answer") {
            const pending = run?.pendingRequests?.find(
              (r) => r.id === request.requestId,
            );
            if (
              !pending ||
              pending.kind !==
                (request.action === "permission" ? "permission" : "question") ||
              (request.action === "permission" &&
                !pending.options.some((o) => o.id === request.optionId))
            )
              return yield* Effect.fail(
                new OutlineError(
                  "Unknown or resolved permission request or option",
                ),
              );
            if (pending.response === "expired")
              return yield* Effect.fail(
                new OutlineError(
                  "This request expired when its ACP transport closed",
                ),
              );
          }
          if (
            run &&
            run.status !== "running" &&
            (request.action === "prompt" ||
              run.pendingRequests?.some(
                (r) => r.id === request.requestId && r.response === "message",
              ))
          )
            run = yield* resume(run);
          if (!run || run.status !== "running")
            return yield* Effect.fail(
              new OutlineError("Control requires a running session"),
            );
          if (run.agent !== "acp") {
            if (
              run.sandboxRef?.provider !== undefined &&
              run.sandboxRef.provider !== "local"
            ) {
              if (request.action !== "cancel")
                return yield* Effect.fail(
                  new OutlineError("Use the attached sandbox terminal"),
                );
              yield* sandboxRpc("exec", run.sandboxRef, {
                script: `tmux send-keys -t ${quote(run.sessionName)} C-c exit Enter`,
              });
              yield* tmux(["kill-session", "-t", run.sessionName]).pipe(
                Effect.catch(() => Effect.void),
              );
              yield* record(run, "finished", {
                exitCode: 0,
                message: "Stopped terminal-only sandbox run",
              });
              return;
            }
            if (request.action !== "cancel")
              return yield* Effect.fail(
                new OutlineError("Use the attached terminal for this executor"),
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
          if (request.action === "permission" || request.action === "answer") {
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
                !permission.options?.some((o) => o.id === request.optionId)) ||
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
          const previousRequest = run.pendingRequests?.find(
            (r) => r.id === request.requestId,
          );
          if (previousRequest?.response === "expired")
            return yield* Effect.fail(
              new OutlineError(
                "This request expired when its ACP transport closed",
              ),
            );
          const control =
            previousRequest?.response === "message"
              ? new RunControlRequest({
                  runId: run.id,
                  action: "prompt",
                  text: `The user answered a request from the previous session: ${previousRequest.title}\nAnswer: ${request.text ?? previousRequest.options.find((o) => o.id === request.optionId)?.name ?? ""}\nThis is a follow-up message, not approval for a new tool call.`,
                })
              : request;
          yield* outlineIO(() =>
            atomicWrite(
              join(
                repo.dir,
                "runs",
                run.id,
                "control",
                `${Date.now()}-${randomUUID()}.json`,
              ),
              JSON.stringify(control),
            ),
          );
          if (previousRequest?.response === "message")
            yield* record(run, "agent", {
              agent: new AgentSignal({
                type:
                  previousRequest.kind === "permission"
                    ? "permission_resolved"
                    : "question_resolved",
                requestId: previousRequest.id,
                payload: { text: control.text, response: "message" },
              }),
            });
        }),
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
          const selected = yield* configuration.resolve(
            agent === "acp" ? (options.executor ?? "acp") : agent,
            options.sandbox,
          );
          const profile = options.acp
            ? new AgentProfile({
                id: options.executor ?? agent,
                kind: "acp",
                ...options.acp,
              })
            : selected.profile;
          agent = profile.kind === "terminal" ? "shell" : "acp";
          const acpConfiguration =
            profile.kind === "acp"
              ? { command: profile.command!, args: profile.args ?? [] }
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
          const branch = `threadvm/${nodeId}-${id.slice(0, 8)}`;
          const sandboxRef = new SandboxRef({
            provider: selected.sandbox.provider,
            id,
            projectDir: repo.projectDir,
            branch,
            workdir:
              selected.sandbox.provider === "local"
                ? join(repo.dir, "worktrees", id)
                : `${selected.sandbox.workdir ?? "/tmp/threadvm"}/${id}`,
            sessionName: `threadvm-run-${id}`,
            host: selected.sandbox.host,
          });
          let run = new Run({
            id,
            nodeId,
            agent,
            branch,
            worktree: sandboxRef.workdir,
            agentProfile: profile,
            sandboxRef,
            pendingRequests: [],
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
          if (
            sandboxRef.provider !== "local" &&
            profile.kind === "acp" &&
            !selected.sandbox.callbackUrl
          )
            return yield* Effect.fail(
              new OutlineError(
                "Remote agents require a reachable callbackUrl for the scoped outline MCP server",
              ),
            );
          const mcpServers =
            sandboxRef.provider === "local"
              ? [
                  {
                    name: "threadvm",
                    command: process.execPath,
                    args: [
                      cliPath,
                      "mcp",
                      "--run",
                      id,
                      "--dir",
                      repo.projectDir,
                    ],
                    env: [
                      { name: "THREADVM_PROJECT_DIR", value: repo.projectDir },
                      { name: "THREADVM_RUN_ID", value: id },
                      { name: "THREADVM_RUN_CAPABILITY", value: capability },
                    ],
                  },
                ]
              : [
                  {
                    type: "http",
                    name: "threadvm",
                    url: `${selected.sandbox.callbackUrl!.replace(/\/$/, "")}/api/runs/${id}/mcp`,
                    headers: [
                      { name: "Authorization", value: `Bearer ${capability}` },
                    ],
                  },
                ];
          yield* outlineIO(async () => {
            await mkdir(runDir, { recursive: true, mode: 0o700 });
            await mkdir(join(runDir, "control"), { mode: 0o700 });
            if (acpConfiguration)
              await writeFile(
                join(runDir, "acp.json"),
                JSON.stringify({
                  ...acpConfiguration,
                  persistent: options.persistent ?? false,
                  profile,
                  sandboxRef,
                  mcpServers,
                }),
                { mode: 0o600 },
              );
            await writeFile(join(runDir, "capability"), capability, {
              mode: 0o600,
            });
          });
          yield* record(run, "starting", { run });
          const start = Effect.gen(function* () {
            const provisioned = yield* sandboxRpc("provision", sandboxRef, {
              spec: {
                ref: sandboxRef,
                baseRef: codeSha,
                repository: selected.sandbox.repository,
                bootstrap: selected.sandbox.bootstrap,
                baseDevbox: selected.sandbox.baseDevbox,
              },
            });
            const placed = yield* Schema.decodeUnknownEffect(SandboxRef)(
              provisioned,
            ).pipe(Effect.mapError((e) => new OutlineError(e.message)));
            run = new Run({ ...run, sandboxRef: placed });
            if (acpConfiguration)
              yield* outlineIO(async () => {
                const path = join(runDir, "acp.json");
                const config = JSON.parse(await readFile(path, "utf8"));
                await atomicWrite(
                  path,
                  JSON.stringify({ ...config, sandboxRef: placed }),
                );
              });
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
            const context = `# ThreadVM run ${id}\n\nIntent: ${path.join(" / ")}\nNode: ${nodeId}\nCode: ${codeSha}\nBranch: ${run.branch}\n\n${renderMarkdown({ ...snapshot, nodes: snapshot.nodes.filter((n) => subtreeIds.has(n.id)).map((n) => (n.id === nodeId ? { ...n, parent: null } : n)) })}\nYou execute this intent. Outline changes require human review. Do not launch other agents.\nUse the injected threadvm MCP tools outline.read, outline.propose and run.observe. Outline proposals are operation batches. Prefer MCP; CLI remains a fallback (capability is already in your environment):\nthreadvm outline show\nthreadvm propose <batch.json|->  # {"baseRevision":${snapshot.revision},"operations":[...]}\nUse snapshot.revision from a fresh outline show. Operations are:\ninsert: {"type":"insert","parent":"parent_id or null","after":"sibling_id or null (optional)","node":{"id":"unique_new_id","text":"task","done":false}}\nupdate: {"type":"update","id":"node_id","patch":{"text":"new intent","done":false}}\nmove: {"type":"move","id":"node_id","parent":null,"after":null}\ndelete: {"type":"delete","id":"node_id"} (includes descendants)\nUse actual JSON null for root/first anchor; omitted after appends. IDs are immutable and never reused.\nthreadvm observe ${id} 'progress or findings'\nthreadvm observe ${id} '<commit SHA>' --kind commit\nHuman edits, proposal review, remote changes and delegation are unavailable to this run.\n${options.instruction ? `\nAdditional instruction: ${options.instruction}\n` : ""}`;
            const binDir = join(runDir, "bin");
            const runner = join(runDir, "runner.sh");
            const remoteShell =
              agent === "shell" && run.sandboxRef?.provider !== "local"
                ? yield* sandboxRpc("pty", run.sandboxRef!)
                : undefined;
            const agentCommand =
              agent === "shell"
                ? remoteShell
                  ? [remoteShell.command.file, ...remoteShell.command.args]
                      .map(quote)
                      .join(" ")
                  : "bash --noprofile --norc -i"
                : `${quote(process.execPath)} ${quote(fileURLToPath(new URL("../../../agent/dist/main.js", import.meta.url)))}`;
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
            if (sandboxRef.provider !== "local")
              yield* tmux([
                "new-session",
                "-d",
                "-s",
                run.sessionName,
                "-c",
                repo.projectDir,
              ]);
            yield* record(run, "started", { run });
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
            return request.kind === "finished" ? undefined : yield* Effect.fail(
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
          if (run.sandboxRef) return yield* sandboxRpc("pty", run.sandboxRef);
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
