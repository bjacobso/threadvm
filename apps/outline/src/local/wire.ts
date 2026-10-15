// Wire codecs use this application's Effect version. Only TypeScript types cross
// the package boundary; no server Effect values or Schema ASTs enter Foldkit.
import { Schema as S } from "effect";
import type {
  OutlineView,
  OutlineSnapshot,
  OutlineOperation,
} from "@threadvm/shared/domain";
const Id = S.String;
const Draft = S.Struct({ id: Id, text: S.String, done: S.Boolean });
export const Operation: S.Codec<OutlineOperation> = S.Union([
  S.Struct({
    type: S.Literal("insert"),
    parent: S.NullOr(Id),
    after: S.optional(S.NullOr(Id)),
    node: Draft,
  }),
  S.Struct({
    type: S.Literal("update"),
    id: Id,
    patch: S.Struct({
      text: S.optional(S.String),
      done: S.optional(S.Boolean),
    }),
  }),
  S.Struct({
    type: S.Literal("move"),
    id: Id,
    parent: S.NullOr(Id),
    after: S.optional(S.NullOr(Id)),
  }),
  S.Struct({ type: S.Literal("delete"), id: Id }),
]);
export const Batch = S.Struct({
  baseRevision: S.Number,
  operations: S.Array(Operation),
});
const Node = S.Struct({
  ...Draft.fields,
  parent: S.NullOr(Id),
  changedAt: S.Number,
});
const Proposal = S.Struct({
  id: Id,
  batch: Batch,
  runId: S.optional(Id),
  pending: S.Array(Id),
  accepted: S.Array(Id),
  rejected: S.Array(Id),
  createdAt: S.Number,
});
export const Snapshot: S.Codec<OutlineSnapshot> = S.Struct({
  revision: S.Number,
  nodes: S.Array(Node),
  tombstones: S.Record(Id, S.Number),
  proposals: S.Array(Proposal),
});
const Run = S.Struct({
  id: Id,
  nodeId: Id,
  agent: S.Literals(["codex", "claude", "shell", "acp"]),
  branch: S.String,
  worktree: S.String,
  sessionName: S.String,
  codeSha: S.String,
  status: S.Literals(["starting", "running", "finished", "failed"]),
  startedAt: S.Number,
  endedAt: S.optional(S.Number),
  exitCode: S.optional(S.Number),
});
const Signal = S.Struct({
  type: S.Literals([
    "initialized",
    "session",
    "update",
    "permission",
    "permission_resolved",
    "cancelled",
    "turn_complete",
  ]),
  sessionId: S.optional(Id),
  requestId: S.optional(Id),
  title: S.optional(S.String),
  options: S.optional(
    S.Array(S.Struct({ id: Id, name: S.String, kind: S.String })),
  ),
  payload: S.optional(S.Unknown),
});
const Event = S.Struct({
  id: Id,
  runId: Id,
  nodeId: Id,
  time: S.Number,
  kind: S.Literals([
    "starting",
    "started",
    "output",
    "observation",
    "commit",
    "pr",
    "finished",
    "failed",
    "agent",
  ]),
  run: S.optional(Run),
  agent: S.optional(Signal),
  message: S.optional(S.String),
  codeSha: S.optional(S.String),
  exitCode: S.optional(S.Number),
});
export const View: S.Codec<OutlineView> = S.Struct({
  projectDir: S.String,
  snapshot: Snapshot,
  runs: S.Array(Run),
  events: S.Array(Event),
});
export type { OutlineView, OutlineSnapshot, OutlineOperation };
