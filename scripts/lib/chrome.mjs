import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function until(predicate, label, timeout = 15000) {
  const end = Date.now() + timeout;
  let error;
  while (Date.now() < end) {
    try {
      if (await predicate()) return;
    } catch (cause) {
      error = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`, { cause: error });
}

export async function withChrome(fn) {
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), "threadvm-site-chrome-"));
  const chrome = spawn(
    process.env.CHROME_BIN || "google-chrome",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let socket;
  try {
    let launchError;
    chrome.on("error", (error) => {
      launchError = error;
    });
    await until(async () => {
      if (launchError) throw launchError;
      return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
    }, "Chrome ready");
    const target = await fetch(
      `http://127.0.0.1:${port}/json/new?about:blank`,
      { method: "PUT" },
    ).then((r) => r.json());
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
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
          waiter?.reject(new Error(JSON.stringify(message.error)));
        else waiter?.resolve(message.result);
      }
      if (message.method === "Runtime.exceptionThrown")
        errors.push(message.params.exceptionDetails.text);
    };
    const cdp = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const key = ++id;
        pending.set(key, { resolve, reject });
        socket.send(JSON.stringify({ id: key, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await cdp("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const resize = (width, height = 960) =>
      cdp("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    const navigate = async (url) => {
      await cdp("Page.navigate", { url });
      await until(
        () =>
          evaluate(
            `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`,
          ),
        "page loaded",
      );
      await evaluate("document.fonts.ready.then(() => true)");
    };
    const capture = async (path, fullPage = false) => {
      await evaluate("document.fonts.ready.then(() => true)");
      const params = { format: "png", captureBeyondViewport: fullPage };
      if (fullPage) {
        const { cssContentSize } = await cdp("Page.getLayoutMetrics");
        params.clip = {
          x: 0,
          y: 0,
          width: cssContentSize.width,
          height: cssContentSize.height,
          scale: 1,
        };
      }
      const { data } = await cdp("Page.captureScreenshot", params);
      await writeFile(path, Buffer.from(data, "base64"));
    };
    await cdp("Runtime.enable");
    await cdp("Page.enable");
    await resize(1440);
    return await fn({ cdp, evaluate, resize, navigate, capture, errors });
  } finally {
    socket?.close();
    if (chrome.exitCode === null) {
      const closed = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill("SIGTERM");
      await closed;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
