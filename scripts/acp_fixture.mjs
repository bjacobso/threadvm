// Deterministic ACP v1 peer for probes. This is a test agent, not an LLM.
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const nodeId = process.argv[2];
writeFileSync("acp-runner-pid", String(process.ppid));
const hold = process.argv.includes("--hold");
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
let turn, mcpServer;
let rpcId = 0;
const mcp = async (name, args = {}) => {
  const request = {
    jsonrpc: "2.0",
    id: ++rpcId,
    method: "tools/call",
    params: { name, arguments: args },
  };
  let response;
  if (mcpServer.type === "http") {
    const headers = Object.fromEntries(
      (mcpServer.headers ?? []).map((h) => [h.name, h.value]),
    );
    response = await fetch(mcpServer.url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
    }).then((r) => r.json());
  } else {
    const env = {
      ...process.env,
      ...Object.fromEntries(
        (mcpServer.env ?? []).map((e) => [e.name, e.value]),
      ),
    };
    const text = execFileSync(mcpServer.command, mcpServer.args, {
      env,
      encoding: "utf8",
      input: JSON.stringify(request) + "\n",
    });
    response = JSON.parse(text.trim().split("\n").at(-1));
  }
  if (response.error || response.result?.isError)
    throw Error(JSON.stringify(response));
  return JSON.parse(response.result.content[0].text);
};
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
        agentCapabilities: {
          loadSession: process.argv.includes("--resumable"),
          mcpCapabilities: { http: true },
        },
        agentInfo: { name: "ThreadVM ACP probe fixture", version: "1" },
        authMethods: [],
      },
    });
  else if (message.method === "session/new") {
    if (process.argv.includes("--fail-new")) {
      send({
        id: message.id,
        error: { code: -32000, message: "Fixture authentication required" },
      });
      continue;
    }
    mcpServer = message.params.mcpServers?.[0];
    writeFileSync(
      "mcp-injected.json",
      JSON.stringify({
        name: mcpServer?.name,
        transport: mcpServer?.type ?? "stdio",
      }),
    );
    send({ id: message.id, result: { sessionId: "fixture-session" } });
  } else if (message.method === "session/load") {
    if (!process.argv.includes("--resumable"))
      send({ id: message.id, error: { code: -32601, message: "Cannot load" } });
    else {
      mcpServer = message.params.mcpServers?.[0];
      writeFileSync("acp-load-received.txt", "session/load received\n");
      send({ id: message.id, result: {} });
    }
  } else if (message.method === "session/prompt") {
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
      const snapshot = mcpServer
        ? await mcp("outline.read")
        : JSON.parse(cli(["outline", "show"])).snapshot;
      const suffix = process.env.THREADVM_RUN_ID.slice(0, 8);
      const operations = ["Review harness proof", "Add follow-up coverage"].map(
        (text, i) => ({
          type: "insert",
          parent: nodeId,
          node: { id: `proof-${suffix}-${i}`, text, done: false },
        }),
      );
      const batch = { baseRevision: snapshot.revision, operations };
      if (mcpServer) await mcp("outline.propose", batch);
      else cli(["propose", "-"], JSON.stringify(batch));
      if (mcpServer)
        await mcp("run.observe", {
          message:
            "Created harness-proof.txt and proposed two reviewable bullets",
        });
      else
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
