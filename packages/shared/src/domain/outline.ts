import { Schema } from "effect";

export const OutlineId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/)
);
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const Agent = Schema.Literals(["codex", "claude", "shell"]);

export class NodeDraft extends Schema.Class<NodeDraft>("NodeDraft")({
  id: OutlineId,
  text: Schema.String,
  done: Schema.Boolean
}) {}
export class Node extends Schema.Class<Node>("Node")({
  ...NodeDraft.fields,
  parent: Schema.NullOr(OutlineId),
  changedAt: Revision
}) {}
export class NodePatch extends Schema.Class<NodePatch>("NodePatch")({
  text: Schema.optional(Schema.String),
  done: Schema.optional(Schema.Boolean)
}) {}
export class InsertOperation extends Schema.Class<InsertOperation>(
  "InsertOperation"
)({
  type: Schema.Literal("insert"),
  parent: Schema.NullOr(OutlineId),
  after: Schema.optional(Schema.NullOr(OutlineId)),
  node: NodeDraft
}) {}
export class UpdateOperation extends Schema.Class<UpdateOperation>(
  "UpdateOperation"
)({
  type: Schema.Literal("update"),
  id: OutlineId,
  patch: NodePatch
}) {}
export class MoveOperation extends Schema.Class<MoveOperation>("MoveOperation")(
  {
    type: Schema.Literal("move"),
    id: OutlineId,
    parent: Schema.NullOr(OutlineId),
    after: Schema.optional(Schema.NullOr(OutlineId))
  }
) {}
export class DeleteOperation extends Schema.Class<DeleteOperation>(
  "DeleteOperation"
)({
  type: Schema.Literal("delete"),
  id: OutlineId
}) {}
export const OutlineOperation = Schema.Union([
  InsertOperation,
  UpdateOperation,
  MoveOperation,
  DeleteOperation
]);
export type OutlineOperation = typeof OutlineOperation.Type;
export class OperationBatch extends Schema.Class<OperationBatch>(
  "OperationBatch"
)({
  baseRevision: Revision,
  operations: Schema.Array(OutlineOperation)
}) {}
export class AppliedBatch extends Schema.Class<AppliedBatch>("AppliedBatch")({
  ...OperationBatch.fields,
  id: OutlineId,
  revision: Revision,
  actor: Schema.Literals(["human", "accepted"]),
  proposalId: Schema.optional(OutlineId),
  runId: Schema.optional(OutlineId),
  time: Schema.Number
}) {}
export class Proposal extends Schema.Class<Proposal>("Proposal")({
  id: OutlineId,
  batch: OperationBatch,
  runId: Schema.optional(OutlineId),
  pending: Schema.Array(OutlineId),
  accepted: Schema.Array(OutlineId),
  rejected: Schema.Array(OutlineId),
  createdAt: Schema.Number
}) {}
export class OutlineSnapshot extends Schema.Class<OutlineSnapshot>(
  "OutlineSnapshot"
)({
  revision: Revision,
  nodes: Schema.Array(Node),
  tombstones: Schema.Record(Schema.String, Revision),
  proposals: Schema.Array(Proposal)
}) {}
export class Run extends Schema.Class<Run>("Run")({
  id: OutlineId,
  nodeId: OutlineId,
  agent: Agent,
  branch: Schema.String,
  worktree: Schema.String,
  sessionName: Schema.String,
  codeSha: Schema.String,
  status: Schema.Literals(["starting", "running", "finished", "failed"]),
  startedAt: Schema.Number,
  endedAt: Schema.optional(Schema.Number),
  exitCode: Schema.optional(Schema.Number)
}) {}
export class RunEvent extends Schema.Class<RunEvent>("RunEvent")({
  id: OutlineId,
  runId: OutlineId,
  nodeId: OutlineId,
  time: Schema.Number,
  kind: Schema.Literals([
    "starting",
    "started",
    "output",
    "observation",
    "commit",
    "pr",
    "finished",
    "failed"
  ]),
  run: Schema.optional(Run),
  message: Schema.optional(Schema.String),
  codeSha: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number)
}) {}
export class OutlineView extends Schema.Class<OutlineView>("OutlineView")({
  projectDir: Schema.String,
  snapshot: OutlineSnapshot,
  runs: Schema.Array(Run),
  events: Schema.Array(RunEvent)
}) {}
export class ProposalRequest extends Schema.Class<ProposalRequest>(
  "ProposalRequest"
)({
  batch: OperationBatch,
  runId: Schema.optional(OutlineId),
  capability: Schema.optional(Schema.String)
}) {}
export class ReviewRequest extends Schema.Class<ReviewRequest>("ReviewRequest")(
  {
    proposalId: OutlineId,
    decision: Schema.Literals(["accept", "reject"]),
    nodeIds: Schema.optional(Schema.Array(OutlineId))
  }
) {}
export class StartRunRequest extends Schema.Class<StartRunRequest>(
  "StartRunRequest"
)({
  nodeId: OutlineId,
  agent: Agent
}) {}
export class ObserveRequest extends Schema.Class<ObserveRequest>(
  "ObserveRequest"
)({
  runId: OutlineId,
  kind: Schema.Literals(["output", "observation", "commit", "pr", "finished"]),
  message: Schema.String,
  codeSha: Schema.optional(Schema.String),
  capability: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number)
}) {}
