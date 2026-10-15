import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const exec = promisify(execFile);
const project = await mkdtemp(join(tmpdir(), "threadvm-acp-"));
const cli = resolve("apps/cli/dist/main.js");
const fixture = resolve("scripts/acp_fixture.mjs");
const call = async (...args) => {
  const { stdout } = await exec(process.execPath, [
    cli,
    ...args,
    "--dir",
    project,
  ]);
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
  throw new Error(
    `Timed out: ${label}\n${JSON.stringify(await call("outline", "show"), null, 2)}`,
  );
};
const sessions = [];
try {
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "ACP probe");
  await git("config", "user.email", "probe@localhost");
  await writeFile(join(project, "README.md"), "ACP harness probe\n");
  await git("add", "README.md");
  await git("commit", "-m", "Seed");
  await call("init");
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
  const config = async (hold = false) =>
    writeFile(
      join(project, ".threadvm/acp.json"),
      JSON.stringify({
        command: process.execPath,
        args: [fixture, "task", "--large", ...(hold ? ["--hold"] : [])],
      }),
    );
  await config();
  const run = await call("run", "task", "--agent", "acp");
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
  const cancelled = await call("run", "task", "--agent", "acp");
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
  const interrupted = await call("run", "task", "--agent", "acp");
  sessions.push(interrupted.sessionName);
  await waitFor(
    async () =>
      (await call("outline", "show")).events.some(
        (e) => e.runId === interrupted.id && e.agent?.type === "update",
      ),
    "interrupted session",
  );
  const runnerPid = Number(
    await readFile(join(interrupted.worktree, "acp-runner-pid"), "utf8"),
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
  await call("init");
  const restarted = await call("outline", "show");
  assert.equal(restarted.runs.length, 3);
  assert.equal(restarted.snapshot.proposals.length, 1);
  console.log(
    "PASS ACP: initialization, scoped process, session, streaming, permission validation/answer, worktree write, CLI proposal, partial acceptance, thought commits, cancellation, OS interruption, large updates and recovery.",
  );
} finally {
  for (const session of sessions)
    await exec("tmux", ["kill-session", "-t", session]).catch(() => {});
  await rm(project, { recursive: true, force: true });
}
