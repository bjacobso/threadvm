import { Effect } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { OutlineMcp } from "@threadvm/shared/services/OutlineMcp";
export const McpRoutesLive = HttpRouter.add(
  "POST",
  "/api/runs/:runId/mcp",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const context = yield* HttpRouter.RouteContext;
    const capability = request.headers.authorization?.replace(/^Bearer /, "");
    const input = yield* request.json;
    const result = yield* (yield* OutlineMcp).request(
      context.params.runId!,
      capability,
      input,
    );
    return result === undefined
      ? HttpServerResponse.empty({ status: 202 })
      : HttpServerResponse.jsonUnsafe(result);
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(
        HttpServerResponse.text("Invalid or unauthorized MCP request", {
          status: 403,
        }),
      ),
    ),
  ),
);
