// Deterministic ACP v1 peer for probes. This is a test agent, not an LLM.
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const nodeId = process.argv[2];
writeFileSync("acp-runner-pid", String(process.ppid));
const hold = process.argv.includes("--hold");
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
let turn;
const update = (text) =>
  send({
    method: "session/update",
    params: {
      sessionId: "fixture-session",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
const cli = (args, input) =>
  execFileSync("threadvm", args, {
    encoding: "utf8",
    ...(input ? { input } : {}),
  });
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.method === "initialize")
    send({
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        agentInfo: { name: "ThreadVM ACP probe fixture", version: "1" },
        authMethods: [],
      },
    });
  else if (message.method === "session/new")
    send({ id: message.id, result: { sessionId: "fixture-session" } });
  else if (message.method === "session/prompt") {
    turn = message.id;
    update("ACP test agent is working in the delegated worktree.\n");
    if (process.argv.includes("--large"))
      update("large protocol output · ".repeat(8000));
    if (!hold)
      send({
        id: "test-permission",
        method: "session/request_permission",
        params: {
          sessionId: "fixture-session",
          toolCall: {
            toolCallId: "write-proof",
            title: "Write harness-proof.txt in this worktree?",
            kind: "edit",
            status: "pending",
          },
          options: [
            { optionId: "allow", name: "Allow once", kind: "allow_once" },
            { optionId: "deny", name: "Reject", kind: "reject_once" },
          ],
        },
      });
  } else if (message.id === "test-permission") {
    if (message.result?.outcome?.optionId === "allow") {
      writeFileSync(
        "harness-proof.txt",
        "The ACP agent wrote this inside its own worktree.\n",
      );
      const view = JSON.parse(cli(["outline", "show"]));
      const suffix = process.env.THREADVM_RUN_ID.slice(0, 8);
      const operations = ["Review harness proof", "Add follow-up coverage"].map(
        (text, i) => ({
          type: "insert",
          parent: nodeId,
          node: { id: `proof-${suffix}-${i}`, text, done: false },
        }),
      );
      cli(
        ["propose", "-"],
        JSON.stringify({ baseRevision: view.snapshot.revision, operations }),
      );
      cli([
        "observe",
        process.env.THREADVM_RUN_ID,
        "Created harness-proof.txt and proposed two reviewable bullets",
      ]);
      update(
        "Worktree proof written. Outline suggestions await human review.\n",
      );
    }
    send({ id: turn, result: { stopReason: "end_turn" } });
  } else if (message.method === "session/cancel") {
    writeFileSync("acp-cancel-received.txt", "session/cancel received\n");
    if (turn !== undefined) {
      send({ id: turn, result: { stopReason: "cancelled" } });
      turn = undefined;
    }
  } else if (message.method && message.id !== undefined)
    send({
      id: message.id,
      error: { code: -32601, message: "Unsupported by probe fixture" },
    });
}
