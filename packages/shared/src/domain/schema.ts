import { Schema } from "effect";

export class Project extends Schema.Class<Project>("Project")({
  id: Schema.String,
  repo: Schema.String,
  defaultBranch: Schema.String,
  baseDevbox: Schema.optional(Schema.String),
  image: Schema.optional(Schema.String),
  workdir: Schema.String,
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
  })
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
  message: Schema.optional(Schema.String)
}) {}

export class ThreadVm extends Schema.Class<ThreadVm>("ThreadVm")({
  id: Schema.String,
  name: Schema.String,
  host: Schema.String,
  project: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
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

export class ThreadVmLifecycleResponse extends Schema.Class<ThreadVmLifecycleResponse>(
  "ThreadVmLifecycleResponse"
)({
  threadVm: ThreadVm,
  message: Schema.String
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

export class TerminalAttachRequest extends Schema.Class<TerminalAttachRequest>(
  "TerminalAttachRequest"
)({
  threadVmId: Schema.String,
  restart: Schema.optional(Schema.Boolean)
}) {}

export class TerminalAttachResponse extends Schema.Class<TerminalAttachResponse>(
  "TerminalAttachResponse"
)({
  sessionId: Schema.String,
  streamUrl: Schema.String,
  inputUrl: Schema.String,
  resizeUrl: Schema.String,
  closeUrl: Schema.String,
  status: Schema.Literals(["running", "exited"]),
  reused: Schema.Boolean,
  createdAt: Schema.Number
}) {}

export class TerminalInputRequest extends Schema.Class<TerminalInputRequest>(
  "TerminalInputRequest"
)({
  data: Schema.String
}) {}

export class TerminalResizeRequest extends Schema.Class<TerminalResizeRequest>(
  "TerminalResizeRequest"
)({
  cols: Schema.Number,
  rows: Schema.Number
}) {}

export class ApiError extends Schema.TaggedErrorClass<ApiError>()(
  "ApiError",
  {
    message: Schema.String,
    detail: Schema.optional(Schema.String)
  }
) {}

export type ProjectModel = typeof Project.Type;
export type ProvisioningStepModel = typeof ProvisioningStep.Type;
export type ThreadVmModel = typeof ThreadVm.Type;
export type CreateThreadVmRequestModel = typeof CreateThreadVmRequest.Type;
export type CreateThreadVmResponseModel = typeof CreateThreadVmResponse.Type;
export type ThreadVmLifecycleResponseModel = typeof ThreadVmLifecycleResponse.Type;
export type ThreadVmReconciliationEventModel =
  typeof ThreadVmReconciliationEvent.Type;
export type ThreadVmProvisioningEventModel = typeof ThreadVmProvisioningEvent.Type;
export type ThreadVmMetadataModel = typeof ThreadVmMetadata.Type;
export type ThreadVmMetadataFileModel = typeof ThreadVmMetadataFile.Type;
export type TerminalAttachResponseModel = typeof TerminalAttachResponse.Type;
