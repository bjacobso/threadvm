#!/usr/bin/env node
import { serveMcp } from "./mcp.js";
import { AgentConfiguration } from "@threadvm/shared/services/AgentConfiguration";
import { Effect, Schema } from "effect";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  OperationBatch,
  RunControlRequest,
  ObserveRequest,
  ReviewRequest,
  Agent,
} from "@threadvm/shared/domain";
import {
  OutlineStore,
  renderMarkdown,
} from "@threadvm/shared/services/OutlineStore";
import {
  ThoughtsRepo,
  OutlineError,
} from "@threadvm/shared/services/ThoughtsRepo";
import { AgentRuns } from "@threadvm/shared/services/AgentRuns";
import { RunEventLog } from "@threadvm/shared/services/RunEventLog";
import { OutlineServicesLive } from "@threadvm/shared/services/OutlineServices";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`Missing value for ${name}`);
  args.splice(index, 2);
  return value;
};
const projectDir = resolve(
  option("--dir") ?? process.env.THREADVM_PROJECT_DIR ?? process.cwd(),
);
const agentOption = option("--agent") ?? "shell";
const dataOption = option("--data");
const kind = option("--kind") ?? "observation";
const exitCodeOption = option("--exit-code");
const command = args.shift() ?? "web";
const runId = process.env.THREADVM_RUN_ID;
const capability = process.env.THREADVM_RUN_CAPABILITY;
const jsonInput = async (file: string | undefined) => {
  if (!file) throw new Error("Provide a JSON file or - for stdin");
  let text: string;
  if (file === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    text = Buffer.concat(chunks).toString("utf8");
  } else text = await readFile(resolve(file), "utf8");
  return JSON.parse(text) as unknown;
};
const print = (value: unknown) =>
  console.log(
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
const denied = () => {
  throw new Error(
    "Agent runs may only read the outline, propose changes, and observe their own run. Human approval is required for this command.",
  );
};

try {
  if (runId && !["outline", "propose", "observe", "mcp"].includes(command))
    denied();
  if (command === "web" || command === "dev" || command === "open") {
    process.env.THREADVM_PROJECT_DIR =
      command === "open" ? resolve(args[0] ?? projectDir) : projectDir;
    if (command === "open") {
      const url = `http://127.0.0.1:${process.env.THREADVM_PORT ?? "3333"}`;
      console.log(`Opening ${process.env.THREADVM_PROJECT_DIR} at ${url}`);
      setTimeout(() => {
        const browser = spawn(
          process.platform === "darwin" ? "open" : "xdg-open",
          [url],
          { stdio: "ignore", detached: true },
        );
        browser.on("error", () => console.log(`Open ${url} in your browser`));
        browser.unref();
      }, 1000).unref();
    }
    await import("@threadvm/server");
  } else {
    const work = Effect.gen(function* () {
      const store = yield* OutlineStore;
      const repo = yield* ThoughtsRepo;
      const runs = yield* AgentRuns;
      switch (command) {
        case "mcp": {
          const target = option("--run") ?? runId;
          if (!target || (runId && target !== runId))
            throw new Error("MCP needs its own --run ID");
          yield* serveMcp(target, capability);
          break;
        }
        case "init": {
          const snapshot = yield* store.init;
          yield* (yield* AgentConfiguration).init;
          print(snapshot);
          break;
        }
        case "outline": {
          const verb = args.shift() ?? "show";
          if (verb === "show") {
            const snapshot = yield* store.read;
            if (args.includes("--markdown")) print(renderMarkdown(snapshot));
            else
              print({
                projectDir: repo.projectDir,
                snapshot,
                runs: yield* runs.list,
                events: yield* (yield* RunEventLog).read,
              });
          } else if (verb === "apply") {
            if (runId) denied();
            const batch = yield* Effect.tryPromise(() => jsonInput(args[0]));
            print(
              yield* store.apply(
                yield* Schema.decodeUnknownEffect(OperationBatch)(batch),
              ),
            );
          } else
            throw new Error(
              "Usage: threadvm outline show [--markdown] | apply <batch.json|->",
            );
          break;
        }
        case "propose": {
          if (runId) yield* runs.authorize(runId, capability);
          const batch = yield* Schema.decodeUnknownEffect(OperationBatch)(
            yield* Effect.tryPromise(() => jsonInput(args[0])),
          );
          print(yield* store.propose(batch, runId));
          break;
        }
        case "proposal": {
          const decision = args.shift();
          if (decision !== "accept" && decision !== "reject")
            throw new Error(
              "Usage: threadvm proposal accept|reject <proposalId> [nodeId ...]",
            );
          const proposalId = args.shift();
          print(
            yield* store.review(
              yield* Schema.decodeUnknownEffect(ReviewRequest)({
                proposalId,
                decision,
                nodeIds: args.length ? args : undefined,
              }),
            ),
          );
          break;
        }
        case "run": {
          const agent = yield* Schema.decodeUnknownEffect(Agent)(agentOption);
          print(
            yield* runs.start(args[0], agent, {
              sandbox: option("--sandbox"),
              persistent: args.includes("--persistent"),
            }),
          );
          break;
        }
        case "cancel":
        case "permission": {
          yield* runs.control(
            yield* Schema.decodeUnknownEffect(RunControlRequest)({
              runId: args[0],
              action: command === "cancel" ? "cancel" : "permission",
              requestId: args[1],
              optionId: args[2],
            }),
          );
          print({ queued: true });
          break;
        }
        case "observe": {
          if (runId && args[0] !== runId) denied();
          // Human CLI observations use the same run capability; it never enters Git.
          const token =
            capability ??
            (yield* Effect.tryPromise(() =>
              readFile(
                resolve(repo.dir, "runs", args[0], "capability"),
                "utf8",
              ),
            ));
          const request = yield* Schema.decodeUnknownEffect(ObserveRequest)({
            runId: args[0],
            message: args[1],
            kind,
            capability: token,
            agent:
              dataOption === undefined
                ? undefined
                : dataOption === "-"
                  ? yield* Effect.tryPromise(() => jsonInput("-"))
                  : JSON.parse(dataOption),
            codeSha: kind === "commit" ? args[1] : undefined,
            exitCode:
              exitCodeOption === undefined ? undefined : Number(exitCodeOption),
          });
          yield* runs.observe(request);
          print({ recorded: true });
          break;
        }
        case "remote": {
          if (args[0] !== "add" || !args[1] || !args[2])
            throw new Error("Usage: threadvm remote add <name> <url>");
          print(yield* repo.remoteAdd(args[1], args[2]));
          break;
        }
        case "push":
          print(yield* repo.push(args[0], args[1]));
          break;
        default:
          return yield* Effect.fail(
            new OutlineError(
              "Usage: threadvm init|open|web|outline|propose|proposal|observe|run|cancel|permission|remote add|push",
            ),
          );
      }
    });
    const dir =
      command === "init" ? resolve(args[0] ?? projectDir) : projectDir;
    await Effect.runPromise(
      work.pipe(Effect.provide(OutlineServicesLive(dir))),
    );
  }
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
}
