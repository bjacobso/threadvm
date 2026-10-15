import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

const exec = promisify(execFile);
const root = resolve(".");
const temp = await mkdtemp(join(tmpdir(), "threadvm-ui-"));
const project = join(temp, "authorization");
const cli = join(root, "apps/cli/dist/main.js");
const screenshots = join(root, ".context");
const port = async () => {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
};
const apiPort = await port();
const chromePort = await port();
const url = `http://127.0.0.1:${apiPort}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (predicate, description) => {
  let last;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      if (await predicate()) return;
    } catch (error) {
      last = error;
    }
    await sleep(100);
  }
  throw new Error(
    `Timed out: ${description}${last ? ` (${last.message})` : ""}`,
  );
};
const invoke = async (...args) =>
  JSON.parse(
    (await exec(process.execPath, [cli, ...args, "--dir", project])).stdout,
  );
const view = async () => {
  const response = await fetch(`${url}/api/outline`);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
let server,
  chrome,
  cdp,
  run,
  acpRun,
  inspectPage,
  serverLog = "";
const socketMessages = [];
const startServer = (launch = "open") => {
  const child = spawn(
    process.execPath,
    [cli, launch, ...(launch === "open" ? [project] : ["--dir", project])],
    {
      cwd: root,
      env: {
        ...process.env,
        THREADVM_PROJECT_DIR: project,
        THREADVM_PORT: String(apiPort),
        THREADVM_EXEDEV_MOCK: "1",
        THREADVM_SSH_MOCK: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => {
    serverLog += chunk;
  });
  child.stderr.on("data", (chunk) => {
    serverLog += chunk;
  });
  return child;
};
const stopServer = async () => {
  if (!server || server.exitCode !== null) return;
  const closed = new Promise((done) => server.once("exit", done));
  server.kill("SIGTERM");
  await closed;
};
try {
  await mkdir(project, { recursive: true });
  await mkdir(screenshots, { recursive: true });
  await exec("git", ["init", "--initial-branch=main", project]);
  await exec("git", ["-C", project, "config", "user.name", "UI probe"]);
  await exec("git", ["-C", project, "config", "user.email", "probe@localhost"]);
  await writeFile(join(project, "README.md"), "Authorization project\n");
  await exec("git", ["-C", project, "add", "README.md"]);
  await exec("git", ["-C", project, "commit", "-m", "Seed code history"]);
  await invoke("init");
  server = startServer();
  await until(
    async () => (await fetch(`${url}/api/outline`)).ok,
    "server ready",
  );
  chrome = spawn(
    "google-chrome",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${join(temp, "chrome")}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  await until(
    async () => (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok,
    "Chrome ready",
  );
  const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?${url}`, {
    method: "PUT",
  }).then((r) => r.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.onopen = done;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error)
        waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
    if (message.method === "Network.webSocketFrameReceived") {
      const data = message.params.response.payloadData;
      try {
        const frame = JSON.parse(data);
        if (frame.type !== "output") socketMessages.push(frame);
      } catch {}
    }
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
  };
  cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      pending.set(key, { resolve, reject });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await cdp("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails)
      throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  inspectPage = evaluate;
  const pointerClick = async (expression) => {
    const point = await evaluate(
      `(() => { const el = ${expression}; if (!el) throw new Error('Missing element'); el.scrollIntoView({ block: 'center' }); const rect = el.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`,
    );
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
  };
  const click = (selector) =>
    pointerClick(`document.querySelector(${JSON.stringify(selector)})`);
  const clickText = (text) =>
    pointerClick(
      `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)})`,
    );
  const input = async (nodeId, text) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(`[aria-label="Edit ${nodeId}"]`)}).focus()`,
    );
    await cdp("Input.insertText", { text });
  };
  const key = async (name, modifiers = 0) => {
    const codes = { Enter: 13, Tab: 9, ArrowUp: 38, ArrowDown: 40 };
    await cdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: name,
      code: name,
      windowsVirtualKeyCode: codes[name],
      modifiers,
    });
    await cdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: name,
      code: name,
      windowsVirtualKeyCode: codes[name],
      modifiers,
    });
  };
  const screenshot = async (name) => {
    await evaluate("document.fonts.ready");
    const capture = await cdp("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(
      join(screenshots, name),
      Buffer.from(capture.data, "base64"),
    );
  };
  await cdp("Runtime.enable");
  await cdp("Network.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await until(
    () => evaluate("document.body.innerText.includes('Start writing')"),
    "shared Foldkit empty state",
  );
  await clickText("Start writing");
  await until(
    () => evaluate("!!document.querySelector('.fw-outliner__text')"),
    "editor mounted",
  );
  await cdp("Input.insertText", { text: "Build the local harness" });
  await key("Enter");
  await until(
    () => evaluate("document.activeElement?.value === ''"),
    "new bullet focused",
  );
  await cdp("Input.insertText", { text: "Inspect the worktree @shell/local" });
  await key("Tab");
  await until(
    async () =>
      (await view()).snapshot.nodes.length === 2 &&
      (await view()).snapshot.nodes.some((n) => n.parent !== null),
    "human batches persisted",
  );
  const delegatedId = (await view()).snapshot.nodes.find(
    (n) => n.parent !== null,
  ).id;
  const rootId = (await view()).snapshot.nodes.find(
    (n) => n.parent === null,
  ).id;
  await click(".fw-outliner__text");
  await until(
    () => evaluate("document.body.innerText.includes('Keep as note')"),
    "mention countdown",
  );
  await click('[title="Send now"]');
  await until(async () => (await view()).runs.length === 1, "real shell run");
  run = (await view()).runs[0];
  await until(
    () =>
      evaluate("!!document.querySelector('.thread-chip[data-status=working]')"),
    "working node badge",
  );
  await click(".thread-chip[data-status=working]");
  await until(
    () => evaluate("!!document.querySelector('.terminal-section summary')"),
    "sandbox metadata ready",
  );
  await click(".terminal-section summary");
  await until(
    () => evaluate("!!document.querySelector('iframe')"),
    "terminal in thread panel",
  );
  await until(
    () =>
      evaluate(
        "!!document.querySelector('iframe')?.contentDocument?.querySelector('.xterm-helper-textarea')",
      ),
    "xterm mounted",
  );
  await until(
    () =>
      socketMessages.some(
        (m) => m.type === "status" && m.status === "attached",
      ),
    "TerminalBridge attached",
  );
  await evaluate(
    "document.querySelector('iframe').contentDocument.querySelector('.xterm-helper-textarea').focus()",
  );
  await cdp("Input.insertText", {
    text: "printf 'shared-client-terminal-proof\\n'",
  });
  await key("Enter");
  await until(
    async () =>
      (
        await exec("tmux", ["capture-pane", "-p", "-t", run.sessionName])
      ).stdout.includes("shared-client-terminal-proof"),
    "keyboard input reaches durable tmux",
  );
  await screenshot("align-probe-terminal.png");
  await clickText("Inbox");
  // A second window shares the exact room protocol. Human and CLI edits broadcast.
  let peer = new WebSocket(
    `${url.replace("http", "ws")}/api/outlines/local/socket`,
  );
  const frames = [];
  peer.onmessage = (e) => frames.push(JSON.parse(e.data));
  await until(
    () => frames.some((m) => m._tag === "Snapshot"),
    "second window snapshot",
  );
  const snapshot = frames.find((m) => m._tag === "Snapshot");
  const peerItems = structuredClone(snapshot.items);
  peerItems[0].text = "Two windows in sync";
  peer.send(
    JSON.stringify({
      _tag: "SaveDocument",
      items: peerItems,
      baseItems: snapshot.items,
      baseRevision: snapshot.backend.revision,
      requestId: "probe-peer-save",
    }),
  );
  await until(
    () =>
      evaluate(
        "[...document.querySelectorAll('textarea')].some(e => e.value === 'Two windows in sync')",
      ),
    "cross-window human edit",
  );
  // Preserve a real offline draft, then explicitly resolve a same-node conflict.
  peer.close();
  await stopServer();
  await until(
    () => evaluate("document.body.innerText.includes('Reconnecting')"),
    "offline editor",
  );
  await evaluate(
    `(() => {const el=document.querySelector('[data-outline-row="${rootId}"] textarea');el.focus();el.setSelectionRange(0,el.value.length)})()`,
  );
  await cdp("Input.insertText", { text: "My recovered offline edit" });
  const beforeConflict = await invoke("outline", "show");
  const conflictFile = join(project, "conflict.json");
  await writeFile(
    conflictFile,
    JSON.stringify({
      baseRevision: beforeConflict.snapshot.revision,
      operations: [
        {
          type: "update",
          id: rootId,
          patch: { text: "The other window changed this bullet" },
        },
        {
          type: "insert",
          parent: rootId,
          node: {
            id: "concurrent-child",
            text: "Keep the other window's child",
            done: false,
          },
        },
      ],
    }),
  );
  await invoke("outline", "apply", conflictFile);
  server = startServer();
  await until(
    () => evaluate("document.body.innerText.includes('Retry my edit')"),
    "conflict recovery controls",
  );
  await screenshot("align-probe-conflict.png");
  await clickText("Retry my edit");
  await until(async () => {
    const v = await view();
    return (
      v.snapshot.nodes.find((n) => n.id === rootId)?.text ===
        "My recovered offline edit" &&
      v.snapshot.nodes.some((n) => n.id === "concurrent-child")
    );
  }, "explicit retry preserves the draft and remote insert");
  frames.length = 0;
  peer = new WebSocket(
    `${url.replace("http", "ws")}/api/outlines/local/socket`,
  );
  peer.onmessage = (e) => frames.push(JSON.parse(e.data));
  await until(
    () => frames.some((m) => m._tag === "Snapshot"),
    "room reconnected",
  );
  await writeFile(
    join(project, ".threadvm/acp.json"),
    JSON.stringify({
      command: process.execPath,
      args: [join(root, "scripts/acp_fixture.mjs"), rootId],
    }),
  );
  peer.send(
    JSON.stringify({
      _tag: "Dispatch",
      threadId: "probe-acp",
      nodeId: rootId,
      agent: "claude",
      parentThreadId: null,
      instruction: "Exercise permissions and proposals",
    }),
  );
  await until(async () => (await view()).runs.length === 2, "ACP started");
  acpRun = (await view()).runs.find((r) => r.id !== run.id);
  await until(
    () => evaluate("document.body.innerText.includes('Allow once')"),
    "inline ACP permission and inbox",
  );
  assert.ok(
    await evaluate(
      "!!document.querySelector('.row-question') && !!document.querySelector('.inbox-card[data-kind=NeedsInput]')",
    ),
  );
  await screenshot("align-probe-question.png");
  // Persist a pending CLI suggestion while a permission is unanswered.
  const proposalFile = join(project, "proposal.json");
  await writeFile(
    proposalFile,
    JSON.stringify({
      baseRevision: (await view()).snapshot.revision,
      operations: [
        {
          type: "insert",
          parent: rootId,
          node: {
            id: "external-suggestion",
            text: "Review CLI suggestion",
            done: false,
          },
        },
      ],
    }),
  );
  await invoke("propose", proposalFile);
  await until(
    () => evaluate("document.body.innerText.includes('Review CLI suggestion')"),
    "CLI tracked change",
  );
  await stopServer();
  server = startServer();
  await until(
    async () => (await fetch(`${url}/api/outline`)).ok,
    "server restarted",
  );
  await cdp("Page.reload");
  await until(
    () =>
      evaluate(
        "document.body.innerText.includes('Allow once') && document.body.innerText.includes('Review CLI suggestion')",
      ),
    "pending question and proposal recover",
  );
  await clickText("Allow once");
  await until(
    () => evaluate("document.body.innerText.includes('Review harness proof')"),
    "agent proposal projected",
  );
  await screenshot("align-probe-suggestions.png");
  const agentProposal = (await view()).snapshot.proposals.find(
    (p) => p.runId === acpRun.id,
  );
  peer.close();
  await click('[aria-label="Accept: Review harness proof"]');
  await until(
    async () =>
      (await view()).snapshot.nodes.some(
        (n) => n.text === "Review harness proof",
      ),
    "per-row acceptance commits",
  );
  assert.equal(
    (await view()).snapshot.proposals.find((p) => p.id === agentProposal.id)
      .pending.length,
    1,
  );
  const history = (
    await exec("git", ["-C", join(project, ".threadvm"), "log", "--format=%s"])
  ).stdout;
  assert.match(history, /proposal: accept/);
  await cdp("Page.navigate", { url: `${url}/inventory` });
  await until(
    () =>
      evaluate("!!document.querySelector('[aria-label=\"Create ThreadVM\"]')"),
    "VM inventory reachable",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS shared Foldkit local room: editing, mention countdown, shell/worktree/tmux, thread terminal, two windows, ACP permission, CLI and agent tracked proposals, per-row acceptance, restart recovery, inventory.",
  );
  socket.close();
} catch (error) {
  await writeFile(join(screenshots, "plan4-foldkit-ui-server.log"), serverLog);
  if (inspectPage) {
    await writeFile(
      join(screenshots, "plan4-foldkit-ui-failure.txt"),
      (await inspectPage("document.body.innerText")) +
        "\n" +
        JSON.stringify(socketMessages, null, 2),
    );
    const capture = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(screenshots, "plan4-foldkit-ui-failure.png"),
      Buffer.from(capture.data, "base64"),
    );
  }
  throw error;
} finally {
  if (acpRun)
    await exec("tmux", ["kill-session", "-t", acpRun.sessionName]).catch(
      () => {},
    );
  if (run)
    await exec("tmux", ["kill-session", "-t", run.sessionName]).catch(
      () => undefined,
    );
  if (chrome && chrome.exitCode === null) {
    const stopped = new Promise((done) => chrome.once("exit", done));
    chrome.kill("SIGTERM");
    await stopped;
  }
  await stopServer();
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
