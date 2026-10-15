import { Effect } from "effect";
import { createInterface } from "node:readline";
import { OutlineMcp } from "@threadvm/shared/services/OutlineMcp";
/** One capability-scoped MCP connection. stdout is exclusively JSON-RPC. */
export const serveMcp = (runId: string, capability?: string) =>
  Effect.gen(function* () {
    const server = yield* OutlineMcp;
    yield* Effect.tryPromise(async () => {
      for await (const line of createInterface({ input: process.stdin })) {
        let input: unknown;
        try {
          input = JSON.parse(line);
        } catch {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            }) + "\n",
          );
          continue;
        }
        const response = await Effect.runPromise(
          server.request(runId, capability, input),
        );
        if (response !== undefined)
          process.stdout.write(JSON.stringify(response) + "\n");
      }
    });
  });
