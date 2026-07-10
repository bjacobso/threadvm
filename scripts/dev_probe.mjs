import { spawn } from "node:child_process";
import net from "node:net";

const timeoutMs = Number(process.env.THREADVM_DEV_PROBE_TIMEOUT_MS ?? "30000");

const findFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("could not allocate a TCP port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });

const waitForHttp = async (url, expectedText) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok && (!expectedText || body.includes(expectedText))) {
        return;
      }
      lastError = new Error(
        `${url} returned ${response.status} without expected content`
      );
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError ?? new Error(`${url} did not become reachable`);
};

const terminate = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);

  if (
    child.exitCode === null &&
    child.signalCode === null &&
    child.pid !== undefined
  ) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
};

const main = async () => {
  const [apiPort, webPort] = await Promise.all([findFreePort(), findFreePort()]);
  const output = [];
  const env = {
    ...process.env,
    THREADVM_PORT: String(apiPort),
    THREADVM_WEB_PORT: String(webPort),
    FORCE_COLOR: "0",
    NO_COLOR: "1"
  };
  const child = spawn("pnpm", ["dev"], {
    cwd: process.cwd(),
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const collect = (chunk) => {
    output.push(chunk.toString());
    if (output.join("").length > 12000) {
      output.splice(0, output.length - 20);
    }
  };

  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  try {
    await Promise.all([
      waitForHttp(
        `http://127.0.0.1:${apiPort}/docs/openapi.json`,
        '"openapi"'
      ),
      waitForHttp(`http://127.0.0.1:${webPort}/`, "ThreadVM")
    ]);
    console.log(
      `dev probe ok (server http://127.0.0.1:${apiPort}, web http://127.0.0.1:${webPort})`
    );
  } catch (error) {
    console.error("dev probe failed");
    console.error(error instanceof Error ? error.message : String(error));
    console.error(output.join(""));
    process.exitCode = 1;
  } finally {
    await terminate(child);
  }
};

await main();
