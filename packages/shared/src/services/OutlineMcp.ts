import { Context, Effect, Layer, Schema } from "effect";
import { OperationBatch, ObserveRequest } from "../domain/outline.js";
import { AgentRuns } from "./AgentRuns.js";
import { OutlineStore } from "./OutlineStore.js";
import { OutlineError } from "./ThoughtsRepo.js";
const operationSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: { enum: ["insert", "update", "move", "delete"] },
    id: { type: "string" },
    parent: { type: ["string", "null"] },
    after: { type: ["string", "null"] },
    node: {
      type: "object",
      required: ["id", "text", "done"],
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        done: { type: "boolean" },
      },
    },
    patch: {
      type: "object",
      properties: { text: { type: "string" }, done: { type: "boolean" } },
    },
  },
};
const tools = [
  {
    name: "outline.read",
    description:
      "Read the canonical outline, revision and reviewable proposals. Use a fresh revision before proposing.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "outline.propose",
    description:
      "Submit an operation batch for human review. Never applies or accepts the proposal. IDs are immutable. Insert parent null means root; omitted after appends.",
    inputSchema: {
      type: "object",
      required: ["baseRevision", "operations"],
      properties: {
        baseRevision: { type: "integer", minimum: 0 },
        operations: { type: "array", items: operationSchema },
      },
    },
  },
  {
    name: "run.observe",
    description:
      "Record progress or a commit/PR link for this run only. Does not change the outline or launch another agent.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string" },
        kind: { enum: ["observation", "output", "commit", "pr"] },
        codeSha: { type: "string" },
      },
    },
  },
];
export class OutlineMcp extends Context.Service<
  OutlineMcp,
  {
    readonly request: (
      runId: string,
      capability: string | undefined,
      input: unknown,
    ) => Effect.Effect<unknown, OutlineError>;
  }
>()("OutlineMcp") {}
export const OutlineMcpLive = Layer.effect(
  OutlineMcp,
  Effect.gen(function* () {
    const runs = yield* AgentRuns,
      store = yield* OutlineStore;
    return {
      request: (runId, capability, input) =>
        Effect.gen(function* () {
          yield* runs.authorize(runId, capability);
          const request = input as {
            jsonrpc?: string;
            id?: string | number;
            method?: string;
            params?: {
              name?: string;
              arguments?: unknown;
              protocolVersion?: string;
            };
          };
          if (!request || request.jsonrpc !== "2.0")
            return {
              jsonrpc: "2.0",
              id: request?.id ?? null,
              error: { code: -32600, message: "Invalid JSON-RPC request" },
            };
          if (request.id === undefined) return undefined;
          const respond = (result: unknown) => ({
            jsonrpc: "2.0",
            id: request.id,
            result,
          });
          if (request.method === "initialize")
            return respond({
              protocolVersion: request.params?.protocolVersion ?? "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "threadvm", version: "0.0.0" },
            });
          if (request.method === "ping") return respond({});
          if (request.method === "tools/list") return respond({ tools });
          if (request.method !== "tools/call")
            return {
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32601, message: "Method not found" },
            };
          const call = Effect.gen(function* () {
            switch (request.params?.name) {
              case "outline.read":
                return yield* store.read;
              case "outline.propose": {
                const batch = yield* Schema.decodeUnknownEffect(OperationBatch)(
                  request.params.arguments,
                ).pipe(Effect.mapError((e) => new OutlineError(e.message)));
                return yield* store.propose(batch, runId);
              }
              case "run.observe": {
                const args = yield* Schema.decodeUnknownEffect(
                  Schema.Struct({
                    message: Schema.String,
                    kind: Schema.optional(
                      Schema.Literals([
                        "observation",
                        "output",
                        "commit",
                        "pr",
                      ]),
                    ),
                    codeSha: Schema.optional(Schema.String),
                  }),
                )(request.params.arguments).pipe(
                  Effect.mapError((e) => new OutlineError(e.message)),
                );
                yield* runs.observe(
                  new ObserveRequest({
                    ...args,
                    kind: args.kind ?? "observation",
                    runId,
                    capability,
                  }),
                );
                return { recorded: true };
              }
              default:
                return yield* Effect.fail(new OutlineError("Unknown tool"));
            }
          });
          return respond(
            yield* call.pipe(
              Effect.match({
                onSuccess: (value) => ({
                  content: [{ type: "text", text: JSON.stringify(value) }],
                }),
                onFailure: (e) => ({
                  isError: true,
                  content: [{ type: "text", text: e.message }],
                }),
              }),
            ),
          );
        }),
    };
  }),
);
