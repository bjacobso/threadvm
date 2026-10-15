import { Schema as S } from "effect";
import { Outliner } from "@foldworks/outliner";

import { AgentId, Thread, Backend, Items } from "../shared/protocol.ts";

export const Flags = S.Struct({
  outlineId: S.String,
  /** Prefixes thread ids created in this tab, so two tabs never collide. */
  sessionId: S.String,
});
export type Flags = typeof Flags.Type;

export const Connection = S.Literals(["Connecting", "Online", "Offline"]);
export type Connection = typeof Connection.Type;

/** A bullet about to be sent to an agent, after the caret leaves it. */
export const Countdown = S.Struct({ agent: AgentId, remaining: S.Number });
export type Countdown = typeof Countdown.Type;

export const COUNTDOWN_MS = 2400;

export const Model = S.Struct({
  outlineId: S.String,
  sessionId: S.String,
  backend: S.NullOr(Backend),
  canonical: Items,
  inFlight: S.NullOr(
    S.Struct({
      requestId: S.String,
      items: Items,
      baseItems: Items,
      baseRevision: S.Number,
      editorRevision: S.Number,
    }),
  ),
  error: S.String,
  saveRejected: S.Boolean,
  outline: Outliner.Model,
  threads: S.Record(S.String, Thread),
  connection: Connection,
  /** Consecutive failed connection attempts, for backoff. */
  retries: S.Number,
  /** Whether the room's first snapshot has arrived. */
  synced: S.Boolean,
  /** The outline revision the room last saw from this tab. */
  savedRevision: S.Number,
  nextThreadNumber: S.Number,
  /** The thread shown in the side panel; `null` shows the inbox. */
  selectedThreadId: S.NullOr(S.String),
  /** Unsent composer text, by thread. */
  drafts: S.Record(S.String, S.String),
  /** Bullets someone typed into since they were last sent to an agent. */
  edited: S.Record(S.String, S.Boolean),
  countdowns: S.Record(S.String, Countdown),
  /** Suggestions accepted in this tab, which undo and redo keep in step with the outline. */
  acceptedHere: S.Array(S.String),
  announcement: S.String,
});
export type Model = typeof Model.Type;

export const init = (flags: Flags): Model => ({
  outlineId: flags.outlineId,
  sessionId: flags.sessionId,
  backend: null,
  canonical: [],
  inFlight: null,
  error: "",
  saveRejected: false,
  outline: Outliner.init({ id: `outline-${flags.sessionId}`, items: [] }),
  threads: {},
  connection: "Connecting",
  retries: 0,
  synced: false,
  savedRevision: 0,
  nextThreadNumber: 1,
  selectedThreadId: null,
  drafts: {},
  edited: {},
  countdowns: {},
  acceptedHere: [],
  announcement: "",
});
