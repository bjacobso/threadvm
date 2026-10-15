// Deterministic peer for Sandbox-backed ACP client tools and large session replay.
import { createInterface } from "node:readline";
const send = (m) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const pending = new Map();
let next = 0;
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = `client-${++next}`;
    pending.set(id, { resolve, reject });
    send({
      id,
      method,
      params: { sessionId: "capability-session", ...params },
    });
  });
const handle = async (m) => {
  if (m.method === "initialize")
    send({
      id: m.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        authMethods: [],
        agentInfo: { name: "Sandbox capability fixture", version: "1" },
      },
    });
  else if (m.method === "session/new")
    send({ id: m.id, result: { sessionId: "capability-session" } });
  else if (m.method === "session/load") {
    for (let i = 0; i < 700; i++)
      send({
        method: "session/update",
        params: {
          sessionId: "capability-session",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `replay-${i}\n` },
          },
        },
      });
    send({ id: m.id, result: {} });
  } else if (m.method === "session/prompt") {
    await request("fs/write_text_file", {
      path: process.cwd() + "/via-acp.txt",
      content: "first\nsecond\nthird",
    });
    const file = await request("fs/read_text_file", {
      path: process.cwd() + "/via-acp.txt",
      line: 2,
      limit: 1,
    });
    if (file.content !== "second") throw Error("Incorrect sandbox line read");
    const t = await request("terminal/create", {
      command: "bash",
      args: ["-c", "printf terminal-via-sandbox"],
      outputByteLimit: 1000,
    });
    await request("terminal/wait_for_exit", { terminalId: t.terminalId });
    const output = await request("terminal/output", {
      terminalId: t.terminalId,
    });
    if (!output.output.includes("terminal-via-sandbox"))
      throw Error("Missing sandbox terminal output");
    await request("terminal/release", { terminalId: t.terminalId });
    send({ id: m.id, result: { stopReason: "end_turn" } });
  } else if (m.method === "session/cancel") {
  } else if (m.id !== undefined)
    send({ id: m.id, error: { code: -32601, message: "Unsupported method" } });
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line),
    waiter = pending.get(m.id);
  if (waiter) {
    pending.delete(m.id);
    if (m.error) waiter.reject(Error(JSON.stringify(m.error)));
    else waiter.resolve(m.result);
  } else
    handle(m).catch((error) => {
      console.error(error);
      process.exit(1);
    });
});
