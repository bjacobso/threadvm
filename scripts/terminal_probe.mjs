import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { Effect, Layer, Result } from "effect";
import { ThreadVm } from "../packages/shared/dist/domain/schema.js";
import {
  CommandService,
  CommandServiceLive
} from "../packages/shared/dist/services/CommandService.js";
import {
  RemoteTerminalSessionLive,
  terminalSessionName
} from "../packages/shared/dist/services/RemoteTerminalSession.js";
import { SshServiceLive } from "../packages/shared/dist/services/SshService.js";
import {
  TerminalBridge,
  TerminalBridgeLive
} from "../packages/shared/dist/services/TerminalBridge.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const findPort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("failed to allocate a local port"));
        }
      });
    });
  });

const waitFor = async (predicate, label, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `${label} timed out${lastError ? `: ${lastError.message}` : ""}`
  );
};

const apiJson = async (baseUrl, path, init) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
};

class TerminalSocketClient {
  messages = [];
  output = "";

  constructor(url) {
    this.socket = new WebSocket(url);
    const opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.opened = Promise.race([
      opened,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("terminal WebSocket open timed out")), 8_000)
      )
    ]);
    this.closed = new Promise((resolve) =>
      this.socket.addEventListener(
        "close",
        (event) => {
          this.closeEvent = event;
          resolve(event);
        },
        { once: true }
      )
    );
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      this.messages.push(message);
      if (message.type === "output") {
        this.output += message.data;
      }
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  async waitUntil(predicate, label, timeoutMs = 8_000) {
    await this.opened;
    const result = await waitFor(
      async () => predicate(this),
      label,
      timeoutMs
    );
    return result;
  }

  async close() {
    if (this.socket.readyState >= WebSocket.CLOSING) {
      return;
    }
    const closed = new Promise((resolve) =>
      this.socket.addEventListener("close", resolve, { once: true })
    );
    this.socket.close(1000, "probe-detached");
    await closed;
  }
}

const verifyCommandInterruption = async (tempDir) => {
  const pidFile = join(tempDir, "interrupted-command.pid");
  const commandEffect = Effect.gen(function* () {
    const command = yield* CommandService;
    return yield* command.execFile(
      "sh",
      ["-c", `echo $$ > ${JSON.stringify(pidFile)}; exec sleep 30`],
      { timeoutMs: 30_000 }
    );
  }).pipe(Effect.timeout("200 millis"), Effect.provide(CommandServiceLive));

  await Effect.runPromise(commandEffect).catch(() => undefined);
  const pidText = await waitFor(
    async () => await readFile(pidFile, "utf8").catch(() => undefined),
    "interrupted command pid"
  );
  const pid = Number(pidText.trim());
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    process.kill(pid, 0);
    throw new Error(`interrupted command process ${pid} is still running`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("still running")) {
      throw error;
    }
  }
};

const verifyOutputBackpressure = async (terminalCommandFile) => {
  const threadVmId = `terminal-overflow-${process.pid}-${Date.now()}`;
  const sessionName = terminalSessionName(threadVmId);
  const previousCommand = process.env.THREADVM_TERMINAL_COMMAND;
  const previousLocalTmux = process.env.THREADVM_TERMINAL_LOCAL_TMUX;
  process.env.THREADVM_TERMINAL_LOCAL_TMUX = "1";
  process.env.THREADVM_TERMINAL_COMMAND =
    `exec tmux new-session -A -s \"$THREADVM_SESSION_NAME\" ${JSON.stringify(terminalCommandFile)}`;

  const sshLayer = SshServiceLive.pipe(Layer.provide(CommandServiceLive));
  const remoteLayer = RemoteTerminalSessionLive.pipe(Layer.provide(sshLayer));
  const bridgeLayer = TerminalBridgeLive.pipe(Layer.provide(remoteLayer));
  const program = Effect.scoped(
    Effect.gen(function* () {
      const bridge = yield* TerminalBridge;
      const attachment = yield* bridge.open(
        new ThreadVm({
          id: threadVmId,
          name: threadVmId,
          host: `${threadVmId}.exe.xyz`,
          state: "running",
          source: "mock",
          ports: []
        }),
        {
          attachmentId: `attachment-${threadVmId}`,
          cols: 100,
          rows: 30
        }
      );
      yield* attachment.write("__flood__\n");
      const exit = yield* Effect.result(
        attachment.exited.pipe(Effect.timeout("10 seconds"))
      );
      if (
        Result.isSuccess(exit) ||
        !String(exit.failure.message).includes("output queue overflowed")
      ) {
        throw new Error(
          `terminal output backpressure did not fail visibly: ${JSON.stringify(exit)}`
        );
      }
    })
  ).pipe(Effect.provide(bridgeLayer));

  try {
    await Effect.runPromise(program);
  } finally {
    spawn("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
    if (previousCommand === undefined) {
      delete process.env.THREADVM_TERMINAL_COMMAND;
    } else {
      process.env.THREADVM_TERMINAL_COMMAND = previousCommand;
    }
    if (previousLocalTmux === undefined) {
      delete process.env.THREADVM_TERMINAL_LOCAL_TMUX;
    } else {
      process.env.THREADVM_TERMINAL_LOCAL_TMUX = previousLocalTmux;
    }
  }
};

const main = async () => {
  const firstCollisionName = terminalSessionName("project/feature");
  const secondCollisionName = terminalSessionName("project-feature");
  if (
    firstCollisionName === secondCollisionName ||
    !/^threadvm-[a-z0-9-]+-[a-f0-9]{10}$/.test(firstCollisionName) ||
    !/^threadvm-[a-z0-9-]+-[a-f0-9]{10}$/.test(secondCollisionName)
  ) {
    throw new Error("terminal session names are not safe and collision-resistant");
  }

  const port = await findPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDir = await mkdtemp(join(tmpdir(), "threadvm-terminal-probe-"));
  const threadVmId = `terminal-probe-${process.pid}-${Date.now()}`;
  const projectsFile = join(tempDir, "projects.yaml");
  const storeFile = join(tempDir, "store.json");
  const terminalCommandFile = join(tempDir, "terminal-command.sh");

  await writeFile(projectsFile, "projects: {}\n", "utf8");
  await writeFile(
    storeFile,
    JSON.stringify(
      {
        threadVms: {
          [threadVmId]: {
            id: threadVmId,
            state: "running",
            startingPrompt: "inspect terminal behavior",
            pinned: true,
            ports: [
              {
                label: "dev:3000",
                port: 3000,
                url: "https://terminal-probe.exe.xyz:3000"
              }
            ],
            devLogPath: "/tmp/threadvm/terminal-probe/dev.log",
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    terminalCommandFile,
    [
      "#!/bin/sh",
      "printf '\\033[?1000h\\033[?1006h'",
      "while IFS= read -r line; do",
      "  if [ \"$line\" = \"__flood__\" ]; then",
      "    yes x | head -c 33554432",
      "    continue",
      "  fi",
      "  if [ \"$line\" = \"__size__\" ]; then",
      "    stty size",
      "  else",
      "    printf 'probe:%s\\n' \"$line\"",
      "  fi",
      "done"
    ].join("\n"),
    "utf8"
  );
  await chmod(terminalCommandFile, 0o755);
  await verifyCommandInterruption(tempDir);
  await verifyOutputBackpressure(terminalCommandFile);

  let serverOutput = "";
  const serverEnv = {
    ...process.env,
    THREADVM_PORT: String(port),
    THREADVM_PROJECTS_FILE: projectsFile,
    THREADVM_STORE_FILE: storeFile,
    THREADVM_EXEDEV_MOCK: "1",
    THREADVM_EXEDEV_MOCK_ID: threadVmId,
    THREADVM_EXEDEV_MOCK_NAME: threadVmId,
    THREADVM_EXEDEV_MOCK_HOST: `${threadVmId}.exe.xyz`,
    THREADVM_SSH_MOCK: "1",
    THREADVM_SSH_MOCK_STDOUT: "THREADVM_LOG_FULL\nmock dev log\n",
    THREADVM_TERMINAL_LOCAL_TMUX: "1",
    THREADVM_TERMINAL_COMMAND: `exec tmux new-session -A -s \"$THREADVM_SESSION_NAME\" ${JSON.stringify(terminalCommandFile)}`
  };
  const startServer = () => {
    const process = spawn("node", ["apps/server/dist/main.js"], {
      cwd: repoRoot,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });
    process.stdout.on("data", (chunk) => {
      serverOutput += chunk.toString("utf8");
    });
    process.stderr.on("data", (chunk) => {
      serverOutput += chunk.toString("utf8");
    });
    return process;
  };
  const stopServer = (process) =>
    new Promise((resolve) => {
      if (process.exitCode !== null || process.signalCode !== null) {
        resolve();
        return;
      }
      process.once("exit", resolve);
      process.kill("SIGTERM");
    });
  let server = startServer();

  let remoteSessionName;
  try {
    await waitFor(
      async () => {
        const response = await fetch(`${baseUrl}/api/threadvms`);
        return response.ok;
      },
      "server startup"
    );

    for (const path of ["/", "/threadvms/terminal-probe"]) {
      const response = await fetch(`${baseUrl}${path}`);
      const html = await response.text();
      if (!response.ok || !html.includes("root")) {
        throw new Error(`static app fallback failed for ${path}: ${response.status}`);
      }
    }

    const threadVms = await apiJson(baseUrl, "/api/threadvms");
    const threadVm = threadVms.find((vm) => vm.id === threadVmId);
    if (!threadVm) {
      throw new Error(`mock terminal-probe VM missing: ${JSON.stringify(threadVms)}`);
    }
    if (
      threadVm.startingPrompt !== "inspect terminal behavior" ||
      threadVm.pinned !== true
    ) {
      throw new Error(`intent metadata was not preserved: ${JSON.stringify(threadVm)}`);
    }

    const ports = await apiJson(baseUrl, `/api/threadvms/${threadVm.id}/ports`);
    if (
      ports.threadVmId !== threadVm.id ||
      ports.ports.length !== 1 ||
      ports.ports[0].port !== 3000 ||
      ports.ports[0].status !== "unknown"
    ) {
      throw new Error(`unexpected ports response: ${JSON.stringify(ports)}`);
    }

    const devLog = await apiJson(baseUrl, `/api/threadvms/${threadVm.id}/dev-log`);
    if (
      devLog.threadVmId !== threadVm.id ||
      devLog.path !== "/tmp/threadvm/terminal-probe/dev.log" ||
      devLog.content !== "mock dev log\n" ||
      devLog.truncated !== false
    ) {
      throw new Error(`unexpected dev log response: ${JSON.stringify(devLog)}`);
    }

    const invalidDimensions = await fetch(
      `${baseUrl}/rpc/terminal/${threadVm.id}/socket?cols=0&rows=30`
    );
    if (invalidDimensions.status !== 400) {
      throw new Error(
        `invalid terminal dimensions returned ${invalidDimensions.status}`
      );
    }
    const invalidThreadVmId = await fetch(
      `${baseUrl}/rpc/terminal/%20/socket?cols=100&rows=30`
    );
    if (invalidThreadVmId.status !== 400) {
      throw new Error(
        `invalid ThreadVM ID returned ${invalidThreadVmId.status}`
      );
    }

    const socketUrl = `ws://127.0.0.1:${port}/rpc/terminal/${threadVm.id}/socket?cols=100&rows=30`;
    const first = new TerminalSocketClient(socketUrl);
    const firstReady = await first.waitUntil(
      (client) => client.messages.find((message) => message.type === "ready"),
      "first terminal ready"
    );
    if (firstReady.reused !== false) {
      throw new Error(`unexpected first attach: ${JSON.stringify(firstReady)}`);
    }
    remoteSessionName = firstReady.sessionName;
    await first.waitUntil(
      (client) =>
        client.messages.some(
          (message) => message.type === "status" && message.status === "attached"
        ),
      "first terminal attached"
    );
    first.send({ type: "input", data: "ping\n" });
    await first.waitUntil(
      (client) => client.output.includes("probe:ping"),
      "first terminal input"
    );
    first.send({ type: "resize", cols: 99, rows: 29 });
    first.send({ type: "resize", cols: 120, rows: 40 });
    first.send({ type: "resize", cols: 101, rows: 31 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    first.send({ type: "input", data: "__size__\n" });
    try {
      await first.waitUntil(
        (client) => client.output.includes("30 101"),
        "terminal resize"
      );
    } catch (error) {
      throw new Error(`${error.message}; output=${JSON.stringify(first.output)}`);
    }
    await first.close();

    const second = new TerminalSocketClient(socketUrl);
    const secondReady = await second.waitUntil(
      (client) => client.messages.find((message) => message.type === "ready"),
      "reconnected terminal ready"
    );
    if (
      secondReady.reused !== true ||
      secondReady.sessionName !== firstReady.sessionName
    ) {
      throw new Error(
        `remote tmux session was not reused: ${JSON.stringify(secondReady)}`
      );
    }
    second.send({ type: "input", data: "after-reconnect\n" });
    await second.waitUntil(
      (client) => client.output.includes("probe:after-reconnect"),
      "input after reconnect"
    );
    await second.waitUntil(
      (client) => client.output.includes("\u001b[?1000h"),
      "mouse mode after reconnect"
    );
    second.send({ type: "ping", timestamp: 123 });
    await second.waitUntil(
      (client) =>
        client.messages.some(
          (message) => message.type === "pong" && message.timestamp === 123
        ),
      "terminal pong"
    );
    await second.close();

    for (let cycle = 1; cycle <= 4; cycle += 1) {
      const cycled = new TerminalSocketClient(socketUrl);
      const cycleReady = await cycled.waitUntil(
        (client) => client.messages.find((message) => message.type === "ready"),
        `terminal reconnect cycle ${cycle}`
      );
      if (cycleReady.reused !== true) {
        throw new Error(
          `terminal reconnect cycle ${cycle} did not reuse tmux: ${JSON.stringify(cycleReady)}`
        );
      }
      cycled.send({ type: "input", data: `cycle-${cycle}\n` });
      await cycled.waitUntil(
        (client) => client.output.includes(`probe:cycle-${cycle}`),
        `terminal input cycle ${cycle}`
      );
      await cycled.close();
    }

    const beforeBackendRestart = new TerminalSocketClient(socketUrl);
    await beforeBackendRestart.waitUntil(
      (client) => client.messages.some((message) => message.type === "ready"),
      "terminal ready before backend restart"
    );
    beforeBackendRestart.send({
      type: "input",
      data: "before-server-restart\n"
    });
    await beforeBackendRestart.waitUntil(
      (client) => client.output.includes("probe:before-server-restart"),
      "terminal input before backend restart"
    );
    await stopServer(server);
    await beforeBackendRestart.closed;

    server = startServer();
    await waitFor(
      async () => {
        const response = await fetch(`${baseUrl}/api/threadvms`);
        return response.ok;
      },
      "server restart"
    );
    const afterBackendRestart = new TerminalSocketClient(socketUrl);
    const backendRestartReady = await afterBackendRestart.waitUntil(
      (client) => client.messages.find((message) => message.type === "ready"),
      "terminal ready after backend restart"
    );
    if (
      backendRestartReady.reused !== true ||
      backendRestartReady.sessionName !== remoteSessionName
    ) {
      throw new Error(
        `backend restart did not recover the remote tmux session: ${JSON.stringify(backendRestartReady)}`
      );
    }
    afterBackendRestart.send({
      type: "input",
      data: "after-server-restart\n"
    });
    await afterBackendRestart.waitUntil(
      (client) => client.output.includes("probe:after-server-restart"),
      "terminal input after backend restart"
    );
    await afterBackendRestart.close();

    const replaced = new TerminalSocketClient(socketUrl);
    await replaced.waitUntil(
      (client) => client.messages.some((message) => message.type === "ready"),
      "replaceable terminal ready"
    );
    const replacement = new TerminalSocketClient(socketUrl);
    await replacement.waitUntil(
      (client) => client.messages.some((message) => message.type === "ready"),
      "replacement terminal ready"
    );
    await replaced.closed;
    if (replaced.closeEvent?.reason !== "terminal-replaced") {
      throw new Error(
        `previous attachment was not replaced cleanly: ${replaced.closeEvent?.reason}`
      );
    }
    replacement.send({ type: "input", data: "replacement-active\n" });
    await replacement.waitUntil(
      (client) => client.output.includes("probe:replacement-active"),
      "replacement terminal input"
    );
    await replacement.close();

    const invalidProtocol = new TerminalSocketClient(socketUrl);
    await invalidProtocol.waitUntil(
      (client) => client.messages.some((message) => message.type === "ready"),
      "invalid protocol terminal ready"
    );
    invalidProtocol.send({ type: "not-a-terminal-message" });
    await invalidProtocol.waitUntil(
      (client) => client.messages.some((message) => message.type === "error"),
      "invalid protocol error"
    );
    await invalidProtocol.closed;
    if (invalidProtocol.closeEvent?.code !== 1008) {
      throw new Error(
        `invalid protocol close code was ${invalidProtocol.closeEvent?.code}`
      );
    }

    const restarted = new TerminalSocketClient(`${socketUrl}&restart=1`);
    const restartedReady = await restarted.waitUntil(
      (client) => client.messages.find((message) => message.type === "ready"),
      "restarted terminal ready"
    );
    if (restartedReady.reused !== false) {
      throw new Error(
        `terminal restart reused the old session: ${JSON.stringify(restartedReady)}`
      );
    }
    await restarted.close();

    await waitFor(
      () => {
        const processTable = spawnSync("ps", ["-axo", "command="], {
          encoding: "utf8"
        }).stdout;
        return !processTable
          .split("\n")
          .some(
            (command) =>
              command.includes(remoteSessionName) &&
              !command.startsWith("tmux: server")
          );
      },
      "local terminal attachment cleanup"
    );

    const lifecycleEvents = [
      "Terminal WebSocket opened",
      "Terminal attachment requested",
      "Remote terminal session prepared",
      "Terminal attachment PTY spawned",
      "Terminal client reached ready state",
      "Terminal attachment PTY exited",
      "Terminal WebSocket closed",
      "Terminal attachment cleanup completed"
    ];
    await waitFor(
      () => lifecycleEvents.every((event) => serverOutput.includes(event)),
      "terminal lifecycle logs"
    );
    for (const terminalInput of [
      "replacement-active",
      "before-server-restart",
      "after-server-restart"
    ]) {
      if (serverOutput.includes(terminalInput)) {
        throw new Error(`terminal input leaked into logs: ${terminalInput}`);
      }
    }

    console.log("terminal probe ok");
  } catch (error) {
    console.error(serverOutput);
    throw error;
  } finally {
    if (remoteSessionName) {
      spawn("tmux", ["kill-session", "-t", remoteSessionName], {
        stdio: "ignore"
      });
    }
    await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
