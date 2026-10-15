import { createServer } from "node:net";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const exec = promisify(execFile);
if (!process.env.THREADVM_ACP_PROVIDER) {
  for (const provider of ["local", "exe"]) {
    const result = await exec(
      process.execPath,
      [resolve("scripts/acp_probe.mjs")],
      {
        env: { ...process.env, THREADVM_ACP_PROVIDER: provider },
        maxBuffer: 1024 * 1024,
      },
    );
    process.stdout.write(result.stdout);
  }
  process.exit(0);
}
const provider = process.env.THREADVM_ACP_PROVIDER;
const project = await mkdtemp(join(tmpdir(), "threadvm-acp-"));
const cli = resolve("apps/cli/dist/main.js");
const fixture = resolve("scripts/acp_fixture.mjs");
const call = async (...args) => {
  const { stdout } = await exec(
    process.execPath,
    [cli, ...args, "--dir", project],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : null;
};
const git = (...args) => exec("git", ["-C", project, ...args]);
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 150));
  }
  const state = await call("outline", "show");
  throw new Error(
    `Timed out: ${label}\n${JSON.stringify({ runs: state.runs.map((r) => ({ id: r.id, status: r.status, pending: r.pendingRequests?.map((q) => ({ id: q.id, response: q.response })) })), events: state.events.slice(-8).map((e) => ({ kind: e.kind, type: e.agent?.type, message: e.message?.slice(0, 300) })) }, null, 2)}`,
  );
};
const sessions = [];
let server;
let serverLog = "";
const remoteTmux = join(project, "remote-tmux");
const remoteRoot = join(project, "remote");

try {
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "ACP probe");
  await git("config", "user.email", "probe@localhost");
  await writeFile(join(project, "README.md"), "ACP harness probe\n");
  await git("add", "README.md");
  await git("commit", "-m", "Seed");
  await call("init");
  if (provider === "exe") {
    await mkdir(join(project, "mock-bin"));
    await mkdir(remoteTmux);
    await mkdir(remoteRoot);
    const ssh = join(project, "mock-bin", "ssh");
    await writeFile(
      ssh,
      `#!/usr/bin/env node
const {spawnSync}=require('node:child_process');const {appendFileSync}=require('node:fs');const a=process.argv.slice(2);if(!a.includes('--')||!(a.includes('-T')||a.includes('-tt')))process.exit(99);appendFileSync(${JSON.stringify(join(project, "ssh-invocations.jsonl"))},JSON.stringify({pty:a.includes('-tt'),hasHost:a.includes('probe.exe.dev')})+'\\n');const r=spawnSync('bash',['-c',a.at(-1)],{stdio:'inherit',env:{...process.env,TMUX:'',TMUX_TMPDIR:${JSON.stringify(remoteTmux)}}});process.exit(r.status??1);`,
      { mode: 0o700 },
    );
    process.env.PATH = join(project, "mock-bin") + ":" + process.env.PATH;
    delete process.env.THREADVM_SSH_MOCK;
    const socket = createServer();
    await new Promise((r) => socket.listen(0, "127.0.0.1", r));
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    server = spawn(process.execPath, [resolve("apps/server/dist/main.js")], {
      env: {
        ...process.env,
        THREADVM_PORT: String(port),
        THREADVM_PROJECT_DIR: project,
        THREADVM_EXEDEV_MOCK: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (c) => (serverLog += c));
    server.stderr.on("data", (c) => (serverLog += c));
    await waitFor(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/api/outline`)).ok;
      } catch {
        return false;
      }
    }, "mock exe control plane");
    await writeFile(
      join(project, ".threadvm", "agents.yaml"),
      JSON.stringify({
        agents: {
          fixture: { acp: { command: process.execPath, args: [] } },
          shell: { kind: "terminal" },
        },
        sandboxes: {
          local: { provider: "local" },
          exe: {
            provider: "exe",
            host: "probe.exe.dev",
            workdir: remoteRoot,
            repository: project,
            callbackUrl: `http://127.0.0.1:${port}`,
          },
        },
        defaults: { sandbox: "local" },
      }),
    );
  }
  if (provider === "local")
    await writeFile(
      join(project, ".threadvm", "agents.yaml"),
      JSON.stringify({
        agents: { fixture: { acp: { command: process.execPath } } },
        sandboxes: { local: { provider: "local" } },
        defaults: { sandbox: "local" },
      }),
    );
  const batch = join(project, "seed.json");
  await writeFile(
    batch,
    JSON.stringify({
      baseRevision: 0,
      operations: [
        {
          type: "insert",
          parent: null,
          node: {
            id: "task",
            text: "Exercise the real ACP local harness",
            done: false,
          },
        },
      ],
    }),
  );
  await call("outline", "apply", batch);
  const config = async (hold = false, resumable = false, failNew = false) =>
    writeFile(
      join(project, ".threadvm/acp-fixture.json"),
      JSON.stringify({
        command: process.execPath,
        args: [
          fixture,
          "task",
          "--large",
          ...(hold ? ["--hold"] : []),
          ...(resumable ? ["--resumable"] : []),
          ...(failNew ? ["--fail-new"] : []),
        ],
      }),
    );
  await config();
  const run = await call("run", "task", "--agent", `fixture/${provider}`);
  sessions.push(run.sessionName);
  const permission = await waitFor(
    async () =>
      (await call("outline", "show")).events.find(
        (e) => e.runId === run.id && e.agent?.type === "permission",
      ),
    "permission request",
  );
  assert.equal(permission.agent.options[0].id, "allow");
  await assert.rejects(
    call("permission", run.id, permission.agent.requestId, "made-up"),
  );
  await call("permission", run.id, permission.agent.requestId, "allow");
  const view = await waitFor(async () => {
    const v = await call("outline", "show");
    return v.runs.find((r) => r.id === run.id)?.status === "finished"
      ? v
      : false;
  }, "completed ACP run");
  assert.equal(
    JSON.parse(await readFile(join(run.worktree, "mcp-injected.json"), "utf8"))
      .name,
    "threadvm",
  );
  assert.equal(view.runs[0].sandboxRef.provider, provider);
  assert.equal(view.runs[0].acpSessionId, "fixture-session");
  assert.deepEqual(view.runs[0].pendingRequests, []);
  assert.ok(
    view.events.some(
      (e) =>
        e.agent?.type === "update" &&
        (e.agent.payload?.content?.text?.length ?? 0) > 131072,
    ),
    "large updates cross stdin rather than argv",
  );
  assert.match(
    await readFile(join(run.worktree, "harness-proof.txt"), "utf8"),
    /own worktree/,
  );
  const proposal = view.snapshot.proposals.find((p) => p.runId === run.id);
  assert.equal(proposal.pending.length, 2);
  await call("proposal", "accept", proposal.id, proposal.pending[0]);
  const recovered = await call("outline", "show");
  assert.equal(
    recovered.snapshot.proposals.find((p) => p.id === proposal.id).pending
      .length,
    1,
  );
  assert.ok(recovered.events.some((e) => e.agent?.type === "initialized"));
  assert.ok(
    recovered.events.some((e) => e.agent?.type === "permission_resolved"),
  );
  assert.ok(recovered.events.some((e) => e.agent?.type === "turn_complete"));
  const history = (
    await exec("git", ["-C", join(project, ".threadvm"), "log", "--format=%s"])
  ).stdout;
  assert.match(history, /accept/);
  assert.match(history, /summarize/);
  await config(true);
  const cancelled = await call("run", "task", "--agent", `fixture/${provider}`);
  sessions.push(cancelled.sessionName);
  await waitFor(
    async () =>
      (await call("outline", "show")).events.some(
        (e) => e.runId === cancelled.id && e.agent?.type === "session",
      ),
    "second session",
  );
  await call("cancel", cancelled.id);
  await waitFor(
    async () =>
      (await call("outline", "show")).runs.find((r) => r.id === cancelled.id)
        ?.status === "finished",
    "cancellation",
  );
  assert.match(
    await readFile(join(cancelled.worktree, "acp-cancel-received.txt"), "utf8"),
    /session\/cancel/,
  );
  const interrupted = await call(
    "run",
    "task",
    "--agent",
    `fixture/${provider}`,
  );
  sessions.push(interrupted.sessionName);
  await waitFor(
    async () =>
      (await call("outline", "show")).events.some(
        (e) => e.runId === interrupted.id && e.agent?.type === "update",
      ),
    "interrupted session",
  );
  const runnerPid = Number(
    await readFile(
      join(project, ".threadvm", "runs", interrupted.id, "worker.pid"),
      "utf8",
    ),
  );
  process.kill(runnerPid, "SIGTERM");
  await waitFor(
    async () =>
      (await call("outline", "show")).runs.find((r) => r.id === interrupted.id)
        ?.status === "failed",
    "scoped SIGTERM cleanup",
  );
  assert.match(
    await readFile(
      join(interrupted.worktree, "acp-cancel-received.txt"),
      "utf8",
    ),
    /session\/cancel/,
  );
  await config(false, true);
  const resumable = await call("run", "task", "--agent", `fixture/${provider}`);
  sessions.push(resumable.sessionName);
  const pending = await waitFor(async () => {
    const r = (await call("outline", "show")).runs.find(
      (r) => r.id === resumable.id,
    );
    return r?.pendingRequests?.[0];
  }, "persisted resumable permission");
  const worker = Number(
    await readFile(
      join(project, ".threadvm", "runs", resumable.id, "worker.pid"),
      "utf8",
    ),
  );
  process.kill(worker, "SIGKILL");
  await waitFor(async () => {
    const r = (await call("outline", "show")).runs.find(
      (r) => r.id === resumable.id,
    );
    return (
      r?.status === "failed" && r.pendingRequests?.[0]?.response === "message"
    );
  }, "permission degrades to a message");
  await call("permission", resumable.id, pending.id, "allow");
  await waitFor(async () => {
    const r = (await call("outline", "show")).runs.find(
      (r) => r.id === resumable.id,
    );
    return r?.pendingRequests?.some(
      (p) => p.id !== pending.id && p.response === "live",
    );
  }, "session/load and a fresh permission, without replaying the old grant");
  assert.match(
    await readFile(join(resumable.worktree, "acp-load-received.txt"), "utf8"),
    /session\/load/,
  );
  await call("cancel", resumable.id);
  await waitFor(
    async () =>
      (await call("outline", "show")).runs.find((r) => r.id === resumable.id)
        ?.status === "finished",
    "resumed session cancellation",
  );
  await config(false, false);
  const expires = await call("run", "task", "--agent", `fixture/${provider}`);
  sessions.push(expires.sessionName);
  const expiring = await waitFor(
    async () =>
      (await call("outline", "show")).runs.find((r) => r.id === expires.id)
        ?.pendingRequests?.[0],
    "non-resumable pending permission",
  );
  process.kill(
    Number(
      await readFile(
        join(project, ".threadvm", "runs", expires.id, "worker.pid"),
        "utf8",
      ),
    ),
    "SIGKILL",
  );
  await waitFor(
    async () =>
      (await call("outline", "show")).runs.find((r) => r.id === expires.id)
        ?.pendingRequests?.[0]?.response === "expired",
    "request expires without session/load",
  );
  await assert.rejects(call("permission", expires.id, expiring.id, "allow"));
  await config(false, false, true);
  const unavailable = await call(
    "run",
    "task",
    "--agent",
    `fixture/${provider}`,
  );
  sessions.push(unavailable.sessionName);
  await waitFor(async () => {
    const v = await call("outline", "show");
    return (
      v.runs.find((r) => r.id === unavailable.id)?.status === "failed" &&
      v.events.some(
        (e) =>
          e.runId === unavailable.id &&
          e.kind === "finished" &&
          e.exitCode === 1 &&
          e.message?.includes("Fixture authentication required"),
      )
    );
  }, "session startup failure retains its cause");
  if (provider === "exe") {
    const shell = await call("run", "task", "--agent", "shell/exe");
    sessions.push(shell.sessionName);
    await exec(
      "tmux",
      [
        "send-keys",
        "-t",
        shell.sessionName,
        "pwd > shell-cwd-proof.txt",
        "Enter",
      ],
      { env: { ...process.env, TMUX_TMPDIR: remoteTmux } },
    );
    await waitFor(async () => {
      try {
        return (
          (
            await readFile(join(shell.worktree, "shell-cwd-proof.txt"), "utf8")
          ).trim() === shell.worktree
        );
      } catch {
        return false;
      }
    }, "terminal-only shell uses the same remote sandbox");
    await call("cancel", shell.id);
    await waitFor(
      async () =>
        (await call("outline", "show")).runs.find((r) => r.id === shell.id)
          ?.status === "finished",
      "remote shell stop",
    );
  }
  await call("init");
  const restarted = await call("outline", "show");
  assert.equal(restarted.runs.length, provider === "exe" ? 7 : 6);
  assert.equal(restarted.snapshot.proposals.length, 1);
  console.log(
    `PASS ACP ${provider}: ${provider === "exe" ? "mocked SSH transport, HTTP MCP" : "local byte stream, stdio MCP"}, initialization, scoped session, streaming, permission, worktree write, MCP proposal/observe, partial acceptance, thought commits, cancellation, interruption, persisted session/request state and recovery.`,
  );
} catch (error) {
  await writeFile(
    resolve(".context", `runtime-${provider}-probe-server.log`),
    serverLog,
  );
  throw error;
} finally {
  if (server) {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill("SIGTERM");
    await exited;
  }

  for (const session of sessions)
    await exec("tmux", ["kill-session", "-t", session]).catch(() => {});
  if (provider === "exe")
    for (const session of sessions)
      await exec("tmux", ["kill-session", "-t", session], {
        env: { ...process.env, TMUX_TMPDIR: remoteTmux },
      }).catch(() => {});
  await rm(project, { recursive: true, force: true });
}
