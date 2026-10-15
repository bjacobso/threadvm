import assert from "node:assert/strict";
import { Schema } from "effect";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  appendFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyOperations } from "../packages/shared/src/services/OutlineStore.js";
import {
  OutlineSnapshot,
  OperationBatch
} from "../packages/shared/src/domain/outline.js";

const exec = promisify(execFile);
const cli = resolve("apps/cli/dist/main.js");
const project = await mkdtemp(join(tmpdir(), "threadvm-outline-"));
const thoughts = join(project, ".threadvm");
const git = async (...args: string[]) =>
  (await exec("git", ["-C", project, ...args])).stdout.trim();
const thoughtGit = async (...args: string[]) =>
  (await exec("git", ["-C", thoughts, ...args])).stdout.trim();
const invoke = async (args: string[], env: Record<string, string> = {}) => {
  const result = await exec(
    process.execPath,
    [cli, ...args, "--dir", project],
    { env: { ...process.env, ...env } }
  );
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
};
const batchFile = async (name: string, batch: unknown) => {
  const path = join(project, `${name}.json`);
  await writeFile(path, JSON.stringify(batch));
  return path;
};
const show = () => invoke(["outline", "show"]);
const apply = async (
  name: string,
  baseRevision: number,
  operations: unknown[]
) =>
  invoke([
    "outline",
    "apply",
    await batchFile(name, { baseRevision, operations })
  ]);
const insert = (id: string, parent: string | null, text = id) => ({
  type: "insert",
  parent,
  node: { id, text, done: false }
});
let session: string | undefined;
try {
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Outline probe");
  await git("config", "user.email", "probe@localhost");
  await writeFile(join(project, "README.md"), "Probe project\n");
  await git("add", "README.md");
  await git("commit", "-m", "Seed code history");
  await invoke(["init"]);
  assert.equal(
    await git("check-ignore", ".threadvm/snapshot.json"),
    ".threadvm/snapshot.json"
  );
  const initialCommits = Number(
    await thoughtGit("rev-list", "--count", "HEAD")
  );
  await apply("seed", 0, [
    insert("intent", null, "Implement authorization"),
    insert("contract", "intent", "Define contract"),
    insert("tests", "intent", "Write integration tests")
  ]);
  assert.equal(
    Number(await thoughtGit("rev-list", "--count", "HEAD")),
    initialCommits + 1
  );
  await apply("human", 1, [
    { type: "update", id: "contract", patch: { done: true } }
  ]);
  await apply("disjoint", 1, [
    {
      type: "update",
      id: "tests",
      patch: { text: "Exercise authorization boundaries" }
    }
  ]);
  await assert.rejects(
    apply("conflict", 1, [
      { type: "update", id: "contract", patch: { text: "Stale contract" } }
    ])
  );
  assert.equal((await show()).snapshot.revision, 3);
  const stableHead = await thoughtGit("rev-parse", "HEAD");
  await assert.rejects(
    apply("atomic-failure", 3, [
      insert("must_not_exist", null),
      { type: "move", id: "intent", parent: "unknown" }
    ])
  );
  assert.equal(await thoughtGit("rev-parse", "HEAD"), stableHead);
  assert(
    !(await show()).snapshot.nodes.some(
      (n: { id: string }) => n.id === "must_not_exist"
    )
  );
  const proposal = await invoke([
    "propose",
    await batchFile("proposal", {
      baseRevision: 3,
      operations: [
        insert("middleware", "intent", "Implement policy middleware"),
        insert("benchmark", "intent", "Benchmark policy latency")
      ]
    })
  ]);
  assert.equal((await show()).snapshot.nodes.length, 3);
  const beforeAccept = Number(await thoughtGit("rev-list", "--count", "HEAD"));
  await invoke(["proposal", "accept", proposal.id, "middleware"]);
  assert.equal(
    Number(await thoughtGit("rev-list", "--count", "HEAD")),
    beforeAccept + 1
  );
  let view = await show();
  assert.deepEqual(view.snapshot.proposals[0].accepted, ["middleware"]);
  assert.deepEqual(view.snapshot.proposals[0].pending, ["benchmark"]);
  assert(
    view.snapshot.nodes.some((n: { id: string }) => n.id === "middleware")
  );
  await invoke(["proposal", "reject", proposal.id, "benchmark"]);
  const current = view.snapshot.revision;
  await Promise.all([
    apply("concurrent-a", current, [insert("parallel_a", null)]),
    apply("concurrent-b", current, [insert("parallel_b", null)])
  ]);
  view = await show();
  assert.equal(view.snapshot.revision, current + 2);
  await assert.rejects(
    apply("cycle", view.snapshot.revision, [
      { type: "move", id: "intent", parent: "middleware" }
    ])
  );
  await mkdir(join(thoughts, ".writer-lock"));
  await writeFile(join(thoughts, ".writer-lock", "owner"), "99999999");
  await apply("move", view.snapshot.revision, [
    { type: "move", id: "tests", parent: null, after: "intent" }
  ]);
  view = await show();
  const staleBase = view.snapshot.revision;
  await apply("delete", staleBase, [{ type: "delete", id: "parallel_a" }]);
  await assert.rejects(
    apply("missing-anchor", staleBase, [
      { ...insert("orphan", null), after: "parallel_a" }
    ])
  );
  // An interrupted pre-commit projection write is never accepted on restart.
  await writeFile(join(thoughts, "snapshot.json"), "interrupted write");
  assert.equal((await show()).snapshot.revision, staleBase + 1);
  const run = await invoke(["run", "middleware", "--agent", "shell"]);
  session = run.sessionName;
  assert.equal(run.status, "running");
  assert.equal(
    await exec("git", ["-C", run.worktree, "branch", "--show-current"]).then(
      (r) => r.stdout.trim()
    ),
    run.branch
  );
  await exec("tmux", ["has-session", "-t", session]);
  const token = await readFile(
    join(thoughts, "runs", run.id, "capability"),
    "utf8"
  );
  const agentEnv = { THREADVM_RUN_ID: run.id, THREADVM_RUN_CAPABILITY: token };
  await invoke(
    ["observe", run.id, "Reading middleware and validating boundary cases"],
    agentEnv
  );
  await invoke(["observe", run.id, run.codeSha, "--kind", "commit"], agentEnv);
  await assert.rejects(invoke(["run", "intent"], agentEnv));
  await assert.rejects(
    invoke(["outline", "apply", join(project, "seed.json")], agentEnv)
  );
  await assert.rejects(
    invoke(["observe", "another-run", "Not mine"], agentEnv)
  );
  view = await show();
  const agentProposal = await invoke(
    [
      "propose",
      await batchFile("agent-proposal", {
        baseRevision: view.snapshot.revision,
        operations: [insert("agent_note", "middleware", "Add policy fixtures")]
      })
    ],
    agentEnv
  );
  assert.equal(agentProposal.runId, run.id);
  // The shell really inherits the protocol environment and runs the CLI from its worktree.
  await exec("tmux", [
    "send-keys",
    "-t",
    session,
    "threadvm observe \"$THREADVM_RUN_ID\" 'Observation from attached shell'",
    "Enter"
  ]);
  for (let attempt = 0; attempt < 60; attempt++) {
    view = await show();
    if (
      view.events.some(
        (e: { message: string }) =>
          e.message === "Observation from attached shell"
      )
    )
      break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert(
    view.events.some(
      (e: { message: string }) =>
        e.message === "Observation from attached shell"
    )
  );
  await appendFile(join(thoughts, "events.jsonl"), '{"torn":');
  await invoke(["observe", run.id, "Recovered torn final append"], agentEnv);
  await invoke(["init"]); // Idempotence must preserve event history and proposal decisions.
  const restarted = await show(); // Every CLI invocation constructs a new service runtime.
  assert(
    restarted.runs.some(
      (r: { id: string; status: string }) =>
        r.id === run.id && r.status === "running"
    )
  );
  assert(
    restarted.events.some(
      (e: { message: string }) => e.message === "Recovered torn final append"
    )
  );
  assert.deepEqual(restarted.snapshot.proposals[0].rejected, ["benchmark"]);
  assert(
    restarted.snapshot.proposals.some(
      (p: { id: string; pending: string[] }) =>
        p.id === agentProposal.id && p.pending.includes("agent_note")
    )
  );
  const tracked = await thoughtGit("ls-files");
  assert(
    !tracked.includes("events.jsonl") &&
      !tracked.includes("capability") &&
      !tracked.includes("worktrees/")
  );
  const records = (await readFile(join(thoughts, "ops.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.length, restarted.snapshot.revision);
  assert(
    records.some(
      (batch) =>
        batch.proposalId === proposal.id && batch.operations.length === 1
    )
  );
  let replayed = new OutlineSnapshot({
    revision: 0,
    nodes: [],
    tombstones: {},
    proposals: []
  });
  for (const record of records)
    replayed = applyOperations(
      replayed,
      Schema.decodeUnknownSync(OperationBatch)(record)
    );
  assert.deepEqual(
    JSON.parse(JSON.stringify(replayed.nodes)),
    restarted.snapshot.nodes
  );
  assert.deepEqual(replayed.tombstones, restarted.snapshot.tombstones);
  const bare = join(project, "thoughts-remote.git");
  await exec("git", ["init", "--bare", bare]);
  await invoke(["remote", "add", "origin", bare]);
  await invoke(["push"]);
  assert.equal(
    await exec("git", ["--git-dir", bare, "rev-parse", "refs/heads/main"]).then(
      (r) => r.stdout.trim()
    ),
    await thoughtGit("rev-parse", "HEAD")
  );
  await exec("tmux", ["send-keys", "-t", session, "exit", "Enter"]);
  for (let attempt = 0; attempt < 60; attempt++) {
    view = await show();
    if (
      view.runs.find((r: { id: string }) => r.id === run.id).status ===
      "finished"
    )
      break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(
    view.runs.find((r: { id: string }) => r.id === run.id).status,
    "finished"
  );
  // The runner commits a concise final result separately from runtime events.
  for (let attempt = 0; attempt < 60; attempt++) {
    if (
      (await thoughtGit("show", `HEAD:summaries/${run.id}.md`)).includes(
        "## Result"
      )
    )
      break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert(
    (await thoughtGit("show", `HEAD:summaries/${run.id}.md`)).includes(
      `Code HEAD: ${run.codeSha}`
    )
  );
  console.log(
    "outline probe ok (CLI, conflicts, partial review, concurrent writers, thought commits, worktree/tmux, scoped agent writes, recovery, remotes)"
  );
} finally {
  if (session)
    await exec("tmux", ["kill-session", "-t", session]).catch(() => undefined);
  await rm(project, { recursive: true, force: true });
}
