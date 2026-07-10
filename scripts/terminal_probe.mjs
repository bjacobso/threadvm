import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";

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

const main = async () => {
  const port = await findPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDir = await mkdtemp(join(tmpdir(), "threadvm-terminal-probe-"));
  const projectsFile = join(tempDir, "projects.yaml");
  const storeFile = join(tempDir, "store.json");

  await writeFile(projectsFile, "projects: {}\n", "utf8");

  const server = spawn("node", ["apps/server/dist/main.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      THREADVM_PORT: String(port),
      THREADVM_PROJECTS_FILE: projectsFile,
      THREADVM_STORE_FILE: storeFile,
      THREADVM_EXEDEV_MOCK: "1",
      THREADVM_TERMINAL_COMMAND:
        "while IFS= read -r line; do printf 'probe:%s\\n' \"$line\"; done"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let serverOutput = "";
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString("utf8");
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString("utf8");
  });

  try {
    await waitFor(
      async () => {
        const response = await fetch(`${baseUrl}/api/threadvms`);
        return response.ok;
      },
      "server startup"
    );

    const threadVms = await apiJson(baseUrl, "/api/threadvms");
    const threadVm = threadVms.find((vm) => vm.id === "terminal-probe");
    if (!threadVm) {
      throw new Error(`mock terminal-probe VM missing: ${JSON.stringify(threadVms)}`);
    }

    const firstAttach = await apiJson(baseUrl, "/api/terminal/attach", {
      method: "POST",
      body: JSON.stringify({ threadVmId: threadVm.id })
    });
    if (firstAttach.reused !== false || firstAttach.status !== "running") {
      throw new Error(`unexpected first attach: ${JSON.stringify(firstAttach)}`);
    }

    const input = await apiJson(baseUrl, firstAttach.inputUrl, {
      method: "POST",
      body: JSON.stringify({ data: "ping\n" })
    });
    if (input.ok !== true) {
      throw new Error(`input failed: ${JSON.stringify(input)}`);
    }

    const secondAttach = await apiJson(baseUrl, "/api/terminal/attach", {
      method: "POST",
      body: JSON.stringify({ threadVmId: threadVm.id })
    });
    if (
      secondAttach.reused !== true ||
      secondAttach.sessionId !== firstAttach.sessionId
    ) {
      throw new Error(`terminal session was not reused: ${JSON.stringify(secondAttach)}`);
    }

    const resize = await apiJson(baseUrl, firstAttach.resizeUrl, {
      method: "POST",
      body: JSON.stringify({ cols: 101, rows: 31 })
    });
    if (resize.ok !== true) {
      throw new Error(`resize failed: ${JSON.stringify(resize)}`);
    }

    const close = await apiJson(baseUrl, firstAttach.closeUrl, {
      method: "DELETE"
    });
    if (close.ok !== true) {
      throw new Error(`close failed: ${JSON.stringify(close)}`);
    }

    console.log("terminal probe ok");
  } catch (error) {
    console.error(serverOutput);
    throw error;
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
