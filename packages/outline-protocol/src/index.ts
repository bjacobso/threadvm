// The wire contract between the browser and the outline's Durable Object.
// Both sides decode with these schemas, so a change here is a change to both.
import { Schema as S } from "effect";

/** One bullet. Structurally identical to `@foldworks/outliner`'s `Item`. */
export interface Item {
  readonly id: string;
  readonly text: string;
  readonly collapsed: boolean;
  readonly checked: boolean;
  readonly children: ReadonlyArray<Item>;
}
export const Item: S.Codec<Item> = S.suspend(() =>
  S.Struct({
    id: S.String,
    text: S.String,
    collapsed: S.Boolean,
    checked: S.Boolean,
    children: S.Array(Item),
  }),
);
export const Items = S.Array(Item);
export type Items = ReadonlyArray<Item>;

export const AgentId = S.Literals([
  "claude",
  "cursor",
  "conductor",
  "codex",
  "shell",
]);
export type AgentId = typeof AgentId.Type;

export const ThreadStatus = S.Literals([
  "Queued",
  "Provisioning",
  "Working",
  "NeedsInput",
  "Review",
  "Done",
  "Cancelled",
  "Failed",
]);
export type ThreadStatus = typeof ThreadStatus.Type;

export const StepKind = S.Literals([
  "sandbox",
  "git",
  "read",
  "bash",
  "edit",
  "search",
  "think",
]);
export type StepKind = typeof StepKind.Type;

/** What happened in a run, oldest first. */
export const Activity = S.Union([
  S.TaggedStruct("Step", {
    id: S.String,
    at: S.Number,
    kind: StepKind,
    label: S.String,
    detail: S.String,
    state: S.Literals(["Running", "Done", "Failed"]),
  }),
  S.TaggedStruct("Said", {
    id: S.String,
    at: S.Number,
    who: S.Literals(["Agent", "Human"]),
    text: S.String,
  }),
]);
export type Activity = typeof Activity.Type;

/** A question that blocks the run until someone answers it. */
export const Question = S.Struct({
  id: S.String,
  prompt: S.String,
  options: S.Array(S.String),
  kind: S.optional(S.Literals(["permission", "question"])),
  details: S.optional(S.String),
});
export type Question = typeof Question.Type;

export const OpState = S.Literals(["Pending", "Accepted", "Rejected"]);
export type OpState = typeof OpState.Type;

/**
 * A suggested change to the outline. Agents never write the outline directly;
 * a person accepts or rejects each change.
 */
export const Op = S.Union([
  S.TaggedStruct("Structural", {
    id: S.String,
    state: OpState,
    nodeId: S.String,
    label: S.String,
  }),
  S.TaggedStruct("Insert", {
    id: S.String,
    state: OpState,
    parentId: S.NullOr(S.String),
    /** The sibling to insert after, or `null` for the end of the parent's children. */
    afterId: S.NullOr(S.String),
    items: Items,
    nodeIds: S.optional(S.Array(S.String)),
  }),
  S.TaggedStruct("Edit", {
    id: S.String,
    state: OpState,
    nodeId: S.String,
    before: S.String,
    after: S.String,
  }),
  S.TaggedStruct("Complete", {
    id: S.String,
    state: OpState,
    nodeId: S.String,
  }),
]);
export type Op = typeof Op.Type;

export const Proposal = S.Struct({
  id: S.String,
  summary: S.String,
  ops: S.Array(Op),
});
export type Proposal = typeof Proposal.Type;

export const Sandbox = S.Struct({
  id: S.String,
  image: S.String,
  branch: S.String,
});
export type Sandbox = typeof Sandbox.Type;

export const Link = S.Struct({ label: S.String, href: S.String });
export type Link = typeof Link.Type;

/** One agent run, anchored to the bullet that asked for it. */
export const Thread = S.Struct({
  id: S.String,
  nodeId: S.String,
  agent: AgentId,
  /** The bullet's text when it was dispatched. */
  prompt: S.String,
  /** Bullets the agent was given: the anchor's ancestors and its subtree. */
  contextSize: S.Number,
  /** The thread whose accepted suggestion created this bullet, if any. */
  parentThreadId: S.NullOr(S.String),
  status: ThreadStatus,
  /** A one-line description of what the agent is doing now. */
  headline: S.String,
  createdAt: S.Number,
  updatedAt: S.Number,
  sandbox: S.NullOr(Sandbox),
  activity: S.Array(Activity),
  question: S.NullOr(Question),
  answers: S.Array(S.String),
  proposal: S.NullOr(Proposal),
  report: S.String,
  links: S.Array(Link),
  /** How far the simulated run has progressed through its script. */
  cursor: S.Number,
  execution: S.optional(
    S.Struct({
      runId: S.String,
      worktree: S.String,
      sessionName: S.String,
      codeSha: S.String,
      transport: S.Literals(["acp", "terminal"]),
      persistent: S.Boolean,
    }),
  ),
  contextItems: S.optional(Items),
});
export type Thread = typeof Thread.Type;

export const Backend = S.Struct({
  kind: S.Literal("local"),
  revision: S.Number,
  projectDir: S.String,
  remote: S.String,
  branch: S.String,
  available: S.Array(AgentId),
  tombstones: S.Record(S.String, S.Number),
});
export type Backend = typeof Backend.Type;
export const ClientMessage = S.Union([
  S.TaggedStruct("SaveDocument", {
    items: Items,
    baseItems: S.optional(Items),
    baseRevision: S.optional(S.Number),
    requestId: S.optional(S.String),
  }),
  S.TaggedStruct("Dispatch", {
    threadId: S.String,
    nodeId: S.String,
    agent: AgentId,
    /** A follow-up instruction. Empty means the bullet's own text. */
    instruction: S.String,
    parentThreadId: S.NullOr(S.String),
  }),
  S.TaggedStruct("Answer", {
    threadId: S.String,
    questionId: S.String,
    text: S.String,
  }),
  S.TaggedStruct("Resolve", {
    threadId: S.String,
    opIds: S.Array(S.String),
    state: OpState,
  }),
  S.TaggedStruct("Steer", { threadId: S.String, text: S.String }),
  S.TaggedStruct("Cancel", { threadId: S.String }),
  S.TaggedStruct("ResetDemo", {}),
  S.TaggedStruct("Push", {}),
]);
export type ClientMessage = typeof ClientMessage.Type;

export const ServerMessage = S.Union([
  /** Everything the room knows, sent on connect and after a reset. */
  S.TaggedStruct("Snapshot", {
    items: Items,
    threads: S.Array(Thread),
    backend: S.optional(Backend),
  }),
  /** Another connection changed the outline. */
  S.TaggedStruct("DocumentChanged", {
    items: Items,
    backend: S.optional(Backend),
    requestId: S.optional(S.String),
  }),
  S.TaggedStruct("ThreadChanged", { thread: Thread }),
  S.TaggedStruct("Error", {
    message: S.String,
    requestId: S.optional(S.String),
  }),
]);
export type ServerMessage = typeof ServerMessage.Type;

export const ClientMessageJson = S.fromJsonString(ClientMessage);
export const ServerMessageJson = S.fromJsonString(ServerMessage);

export const isActive = (status: ThreadStatus): boolean =>
  status === "Queued" ||
  status === "Provisioning" ||
  status === "Working" ||
  status === "NeedsInput" ||
  status === "Review";

export const pendingOps = (thread: Thread): ReadonlyArray<Op> =>
  thread.proposal?.ops.filter((op) => op.state === "Pending") ?? [];

export const decodeClient = S.decodeUnknownSync(ClientMessageJson);
export const encodeServer = S.encodeSync(ServerMessageJson);
