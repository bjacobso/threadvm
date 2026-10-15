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
    () => evaluate("document.body.innerText.includes('Your first intention')"),
    "Foldkit empty state",
  );
  await clickText("Your first intention");
  await until(
    () => evaluate("!!document.querySelector('.fw-outliner__text')"),
    "Foldworks editor mounted",
  );
  await cdp("Input.insertText", {
    text: "Build a protocol-independent agent harness",
  });
  await key("Enter");
  await until(
    () =>
      evaluate(
        "document.activeElement?.tagName === 'TEXTAREA' && document.activeElement.value === ''",
      ),
    "caret moves into the new bullet",
  );
  await cdp("Input.insertText", { text: "Connect the local agent substrate" });
  await key("Tab");
  await until(async () => {
    const s = await view();
    return (
      s.snapshot.nodes.length === 2 &&
      s.snapshot.nodes.some((n) => n.parent !== null)
    );
  }, "human typing + Tab persisted as operations");
  let state = await view();
  const rootId = state.snapshot.nodes.find((n) => n.parent === null).id;
  const delegatedId = state.snapshot.nodes.find((n) => n.parent !== null).id;
  await key("Tab", 8);
  await until(
    async () =>
      (await view()).snapshot.nodes.find((n) => n.id === delegatedId).parent ===
      null,
    "Shift-Tab outdent",
  );
  await key("Tab");
  await until(
    async () =>
      (await view()).snapshot.nodes.find((n) => n.id === delegatedId).parent ===
      rootId,
    "Tab indent",
  );
  await click(`[data-outline-row="${delegatedId}"] [role="checkbox"]`);
  await until(
    async () =>
      (await view()).snapshot.nodes.find((n) => n.id === delegatedId).done,
    "checked state persisted",
  );
  // /run opens explicit approval and is stripped from intent before launch.
  await evaluate(
    `(() => { const el = document.querySelector('[data-outline-row="${delegatedId}"] textarea'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); })()`,
  );
  await cdp("Input.insertText", { text: " /run" });
  await key("Enter");
  await until(
    () =>
      evaluate("document.body.innerText.includes('Delegate this intention')"),
    "/run opens delegation controls",
  );
  // Start a real shell from the row. It has an actual worktree and tmux pane.
  await until(
    () =>
      evaluate(
        `![...document.querySelectorAll('[data-outline-row="${delegatedId}"] button')].find(e => e.textContent.trim() === 'Start shell run')?.disabled`,
      ),
    "saved before delegation",
  );
  await pointerClick(
    `[...document.querySelectorAll('[data-outline-row="${delegatedId}"] button')].find(e => e.textContent.trim() === 'Start shell run')`,
  );
  await until(
    async () => (await view()).runs.length === 1,
    "real shell run starts from Foldkit",
  );
  run = (await view()).runs[0];
  await clickText("Attach terminal");
  await until(
    () =>
      evaluate(
        "!!document.querySelector('iframe')?.contentDocument?.querySelector('.xterm')",
      ),
    "existing terminal mounted below bullet",
  );
  await until(
    () =>
      evaluate(
        "document.querySelector('iframe').contentDocument.body.innerText.toLowerCase().includes('attached')",
      ),
    "TerminalBridge connected",
  );
  await evaluate(
    "document.querySelector('iframe').contentDocument.querySelector('.xterm-helper-textarea').focus()",
  );
  await cdp("Input.insertText", { text: "printf 'FOLDKIT_REAL_TMUX_OK\\n'" });
  await key("Enter");
  await until(
    async () =>
      (
        await exec("tmux", ["capture-pane", "-p", "-t", run.sessionName])
      ).stdout.includes("FOLDKIT_REAL_TMUX_OK"),
    "keyboard reaches real tmux",
  );
  await invoke(
    "observe",
    run.id,
    "Terminal attached through the existing local harness",
  );
  await until(
    () =>
      evaluate(
        "document.body.innerText.includes('Terminal attached through the existing local harness')",
      ),
    "observations render",
  );
  await screenshot("plan4-foldkit-running.png");
  // Configure the explicitly labelled deterministic ACP peer, then exercise UI permissions.
  await writeFile(
    join(project, ".threadvm/acp.json"),
    JSON.stringify({
      command: process.execPath,
      args: [join(root, "scripts/acp_fixture.mjs"), delegatedId],
    }),
  );
  await evaluate(
    "(() => { const select = document.querySelector('[aria-label=Executor]'); select.value = 'acp'; select.dispatchEvent(new Event('change', { bubbles: true })); })()",
  );
  await until(
    () => evaluate("document.body.innerText.includes('Run acp')"),
    "ACP executor selected",
  );
  await pointerClick(
    `[...document.querySelectorAll('[data-outline-row="${delegatedId}"] button')].find(e => e.textContent.trim() === 'Run acp')`,
  );
  await until(
    () => evaluate("document.body.innerText.includes('Allow once')"),
    "ACP permission appears under delegated bullet",
  );
  acpRun = (await view()).runs.find((r) => r.agent === "acp");
  await screenshot("plan4-acp-permission.png");
  const acpPanePid = (
    await exec("tmux", [
      "display-message",
      "-p",
      "-t",
      acpRun.sessionName,
      "#{pane_pid}",
    ])
  ).stdout;
  await stopServer();
  server = startServer("web");
  await until(
    async () => (await fetch(`${url}/api/outline`)).ok,
    "restart while ACP waits on permission",
  );
  await cdp("Page.reload");
  await until(
    () => evaluate("document.body.innerText.includes('Allow once')"),
    "pending ACP permission recovered",
  );
  assert.equal(
    (
      await exec("tmux", [
        "display-message",
        "-p",
        "-t",
        acpRun.sessionName,
        "#{pane_pid}",
      ])
    ).stdout,
    acpPanePid,
  );
  await clickText("Allow once");
  await until(
    () => evaluate("document.body.innerText.includes('Review harness proof')"),
    "agent CLI proposal renders inline",
  );
  await screenshot("plan4-foldkit-proposal.png");
  const proposal = (await view()).snapshot.proposals.find(
    (p) => p.runId === acpRun.id,
  );
  await click(`[data-suggestion="${proposal.pending[0]}"] button`);
  await until(
    async () =>
      (await view()).snapshot.proposals.find((p) => p.id === proposal.id)
        .pending.length === 1,
    "per-node acceptance",
  );
  await until(
    () =>
      evaluate(
        "![...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Reject batch')?.disabled",
      ),
    "review acknowledged",
  );
  await clickText("Reject batch");
  await until(
    async () =>
      (await view()).snapshot.proposals.find((p) => p.id === proposal.id)
        .pending.length === 0,
    "batch rejection",
  );
  const panePid = (
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
    "server restart",
  );
  await cdp("Page.reload");
  await until(
    () => evaluate("document.body.innerText.includes('shell · running')"),
    "outline and run recover after browser + server restart",
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
    panePid,
  );
  await until(
    () =>
      evaluate(
        "[...document.querySelectorAll('.fw-outliner__text')].some(e => e.value === 'Review harness proof')",
      ),
    "accepted proposal recovered",
  );
  await cdp("Page.navigate", { url: `${url}/inventory` });
  await until(
    () =>
      evaluate(`!!document.querySelector('[aria-label="Create ThreadVM"]')`),
    "exe.dev inventory reachable",
  );
  await exec("tmux", ["kill-session", "-t", acpRun.sessionName]).catch(
    () => {},
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS Foldkit local harness: human ops, nesting, done, worktree/tmux, terminal input, observations, ACP permission, agent CLI proposal, partial and batch review, browser/server recovery, VM inventory. Screenshots: .context/plan4-foldkit-*.png, .context/plan4-acp-permission.png",
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
