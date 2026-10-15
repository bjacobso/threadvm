import { Effect } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  Sandboxes,
  SandboxProvidersLive,
  type SandboxRef,
  type WorkspaceSpec,
} from "./Sandbox.ts";
const request = JSON.parse(process.argv[2]!) as {
  action: "provision" | "attach" | "exec" | "pty" | "stop";
  ref: SandboxRef;
  spec?: WorkspaceSpec;
  script?: string;
};
NodeRuntime.runMain(
  Effect.gen(function* () {
    const registry = yield* Sandboxes;
    const provider = registry.provider(request.ref.provider);
    const sandbox = yield* request.action === "provision"
      ? provider.provision(request.spec!)
      : provider.attach(request.ref);
    const value =
      request.action === "pty"
        ? yield* sandbox.pty
        : request.action === "exec"
          ? yield* sandbox.exec(request.script!)
          : request.action === "stop"
            ? yield* sandbox.stop
            : sandbox.ref;
    console.log(JSON.stringify(value ?? null));
  }).pipe(
    Effect.provide(SandboxProvidersLive),
    Effect.provide(NodeServices.layer),
  ),
);
