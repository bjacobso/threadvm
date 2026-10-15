import { Schema } from "effect";

export const SandboxProviderId = Schema.Literals([
  "local",
  "exe",
  "vercel",
  "cloudflare",
]);
export class AgentProfile extends Schema.Class<AgentProfile>("AgentProfile")({
  id: Schema.String,
  kind: Schema.Literals(["acp", "terminal"]),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}
export class SandboxRef extends Schema.Class<SandboxRef>("SandboxRef")({
  provider: SandboxProviderId,
  id: Schema.String,
  workdir: Schema.String,
  projectDir: Schema.String,
  branch: Schema.String,
  sessionName: Schema.String,
  host: Schema.optional(Schema.String),
  vmId: Schema.optional(Schema.String),
}) {}
export class SandboxProfile extends Schema.Class<SandboxProfile>(
  "SandboxProfile",
)({
  provider: SandboxProviderId,
  baseDevbox: Schema.optional(Schema.String),
  callbackUrl: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  workdir: Schema.optional(Schema.String),
  repository: Schema.optional(Schema.String),
  bootstrap: Schema.optional(Schema.Array(Schema.String)),
}) {}
export class PendingRequest extends Schema.Class<PendingRequest>(
  "PendingRequest",
)({
  id: Schema.String,
  kind: Schema.Literals(["permission", "question"]),
  title: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      kind: Schema.String,
    }),
  ),
  payload: Schema.optional(Schema.Unknown),
  response: Schema.Literals(["live", "message", "expired"]),
}) {}
export class WorkspaceSpec extends Schema.Class<WorkspaceSpec>("WorkspaceSpec")(
  {
    ref: SandboxRef,
    baseRef: Schema.String,
    repository: Schema.optional(Schema.String),
    baseDevbox: Schema.optional(Schema.String),
    bootstrap: Schema.optional(Schema.Array(Schema.String)),
  },
) {}
