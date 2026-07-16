import { Schema } from "effect";

export class Project extends Schema.Class<Project>("Project")({
  id: Schema.String,
  repo: Schema.String,
  defaultBranch: Schema.String,
  baseDevbox: Schema.optional(Schema.String),
  image: Schema.optional(Schema.String),
  workdir: Schema.String,
  workspaceRoot: Schema.optional(Schema.String),
  branchPrefix: Schema.optional(Schema.String),
  bootstrap: Schema.Array(Schema.String),
  dev: Schema.Struct({
    command: Schema.String,
    cwd: Schema.optional(Schema.String),
    ports: Schema.Array(Schema.Number)
  }),
  herdr: Schema.Struct({
    install: Schema.Literals(["manual", "auto", "never"]),
    sessionPrefix: Schema.String
  }),
  agents: Schema.Struct({
    default: Schema.String,
    panes: Schema.Array(
      Schema.Struct({
        label: Schema.String,
        command: Schema.String,
        cwd: Schema.optional(Schema.String)
      })
    )
  }),
  configKind: Schema.optional(Schema.Literals(["legacy", "harness"]))
}) {}

export class Port extends Schema.Class<Port>("Port")({
  label: Schema.String,
  port: Schema.Number,
  url: Schema.String
}) {}

export const ThreadVmState = Schema.Literals([
  "discovering",
  "creating",
  "bootstrapping",
  "ready",
  "running",
  "blocked",
  "stopped",
  "failed",
  "destroying",
  "unknown"
]);

export class ProvisioningStep extends Schema.Class<ProvisioningStep>(
  "ProvisioningStep"
)({
  id: Schema.String,
  label: Schema.String,
  status: Schema.Literals(["pending", "running", "succeeded", "failed"]),
  startedAt: Schema.optional(Schema.Number),
  finishedAt: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
  outputExcerpt: Schema.optional(Schema.String)
}) {}

export class ThreadVm extends Schema.Class<ThreadVm>("ThreadVm")({
  id: Schema.String,
  name: Schema.String,
  host: Schema.String,
  project: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  startingPrompt: Schema.optional(Schema.String),
  pinned: Schema.optional(Schema.Boolean),
  repo: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  state: ThreadVmState,
  source: Schema.Literals(["exe", "cache", "mock"]),
  tags: Schema.optional(Schema.Array(Schema.String)),
  ports: Schema.Array(Port),
  metadataPath: Schema.optional(Schema.String),
  devPidPath: Schema.optional(Schema.String),
  devLogPath: Schema.optional(Schema.String),
  lastProvisioningError: Schema.optional(Schema.String),
  provisioningSteps: Schema.optional(Schema.Array(ProvisioningStep)),
  createdAt: Schema.optional(Schema.Number),
  updatedAt: Schema.optional(Schema.Number),
  raw: Schema.optional(Schema.String)
}) {}

export class CreateThreadVmRequest extends Schema.Class<CreateThreadVmRequest>(
  "CreateThreadVmRequest"
)({
  project: Schema.String,
  summary: Schema.String,
  branch: Schema.optional(Schema.String),
  baseDevbox: Schema.optional(Schema.String),
  image: Schema.optional(Schema.String),
  startingPrompt: Schema.optional(Schema.String),
  pinned: Schema.optional(Schema.Boolean)
}) {}

export class CreateThreadVmResponse extends Schema.Class<CreateThreadVmResponse>(
  "CreateThreadVmResponse"
)({
  threadVm: ThreadVm,
  message: Schema.String
}) {}

export class ProjectRegistryResponse extends Schema.Class<ProjectRegistryResponse>(
  "ProjectRegistryResponse"
)({
  projects: Schema.Array(Project),
  project: Schema.optional(Project),
  message: Schema.String
}) {}

export class ThreadVmLifecycleResponse extends Schema.Class<ThreadVmLifecycleResponse>(
  "ThreadVmLifecycleResponse"
)({
  threadVm: ThreadVm,
  message: Schema.String
}) {}

export class ThreadVmDevLogResponse extends Schema.Class<ThreadVmDevLogResponse>(
  "ThreadVmDevLogResponse"
)({
  threadVmId: Schema.String,
  path: Schema.String,
  content: Schema.String,
  truncated: Schema.Boolean,
  observedAt: Schema.Number
}) {}

export class ThreadVmPlanResponse extends Schema.Class<ThreadVmPlanResponse>(
  "ThreadVmPlanResponse"
)({
  threadVmId: Schema.String,
  path: Schema.String,
  exists: Schema.Boolean,
  content: Schema.String,
  revision: Schema.optional(Schema.String),
  observedAt: Schema.Number
}) {}

export class ThreadVmPortStatus extends Schema.Class<ThreadVmPortStatus>(
  "ThreadVmPortStatus"
)({
  label: Schema.String,
  port: Schema.Number,
  url: Schema.String,
  status: Schema.Literals(["reachable", "unreachable", "unknown"]),
  message: Schema.optional(Schema.String),
  observedAt: Schema.Number
}) {}

export class ThreadVmPortsResponse extends Schema.Class<ThreadVmPortsResponse>(
  "ThreadVmPortsResponse"
)({
  threadVmId: Schema.String,
  ports: Schema.Array(ThreadVmPortStatus),
  observedAt: Schema.Number
}) {}

export class ThreadVmReconciliationEvent extends Schema.Class<ThreadVmReconciliationEvent>(
  "ThreadVmReconciliationEvent"
)({
  threadVms: Schema.Array(ThreadVm),
  observedAt: Schema.Number
}) {}

export class ThreadVmProvisioningEvent extends Schema.Class<ThreadVmProvisioningEvent>(
  "ThreadVmProvisioningEvent"
)({
  threadVm: ThreadVm,
  observedAt: Schema.Number
}) {}

export class ThreadVmMetadata extends Schema.Class<ThreadVmMetadata>(
  "ThreadVmMetadata"
)({
  id: Schema.String,
  state: Schema.optional(ThreadVmState),
  project: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  startingPrompt: Schema.optional(Schema.String),
  pinned: Schema.optional(Schema.Boolean),
  repo: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  ports: Schema.Array(Port),
  metadataPath: Schema.optional(Schema.String),
  devPidPath: Schema.optional(Schema.String),
  devLogPath: Schema.optional(Schema.String),
  lastProvisioningError: Schema.optional(Schema.String),
  provisioningSteps: Schema.optional(Schema.Array(ProvisioningStep)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number
}) {}

export class ThreadVmMetadataFile extends Schema.Class<ThreadVmMetadataFile>(
  "ThreadVmMetadataFile"
)({
  threadVms: Schema.Record(Schema.String, ThreadVmMetadata)
}) {}

const TerminalDimension = Schema.Int.check(
  Schema.isBetween({ minimum: 2, maximum: 1_000 })
);
const TerminalThreadVmId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
);

export class TerminalSocketRequest extends Schema.Class<TerminalSocketRequest>(
  "TerminalSocketRequest"
)({
  threadVmId: TerminalThreadVmId,
  cols: TerminalDimension,
  rows: TerminalDimension,
  restart: Schema.Boolean
}) {}

export class TerminalInputMessage extends Schema.Class<TerminalInputMessage>(
  "TerminalInputMessage"
)({
  type: Schema.Literals(["input"]),
  data: Schema.String
}) {}

export class TerminalResizeMessage extends Schema.Class<TerminalResizeMessage>(
  "TerminalResizeMessage"
)({
  type: Schema.Literals(["resize"]),
  cols: TerminalDimension,
  rows: TerminalDimension
}) {}

export class TerminalPingMessage extends Schema.Class<TerminalPingMessage>(
  "TerminalPingMessage"
)({
  type: Schema.Literals(["ping"]),
  timestamp: Schema.Number
}) {}

export const TerminalClientMessage = Schema.Union([
  TerminalInputMessage,
  TerminalResizeMessage,
  TerminalPingMessage
]);

export class TerminalReadyMessage extends Schema.Class<TerminalReadyMessage>(
  "TerminalReadyMessage"
)({
  type: Schema.Literals(["ready"]),
  attachmentId: Schema.String,
  sessionName: Schema.String,
  createdAt: Schema.Number,
  reused: Schema.Boolean
}) {}

export class TerminalOutputMessage extends Schema.Class<TerminalOutputMessage>(
  "TerminalOutputMessage"
)({
  type: Schema.Literals(["output"]),
  data: Schema.String
}) {}

export class TerminalStatusMessage extends Schema.Class<TerminalStatusMessage>(
  "TerminalStatusMessage"
)({
  type: Schema.Literals(["status"]),
  status: Schema.Literals(["connecting", "attached", "disconnected"])
}) {}

export class TerminalPongMessage extends Schema.Class<TerminalPongMessage>(
  "TerminalPongMessage"
)({
  type: Schema.Literals(["pong"]),
  timestamp: Schema.Number
}) {}

export class TerminalErrorMessage extends Schema.Class<TerminalErrorMessage>(
  "TerminalErrorMessage"
)({
  type: Schema.Literals(["error"]),
  message: Schema.String
}) {}

export const TerminalServerMessage = Schema.Union([
  TerminalReadyMessage,
  TerminalOutputMessage,
  TerminalStatusMessage,
  TerminalPongMessage,
  TerminalErrorMessage
]);

export class ApiError extends Schema.TaggedErrorClass<ApiError>()(
  "ApiError",
  {
    message: Schema.String,
    detail: Schema.optional(Schema.String)
  }
) {}

export type ProjectModel = typeof Project.Type;
export type ProjectRegistryResponseModel = typeof ProjectRegistryResponse.Type;
export type ProvisioningStepModel = typeof ProvisioningStep.Type;
export type ThreadVmModel = typeof ThreadVm.Type;
export type CreateThreadVmRequestModel = typeof CreateThreadVmRequest.Type;
export type CreateThreadVmResponseModel = typeof CreateThreadVmResponse.Type;
export type ThreadVmLifecycleResponseModel = typeof ThreadVmLifecycleResponse.Type;
export type ThreadVmDevLogResponseModel = typeof ThreadVmDevLogResponse.Type;
export type ThreadVmPlanResponseModel = typeof ThreadVmPlanResponse.Type;
export type ThreadVmPortStatusModel = typeof ThreadVmPortStatus.Type;
export type ThreadVmPortsResponseModel = typeof ThreadVmPortsResponse.Type;
export type ThreadVmReconciliationEventModel =
  typeof ThreadVmReconciliationEvent.Type;
export type ThreadVmProvisioningEventModel = typeof ThreadVmProvisioningEvent.Type;
export type ThreadVmMetadataModel = typeof ThreadVmMetadata.Type;
export type ThreadVmMetadataFileModel = typeof ThreadVmMetadataFile.Type;
export type TerminalClientMessageModel = typeof TerminalClientMessage.Type;
export type TerminalServerMessageModel = typeof TerminalServerMessage.Type;
