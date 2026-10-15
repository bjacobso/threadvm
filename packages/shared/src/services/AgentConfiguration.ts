import { Context, Effect, Layer, Schema } from "effect";
import { parse, stringify } from "yaml";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentProfile, SandboxProfile } from "../domain/runtime.js";
import { ThoughtsRepo, outlineIO, OutlineError } from "./ThoughtsRepo.js";
const Configuration = Schema.Struct({
  agents: Schema.Record(
    Schema.String,
    Schema.Struct({
      kind: Schema.optional(Schema.Literals(["acp", "terminal"])),
      acp: Schema.optional(
        Schema.Struct({
          command: Schema.String,
          args: Schema.optional(Schema.Array(Schema.String)),
          env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
        }),
      ),
      install: Schema.optional(Schema.String),
    }),
  ),
  sandboxes: Schema.Record(Schema.String, SandboxProfile),
  defaults: Schema.Struct({ sandbox: Schema.String }),
});
export const defaultAgents = {
  agents: {
    claude: {
      acp: { command: "claude-agent-acp" },
      install: "npm install -g @agentclientprotocol/claude-agent-acp@0.91.0",
    },
    codex: {
      acp: { command: "codex-acp" },
      install: "npm install -g @agentclientprotocol/codex-acp@2.2.2",
    },
    shell: { kind: "terminal" },
    conductor: { acp: { command: "claude-agent-acp" } },
  },
  sandboxes: {
    local: { provider: "local" },
    exe: { provider: "exe" },
    vercel: { provider: "vercel" },
    cloudflare: { provider: "cloudflare" },
  },
  defaults: { sandbox: "local" },
};
export class AgentConfiguration extends Context.Service<
  AgentConfiguration,
  {
    readonly init: Effect.Effect<void, OutlineError>;
    readonly names: Effect.Effect<ReadonlyArray<string>, OutlineError>;
    readonly resolve: (
      name: string,
      override?: string,
    ) => Effect.Effect<
      { profile: AgentProfile; sandbox: SandboxProfile; sandboxName: string },
      OutlineError
    >;
  }
>()("AgentConfiguration") {}
export const AgentConfigurationLive = Layer.effect(
  AgentConfiguration,
  Effect.gen(function* () {
    const repo = yield* ThoughtsRepo;
    const configPath = join(repo.dir, "agents.yaml");
    const read = outlineIO(async () =>
      Schema.decodeUnknownSync(Configuration)(
        parse(
          await readFile(configPath, "utf8").catch((e) => {
            if (e.code === "ENOENT") return stringify(defaultAgents);
            throw e;
          }),
        ),
      ),
    );
    return {
      names: read.pipe(Effect.map((config) => Object.keys(config.agents))),
      init: repo.withLock(
        Effect.gen(function* () {
          const exists = yield* outlineIO(() =>
            readFile(configPath, "utf8").then(
              () => true,
              (e) => {
                if (e.code === "ENOENT") return false;
                throw e;
              },
            ),
          );
          if (exists) return;
          yield* outlineIO(() =>
            writeFile(configPath, stringify(defaultAgents)),
          );
          yield* repo.git(["add", "--", "agents.yaml"]);
          yield* repo.git([
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--no-verify",
            "--only",
            "-m",
            "Configure agent and sandbox profiles",
            "--",
            "agents.yaml",
          ]);
        }),
      ),
      resolve: (name, override) =>
        Effect.gen(function* () {
          const config = yield* read,
            [id, inlineSandbox] = name.split("/"),
            sandboxName = override ?? inlineSandbox ?? config.defaults.sandbox;
          const agent =
              config.agents[id!] ??
              (id === "acp"
                ? { acp: { command: "claude-agent-acp" } }
                : undefined),
            sandbox = config.sandboxes[sandboxName];
          if (!agent || !sandbox)
            return yield* Effect.fail(
              new OutlineError(
                `Unavailable agent/sandbox profile: ${name}/${sandboxName}`,
              ),
            );
          // Explicit legacy shim configurations remain usable during migration.
          const legacy = yield* outlineIO(async () => {
            for (const path of [
              join(repo.dir, `acp-${id === "conductor" ? "claude" : id}.json`),
              ...(id === "claude" || id === "conductor" || id === "acp"
                ? [join(repo.dir, "acp.json")]
                : []),
            ])
              try {
                return JSON.parse(await readFile(path, "utf8")) as {
                  command: string;
                  args: string[];
                };
              } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
              }
            return undefined;
          });
          const command = legacy ?? agent.acp;
          return {
            profile: new AgentProfile({
              id: id!,
              kind: agent.kind === "terminal" ? "terminal" : "acp",
              ...(command ?? {}),
            }),
            sandbox,
            sandboxName,
          };
        }),
    };
  }),
);
