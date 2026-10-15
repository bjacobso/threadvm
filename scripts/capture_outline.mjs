// Reproducible captures of the real local app with sample data; no agent credentials needed.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { freePort, until, withChrome } from "./lib/chrome.mjs";

const exec = promisify(execFile);
const root = resolve(".");
const temp = await mkdtemp(join(tmpdir(), "threadvm-capture-"));
const project = join(temp, "little-ideas");
const port = await freePort();
const url = `http://127.0.0.1:${port}`;
const cli = join(root, "apps/cli/dist/main.js");
const output = join(root, "apps/site/public/screenshots");
let server;
let log = "";
const invoke = async (...args) =>
  JSON.parse(
    (await exec(process.execPath, [cli, ...args, "--dir", project])).stdout,
  );
const batch = async (name, value, command) => {
  const path = join(temp, `${name}.json`);
  await writeFile(path, JSON.stringify(value));
  return invoke(...command, path);
};
try {
  await mkdir(project);
  await mkdir(output, { recursive: true });
  await mkdir(".context", { recursive: true });
  await exec("git", ["init", "--initial-branch=main", project]);
  await exec("git", ["-C", project, "config", "user.name", "ThreadVM example"]);
  await exec("git", [
    "-C",
    project,
    "config",
    "user.email",
    "example@localhost",
  ]);
  await writeFile(
    join(project, "README.md"),
    "# Little ideas\nAn example project for the ThreadVM field notes.\n",
  );
  await exec("git", ["-C", project, "add", "README.md"]);
  await exec("git", [
    "-C",
    project,
    "commit",
    "-m",
    "Start with a little idea",
  ]);
  await invoke("init");
  const nodes = [
    ["launch", null, "Make the first five minutes feel effortless"],
    ["context", "launch", "What we want people to feel #context"],
    ["calm", "context", "A quiet place to think, with a clear next step"],
    [
      "small",
      "context",
      "Keep the setup small. Let the outline grow with the idea.",
    ],
    ["welcome", "launch", "Build the welcome screen"],
    ["next", "welcome", "Show one clear next step"],
    ["design", "welcome", "Use the existing design system"],
    ["workflow", "launch", "Connect the outline to the work"],
    ["stable", "workflow", "Give every thought a stable ID"],
    ["workspace", "workflow", "Give each delegated run its own Git worktree"],
    ["terminal", "workflow", "Keep the terminal alive when the browser closes"],
    ["review", "launch", "Keep the human in the loop"],
    ["proposals", "review", "Agents propose changes; people accept them"],
    ["history", "review", "Link thought, execution, and code history"],
    ["questions", null, "Questions worth keeping open"],
    [
      "question1",
      "questions",
      "How much context is enough for a good handoff?",
    ],
    [
      "question2",
      "questions",
      "What should happen when the plan changes mid-run?",
    ],
  ];
  await batch(
    "outline",
    {
      baseRevision: 0,
      operations: nodes.map(([id, parent, text]) => ({
        type: "insert",
        parent,
        node: { id, text, done: false },
      })),
    },
    ["outline", "apply"],
  );
  const snapshot = (await invoke("outline", "show")).snapshot;
  await batch(
    "welcome-proposal",
    {
      baseRevision: snapshot.revision,
      operations: [
        {
          type: "insert",
          parent: "welcome",
          node: {
            id: "welcome-ready",
            text: "Welcome screen ready for review",
            done: false,
          },
        },
        {
          type: "insert",
          parent: "welcome",
          node: {
            id: "keyboard",
            text: "Add a keyboard shortcut to get started",
            done: false,
          },
        },
        { type: "update", id: "next", patch: { done: true } },
      ],
    },
    ["propose"],
  );
  await batch(
    "history-proposal",
    {
      baseRevision: snapshot.revision,
      operations: [
        {
          type: "insert",
          parent: "review",
          node: {
            id: "trace",
            text: "Record the final code commit in each run summary",
            done: false,
          },
        },
      ],
    },
    ["propose"],
  );
  server = spawn(process.execPath, [join(root, "apps/server/dist/main.js")], {
    cwd: root,
    env: {
      ...process.env,
      THREADVM_PROJECT_DIR: project,
      THREADVM_PORT: String(port),
      THREADVM_EXEDEV_MOCK: "1",
      THREADVM_SSH_MOCK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    log += chunk;
  });
  server.stderr.on("data", (chunk) => {
    log += chunk;
  });
  await until(
    async () => (await fetch(`${url}/api/outline`)).ok,
    "local server ready",
  );
  await withChrome(async ({ cdp, capture, evaluate }) => {
    // The outline app rewrites / to its local outline URL.
    await cdp("Page.navigate", { url });
    await until(
      () => evaluate(`document.querySelectorAll('.inbox-card').length === 2`),
      "seeded outline and proposals rendered",
    );
    await capture(".context/outline.png");
    await copyFile(".context/outline.png", join(output, "outline.png"));
    await evaluate(`document.querySelector('.inbox-card__open').click()`);
    await until(
      () =>
        evaluate(
          `document.body.innerText.includes('Submitted through the outline write path')`,
        ),
      "review panel rendered",
    );
    await capture(".context/review.png");
    await copyFile(".context/review.png", join(output, "review.png"));
    console.log(
      "Captured the real local outline and review panel (seeded project; CLI proposals).",
    );
  });
} catch (error) {
  console.error(log);
  throw error;
} finally {
  if (server && server.exitCode === null) {
    const closed = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await closed;
  }
  await rm(temp, { recursive: true, force: true });
}
