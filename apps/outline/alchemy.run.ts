// One Worker serves the Foldkit client from `dist` and routes each outline's
// WebSocket to that outline's Durable Object. `pnpm deploy` builds the client
// first; `pnpm dev:worker` runs the same stack locally with local state.
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import Api from "./src/worker/Api.ts";

export default Alchemy.Stack(
  "ThreadvmOutline",
  {
    providers: Cloudflare.providers(),
    state: process.env.ALCHEMY_LOCAL_STATE ? Alchemy.localState() : Cloudflare.state(),
  },
  Effect.gen(function* () {
    const api = yield* Api;
    return { url: api.url };
  }),
);
