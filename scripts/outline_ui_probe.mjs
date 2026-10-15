import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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
        THREADVM_UI: "legacy",
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
    height: 1120,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(
    () => evaluate("document.body.innerText.includes('Create first bullet')"),
    "outline empty state",
  );
  await clickText("Create first bullet");
  await until(
    async () => (await view()).snapshot.nodes.length === 1,
    "first human insert",
  );
  let state = await view();
  const rootId = state.snapshot.nodes[0].id;
  await input(rootId, "Implement authorization");
  await key("Enter");
  await until(
    async () => (await view()).snapshot.nodes.length === 2,
    "Enter inserts sibling",
  );
  state = await view();
  const contractId = state.snapshot.nodes[1].id;
  await input(contractId, "Define authorization contract");
  await key("Tab");
  await until(
    async () =>
      (await view()).snapshot.nodes.find((n) => n.id === contractId).parent ===
      rootId,
    "Tab indents",
  );
  await until(
    () =>
      evaluate(
        `document.activeElement?.getAttribute("aria-label") === ${JSON.stringify(`Edit ${contractId}`)}`,
      ),
    "focus survives indentation",
  );
  await key("Tab", 8);
  await until(
    async () =>
      (await view()).snapshot.nodes.find((n) => n.id === contractId).parent ===
      null,
    "Shift-Tab outdents",
  );
  await click(`[aria-label="Indent ${contractId}"]`);
  await until(
    async () =>
      (await view()).snapshot.nodes.find((n) => n.id === contractId).parent ===
      rootId,
    "indent button",
  );
  await click(`[aria-label="Toggle done ${contractId}"]`);
  await until(
    async () =>
      (await view()).snapshot.nodes.find((n) => n.id === contractId).done,
    "done toggle",
  );
  await click(`[aria-label="Add child ${rootId}"]`);
  await until(
    async () => (await view()).snapshot.nodes.length === 3,
    "child insert",
  );
  state = await view();
  const delegatedId = state.snapshot.nodes.find(
    (n) => ![rootId, contractId].includes(n.id),
  ).id;
  await input(delegatedId, "Implement policy middleware");
  await evaluate("document.activeElement.blur()");
  await until(
    async () =>
      (await view()).snapshot.nodes.find((n) => n.id === delegatedId).text ===
      "Implement policy middleware",
    "edit saved",
  );
  state = await view();
  const file = join(temp, "proposal.json");
  await writeFile(
    file,
    JSON.stringify({
      baseRevision: state.snapshot.revision,
      operations: [
        {
          type: "insert",
          parent: delegatedId,
          node: {
            id: "integration",
            text: "Write integration tests for role boundaries",
            done: false,
          },
        },
        {
          type: "insert",
          parent: rootId,
          node: {
            id: "benchmark",
            text: "Benchmark authorization latency",
            done: false,
          },
        },
      ],
    }),
  );
  const proposal = await invoke("propose", file);
  await until(
    () =>
      evaluate(
        "document.body.innerText.includes('Write integration tests for role boundaries')",
      ),
    "CLI proposal appears inline",
  );
  await screenshot("plan4-inline-proposal.png");
  await click('[data-proposal-node="benchmark"] button');
  await until(
    async () => (await view()).snapshot.nodes.some((n) => n.id === "benchmark"),
    "per-node acceptance",
  );
  assert.deepEqual(
    (await view()).snapshot.proposals.find((p) => p.id === proposal.id).pending,
    ["integration"],
  );
  await click(`[aria-label="Run ${delegatedId}"]`);
  await until(
    () => evaluate("document.body.innerText.includes('Start run')"),
    "run approval controls",
  );
  await clickText("Start run");
  await until(async () => (await view()).runs.length === 1, "UI run starts");
  run = (await view()).runs[0];
  await until(
    () => evaluate("document.body.innerText.includes('Open terminal')"),
    "run panel appears",
  );
  await clickText("Open terminal");
  await until(
    () => evaluate("!!document.querySelector('.xterm')"),
    "xterm mounted",
  );
  await clickText("Attach Terminal");
  await until(
    () =>
      evaluate("document.body.innerText.toLowerCase().includes('attached')"),
    "real WebSocket attached",
  );
  // Send a command through xterm's keyboard into the real local PTY/tmux.
  await evaluate("document.querySelector('.xterm-helper-textarea').focus()");
  await cdp("Input.insertText", { text: "printf 'PLAN4_TERMINAL_OK\\n'" });
  await key("Enter");
  await until(
    async () =>
      (
        await exec("tmux", ["capture-pane", "-p", "-t", run.sessionName])
      ).stdout.includes("PLAN4_TERMINAL_OK"),
    "terminal input reaches tmux",
  );
  await invoke(
    "observe",
    run.id,
    "Reading middleware and checking policy boundaries",
  );
  await until(
    () =>
      evaluate(
        "document.body.innerText.includes('Reading middleware and checking policy boundaries')",
      ),
    "observations appear under run",
  );
  await screenshot("plan4-running-node.png");
  // Refresh reattaches to the same session; server restart recovers files + live tmux.
  await cdp("Page.reload");
  await until(
    () =>
      evaluate("document.body.innerText.toLowerCase().includes('attached')"),
    "browser reload reattaches",
  );
  const sessionPid = (
    await exec("tmux", [
      "display-message",
      "-p",
      "-t",
      run.sessionName,
      "#{pane_pid}",
    ])
  ).stdout;
  await stopServer();
  server = startServer("web");
  await until(
    async () => (await fetch(`${url}/api/outline`)).ok,
    "restarted API",
  );
  await cdp("Page.reload");
  await until(
    () =>
      evaluate("document.body.innerText.toLowerCase().includes('attached')"),
    "server restart reattach",
  );
  assert.equal(
    (
      await exec("tmux", [
        "display-message",
        "-p",
        "-t",
        run.sessionName,
        "#{pane_pid}",
      ])
    ).stdout,
    sessionPid,
  );
  assert(
    (await view()).snapshot.proposals.some((p) =>
      p.pending.includes("integration"),
    ),
  );
  await click('[data-proposal-node="integration"] button:last-child');
  await until(
    async () =>
      !(await view()).snapshot.proposals.find((p) => p.id === proposal.id)
        .pending.length,
    "per-node rejection",
  );
  await clickText("VM inventory");
  await until(
    () =>
      evaluate(`!!document.querySelector('[aria-label="Create ThreadVM"]')`),
    "legacy VM inventory reachable",
  );
  await clickText("Outline");
  await until(
    () =>
      evaluate("document.body.innerText.includes('Implement authorization')"),
    "return to outline",
  );
  assert.deepEqual(errors, []);
  assert(!serverLog.includes("[terminal error:"));
  console.log(
    "outline UI probe ok (real Chrome edits, nesting, review, run, WebSocket/xterm, browser+server recovery, VM inventory); screenshots .context/plan4-*.png",
  );
  socket.close();
} catch (error) {
  await writeFile(join(screenshots, "plan4-ui-server.log"), serverLog);
  if (inspectPage) {
    await writeFile(
      join(screenshots, "plan4-ui-failure.txt"),
      (await inspectPage("document.body.innerText")) +
        "\n" +
        JSON.stringify(socketMessages, null, 2),
    );
    const capture = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(screenshots, "plan4-ui-failure.png"),
      Buffer.from(capture.data, "base64"),
    );
  }
  throw error;
} finally {
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
