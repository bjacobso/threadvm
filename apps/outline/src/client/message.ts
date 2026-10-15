import { Schema as S } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { Outliner } from "@foldworks/outliner";

import { ServerMessage } from "../shared/protocol.ts";

export const Message = defineMessageUnion({
  GotOutlinerMessage: { message: Outliner.Message },

  // The room connection.
  OpenedSocket: {},
  FailedSocket: { error: S.String },
  ClosedSocket: {},
  ReleasedSocket: {},
  Reconnected: {},
  ReceivedServerMessage: { message: ServerMessage },
  CompletedSend: { delivered: S.Boolean },

  // Sending bullets to agents.
  TickedCountdowns: { elapsed: S.Number },
  ClickedSendNow: { nodeId: S.String },
  ClickedHoldCountdown: { nodeId: S.String },

  // Working with threads.
  SelectedThread: { threadId: S.String },
  ClosedThread: {},
  RevealedNode: { nodeId: S.String },
  AnsweredQuestion: { threadId: S.String, text: S.String },
  ResolvedOps: {
    threadId: S.String,
    opIds: S.Array(S.String),
    state: S.Literals(["Accepted", "Rejected"]),
  },
  ChangedDraft: { threadId: S.String, value: S.String },
  SubmittedDraft: { threadId: S.String },
  StoppedThread: { threadId: S.String },
  JumpedToAttention: {
    kind: S.Literals(["Any", "NeedsInput", "Review", "Working"]),
  },
  ClickedResetDemo: {},
  ClickedPush: {},
  RetriedEdit: {},
  DiscardedEdit: {},
  CompletedFocus: {},
});
export type Message = typeof Message.Type;
