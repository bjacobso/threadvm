import { renewDeletedIds } from "./history.ts";
import {
  asNodes,
  diff,
  replay,
  toItems,
} from "@threadvm/outline-protocol/document";
import { Option } from "effect";
import { Update } from "foldkit";
import { Outliner, reparented, type Policy } from "@foldworks/outliner";

import { AGENTS, mentionedAgent } from "../shared/agents.ts";
import {
  isActive,
  pendingOps,
  type AgentId,
  type ClientMessage,
  type Items,
  type Op,
  type Thread,
} from "../shared/protocol.ts";
import { applyOp, contextOf, find, isApplied, walk } from "../shared/tree.ts";
import { announcementFor, attentionQueue, type Kind } from "./attention.ts";
import { suggestionsAt } from "./mentions.ts";
import { Message } from "./message.ts";
import { COUNTDOWN_MS, type Model } from "./model.ts";
import {
  activeOn,
  ghostsOf,
  isGhost,
  latestByNode,
  project,
  realItems,
  sameItems,
} from "./projection.ts";
import { Reconnect, Send, type RoomSocketService } from "./socket.ts";

type Return = Update.Return<Model, Message, RoomSocketService>;
type Commands = NonNullable<Return["commands"]>;

/** One update's result, plus what it tells the room. Messages are sent in order. */
type Step = Readonly<{
  model: Model;
  commands?: Commands;
  outbox?: ReadonlyArray<ClientMessage>;
}>;

const merge = (first: Step, second: Step): Step => ({
  model: second.model,
  commands: [...(first.commands ?? []), ...(second.commands ?? [])],
  outbox: [...(first.outbox ?? []), ...(second.outbox ?? [])],
});

// ---------------------------------------------------------------------------
// The outline

/** Ghost rows are read-only and cannot adopt or be moved. */
export const policy: Policy = {
  isReadOnly: (node) => isGhost(node.id),
  canMove: ({ before, after }) =>
    reparented(before, after).every(
      ({ id, parentId }) =>
        !isGhost(id) && (parentId === null || !isGhost(parentId)),
    ),
};

const foldOutliner = Update.foldChild({
  update: (outline: Outliner.Model, message: Outliner.Message) =>
    Outliner.update(outline, message, policy),
  read: (model: Model) => Option.some(model.outline),
  write: (model, outline) => ({ ...model, outline }),
  toParentMessage: (message) => Message.GotOutlinerMessage({ message }),
});

const outline = (model: Model, message: Outliner.Message): Step =>
  foldOutliner(model, message);

/** Keeps ghost rows in step with the threads, outside of undo history. */
const reproject = (model: Model): Model => {
  const projected = project(realItems(model.outline.items), model.threads);
  return sameItems(projected, model.outline.items)
    ? model
    : { ...model, outline: { ...model.outline, items: projected } };
};

/** Replaces the real document as one undoable step, keeping ghosts in place. */
const replaceReal = (model: Model, real: Items, announcement: string): Step =>
  outline(
    model,
    Outliner.Message.Replace({
      items: project(real, model.threads),
      announcement,
    }),
  );

const isUndoOrRedo = (message: Outliner.Message): boolean =>
  message._tag === "ClickedUndo" ||
  message._tag === "ClickedRedo" ||
  (message._tag === "Pressed" &&
    (message.action === "Undo" || message.action === "Redo"));

/** Offers agents after `@` and tags after `#`, as soon as one is being typed. */
const offerCompletions = (step: Step, message: Outliner.Message): Step => {
  if (message._tag !== "EditedText" && message._tag !== "RequestedCompletion")
    return step;
  const current = step.model.outline;
  const node = find(current.items, message.id);
  if (
    node === undefined ||
    isGhost(node.id) ||
    current.focus?.start !== current.focus?.end
  )
    return step;
  const offer = suggestionsAt(current.items, node.text, message.end);
  if (offer === undefined) return step;
  return merge(
    step,
    outline(
      step.model,
      Outliner.Message.ShowCompletions({ id: message.id, ...offer }),
    ),
  );
};

/** Opens the thread behind the row the caret moved to, if it has one. */
const followCaret = (model: Model, message: Outliner.Message): Model => {
  const id =
    message._tag === "FocusedText" || message._tag === "ClickedBullet"
      ? message.id
      : undefined;
  if (id === undefined) return model;
  const thread = isGhost(id)
    ? ghostsOf(model.threads).get(id)?.thread
    : latestByNode(model.threads).get(id);
  return thread === undefined
    ? model
    : { ...model, selectedThreadId: thread.id };
};

/**
 * Undo and redo move the outline across accepted suggestions. Keep each
 * suggestion's state in step: undoing an acceptance offers the suggestion again.
 */
const syncAccepted = (model: Model): Step => {
  const real = realItems(model.outline.items);
  let threads = model.threads;
  const outbox: ClientMessage[] = [];
  for (const thread of Object.values(model.threads)) {
    const changed: Array<Readonly<{ id: string; state: Op["state"] }>> = [];
    for (const op of thread.proposal?.ops ?? []) {
      if (!model.acceptedHere.includes(op.id) || op.state === "Rejected")
        continue;
      const state = isApplied(real, op) ? "Accepted" : "Pending";
      if (state !== op.state) changed.push({ id: op.id, state });
    }
    for (const state of ["Accepted", "Pending"] as const) {
      const opIds = changed
        .filter((op) => op.state === state)
        .map((op) => op.id);
      if (opIds.length === 0) continue;
      threads = {
        ...threads,
        [thread.id]: withOpStates(threads[thread.id]!, opIds, state),
      };
      outbox.push({ _tag: "Resolve", threadId: thread.id, opIds, state });
    }
  }
  return { model: { ...model, threads }, outbox };
};

const outlinerMessage = (model: Model, message: Outliner.Message): Step => {
  let step = offerCompletions(outline(model, message), message);
  let next = followCaret(step.model, message);
  const typedIn =
    message._tag === "EditedText"
      ? message.id
      : message._tag === "AcceptedCompletion"
        ? next.outline.focus?.id
        : undefined;
  if (typedIn !== undefined && !isGhost(typedIn))
    next = { ...next, edited: { ...next.edited, [typedIn]: true } };
  step = { ...step, model: next };
  if (!model.backend && isUndoOrRedo(message))
    step = merge(step, syncAccepted(step.model));
  return { ...step, model: refreshCountdowns(step.model) };
};

// ---------------------------------------------------------------------------
// Sending bullets to agents

/**
 * A bullet someone typed an agent mention into is sent once the caret leaves
 * it, after a short countdown that returning to the bullet cancels.
 */
const refreshCountdowns = (model: Model): Model => {
  const real = realItems(model.outline.items);
  const caret = model.outline.focus?.id;
  const edited = { ...model.edited };
  const countdowns = { ...model.countdowns };
  for (const nodeId of Object.keys(edited)) {
    const node = find(real, nodeId);
    const agent = node === undefined ? undefined : mentionedAgent(node.text);
    if (node === undefined) delete edited[nodeId];
    if (
      agent === undefined ||
      caret === nodeId ||
      activeOn(model.threads, nodeId)
    ) {
      delete countdowns[nodeId];
      continue;
    }
    if (countdowns[nodeId]?.agent !== agent)
      countdowns[nodeId] = { agent, remaining: COUNTDOWN_MS };
  }
  return { ...model, edited, countdowns };
};

const lastCreatedAt = (threads: Readonly<Record<string, Thread>>): number =>
  Math.max(0, ...Object.values(threads).map((thread) => thread.createdAt));

/** Starts a thread here and in the room. The room's copy replaces this one. */
const dispatch = (
  model: Model,
  nodeId: string,
  agent: AgentId,
  options: Readonly<{
    parentThreadId?: string | null;
    instruction?: string;
  }> = {},
): Step => {
  const real = realItems(model.outline.items);
  const node = find(real, nodeId);
  if (node === undefined) return { model };
  const threadId = `${model.sessionId}-${model.nextThreadNumber}`;
  const at = lastCreatedAt(model.threads) + 1;
  const thread: Thread = {
    id: threadId,
    nodeId,
    agent,
    prompt: options.instruction || node.text,
    contextSize: contextOf(real, nodeId).size,
    parentThreadId: options.parentThreadId ?? null,
    status: "Queued",
    headline: `Starting ${AGENTS[agent].harness}`,
    createdAt: at,
    updatedAt: at,
    sandbox: null,
    activity: [],
    question: null,
    answers: [],
    proposal: null,
    report: "",
    links: [],
    cursor: 0,
  };
  const { [nodeId]: _edited, ...edited } = model.edited;
  const { [nodeId]: _countdown, ...countdowns } = model.countdowns;
  return {
    model: {
      ...model,
      threads: { ...model.threads, [threadId]: thread },
      nextThreadNumber: model.nextThreadNumber + 1,
      edited,
      countdowns,
      announcement: `Sent to ${AGENTS[agent].name}.`,
    },
    outbox: [
      {
        _tag: "Dispatch",
        threadId,
        nodeId,
        agent,
        instruction: options.instruction ?? "",
        parentThreadId: options.parentThreadId ?? null,
      },
    ],
  };
};

const tick = (model: Model, elapsed: number): Step => {
  let step: Step = { model };
  for (const [nodeId, countdown] of Object.entries(model.countdowns)) {
    const remaining = countdown.remaining - elapsed;
    step =
      remaining > 0
        ? {
            ...step,
            model: {
              ...step.model,
              countdowns: {
                ...step.model.countdowns,
                [nodeId]: { ...countdown, remaining },
              },
            },
          }
        : merge(step, dispatch(step.model, nodeId, countdown.agent));
  }
  return step;
};

// ---------------------------------------------------------------------------
// Answering and reviewing

const withOpStates = (
  thread: Thread,
  opIds: ReadonlyArray<string>,
  state: Op["state"],
): Thread =>
  thread.proposal === null
    ? thread
    : {
        ...thread,
        proposal: {
          ...thread.proposal,
          ops: thread.proposal.ops.map((op) =>
            opIds.includes(op.id) ? { ...op, state } : op,
          ),
        },
      };

const updateThread = (
  model: Model,
  threadId: string,
  f: (thread: Thread) => Thread,
): Model => {
  const thread = model.threads[threadId];
  return thread === undefined
    ? model
    : { ...model, threads: { ...model.threads, [threadId]: f(thread) } };
};

const answer = (model: Model, threadId: string, text: string): Step => {
  const thread = model.threads[threadId];
  if (thread?.question == null || text.trim() === "") return { model };
  const questionId = thread.question.id;
  return {
    model: updateThread(model, threadId, (current) => ({
      ...current,
      status: "Working",
      question: null,
      headline: "Continuing with your answer",
    })),
    outbox: [{ _tag: "Answer", threadId, questionId, text: text.trim() }],
  };
};

const resolveOps = (
  model: Model,
  threadId: string,
  opIds: ReadonlyArray<string>,
  state: "Accepted" | "Rejected",
): Step => {
  const thread = model.threads[threadId];
  if (thread === undefined) return { model };
  if (model.backend)
    return { model, outbox: [{ _tag: "Resolve", threadId, opIds, state }] };
  const ops = pendingOps(thread).filter((op) => opIds.includes(op.id));
  if (ops.length === 0) return { model };
  const ids = ops.map((op) => op.id);
  const resolved: Model = {
    ...updateThread(model, threadId, (current) =>
      withOpStates(current, ids, state),
    ),
    acceptedHere:
      state === "Accepted"
        ? [...model.acceptedHere, ...ids]
        : model.acceptedHere,
  };
  const outbox: ReadonlyArray<ClientMessage> = [
    { _tag: "Resolve", threadId, opIds: ids, state },
  ];
  const name = AGENTS[thread.agent].name;
  if (state === "Rejected")
    return {
      model: {
        ...resolved,
        announcement: `Rejected ${ids.length === 1 ? "a suggestion" : `${ids.length} suggestions`} from ${name}.`,
      },
      outbox,
    };

  const real = ops.reduce(applyOp, realItems(model.outline.items));
  let step: Step = {
    ...replaceReal(
      resolved,
      real,
      `Accepted ${ids.length === 1 ? "a suggestion" : `${ids.length} suggestions`} from ${name}. Undo to take ${ids.length === 1 ? "it" : "them"} back.`,
    ),
    outbox,
  };
  // Accepted bullets that mention an agent start right away: a plan becomes work.
  for (const op of ops) {
    if (op._tag !== "Insert") continue;
    for (const node of walk(op.items)) {
      const agent = mentionedAgent(node.text);
      if (agent !== undefined)
        step = merge(
          step,
          dispatch(step.model, node.id, agent, { parentThreadId: threadId }),
        );
    }
  }
  return step;
};

const submitDraft = (model: Model, threadId: string): Step => {
  const thread = model.threads[threadId];
  const text = (model.drafts[threadId] ?? "").trim();
  if (thread === undefined || text === "") return { model };
  const cleared = { ...model, drafts: { ...model.drafts, [threadId]: "" } };
  if (thread.status === "NeedsInput") return answer(cleared, threadId, text);
  if (isActive(thread.status) || thread.execution?.persistent)
    return {
      model: cleared,
      outbox: [{ _tag: "Steer", threadId, text }],
    };
  // A finished thread continues as a follow-up run on the same bullet.
  const followUp = dispatch(cleared, thread.nodeId, thread.agent, {
    parentThreadId: thread.parentThreadId,
    instruction: text,
  });
  const created = Object.keys(followUp.model.threads).find(
    (id) => !(id in model.threads),
  );
  return {
    ...followUp,
    model: { ...followUp.model, selectedThreadId: created ?? threadId },
  };
};

const jump = (model: Model, kind: Kind | "Any"): Step => {
  const queue = attentionQueue(
    realItems(model.outline.items),
    model.threads,
  ).filter((entry) => kind === "Any" || entry.kind === kind);
  if (queue.length === 0)
    return { model: { ...model, announcement: "Nothing is waiting on you." } };
  const current = queue.findIndex(
    (entry) => entry.thread.id === model.selectedThreadId,
  );
  const { thread } = queue[(current + 1) % queue.length]!;
  return outline(
    { ...model, selectedThreadId: thread.id },
    Outliner.Message.Reveal({ id: thread.nodeId }),
  );
};

// ---------------------------------------------------------------------------
// The room

const fromServer = (
  model: Model,
  message: Message & { _tag: "ReceivedServerMessage" },
): Step => {
  const server = message.message;
  if (
    (server._tag === "Snapshot" || server._tag === "DocumentChanged") &&
    server.backend
  ) {
    let next = {
      ...model,
      backend: server.backend,
      canonical: server.items,
      error: "",
    };
    if (server._tag === "Snapshot")
      next = {
        ...next,
        threads: Object.fromEntries(server.threads.map((t) => [t.id, t])),
      };
    if (model.inFlight) {
      if (server._tag === "Snapshot")
        return {
          model: next,
          outbox: [{ _tag: "SaveDocument", ...model.inFlight }],
        };
      if (server.requestId !== model.inFlight.requestId)
        return {
          model: {
            ...next,
            canonical: model.canonical,
            backend: model.backend,
          },
        };
      const pending = diff(
        asNodes(model.inFlight.items),
        realItems(model.outline.items),
      );
      const items = toItems(
        replay(asNodes(server.items), pending),
        realItems(model.outline.items),
      );
      next = {
        ...next,
        inFlight: null,
        synced: true,
        savedRevision: pending.length
          ? model.inFlight.editorRevision
          : model.outline.revision,
      };
      return {
        model: {
          ...next,
          outline: renewDeletedIds(
            { ...next.outline, items: project(items, next.threads) },
            server.backend.tombstones,
            () => crypto.randomUUID(),
          ),
        },
      };
    }
    if (model.synced && model.outline.revision !== model.savedRevision)
      return {
        model: { ...next, canonical: model.canonical, backend: model.backend },
      };
    const loaded = outline(
      next,
      Outliner.Message.Load({ items: project(server.items, next.threads) }),
    );
    return {
      ...loaded,
      model: {
        ...loaded.model,
        synced: true,
        savedRevision: loaded.model.outline.revision,
      },
    };
  }
  switch (server._tag) {
    case "Error":
      return {
        model: {
          ...model,
          error: server.message,
          announcement: server.message,
        },
      };
    case "Snapshot": {
      const threads = Object.fromEntries(
        server.threads.map((thread) => [thread.id, thread]),
      );
      const withThreads = { ...model, threads };
      if (!model.synced) {
        const loaded = outline(
          withThreads,
          Outliner.Message.Load({ items: project(server.items, threads) }),
        );
        return {
          ...loaded,
          model: {
            ...loaded.model,
            synced: true,
            savedRevision: loaded.model.outline.revision,
          },
        };
      }
      // Reconnected. Unsent local edits win; otherwise take the room's outline.
      if (model.outline.revision !== model.savedRevision)
        return { model: withThreads };
      if (sameItems(realItems(model.outline.items), server.items))
        return { model: withThreads };
      const replaced = replaceReal(
        withThreads,
        server.items,
        "Caught up with the outline.",
      );
      return {
        ...replaced,
        model: {
          ...replaced.model,
          savedRevision: replaced.model.outline.revision,
        },
      };
    }
    case "DocumentChanged": {
      const replaced = replaceReal(
        model,
        server.items,
        "Updated from another window.",
      );
      return {
        ...replaced,
        model: {
          ...replaced.model,
          savedRevision: replaced.model.outline.revision,
        },
      };
    }
    case "ThreadChanged": {
      const before = model.threads[server.thread.id];
      const announcement = announcementFor(
        before,
        server.thread,
        realItems(model.outline.items),
      );
      return {
        model: {
          ...model,
          threads: { ...model.threads, [server.thread.id]: server.thread },
          error: model.inFlight ? model.error : "",
          announcement: announcement || model.announcement,
        },
      };
    }
  }
};

// ---------------------------------------------------------------------------

const reduce = (model: Model, message: Message): Step =>
  Message.match<Step>(message, {
    GotOutlinerMessage: ({ message }) => outlinerMessage(model, message),

    OpenedSocket: () => ({
      model: { ...model, connection: "Online", retries: 0 },
    }),
    FailedSocket: () => ({
      model: { ...model, connection: "Offline", retries: model.retries + 1 },
      commands: [Reconnect({ attempt: model.retries })],
    }),
    ClosedSocket: () => ({
      model: { ...model, connection: "Offline", retries: model.retries + 1 },
      commands: [Reconnect({ attempt: model.retries })],
    }),
    ReleasedSocket: () => ({ model }),
    Reconnected: () => ({ model: { ...model, connection: "Connecting" } }),
    ReceivedServerMessage: (received) => fromServer(model, received),
    CompletedSend: ({ delivered }) =>
      delivered ? { model } : { model: { ...model, savedRevision: -1 } },

    TickedCountdowns: ({ elapsed }) => tick(model, elapsed),
    ClickedSendNow: ({ nodeId }) => {
      const node = find(realItems(model.outline.items), nodeId);
      const agent = node === undefined ? undefined : mentionedAgent(node.text);
      return agent === undefined ? { model } : dispatch(model, nodeId, agent);
    },
    ClickedHoldCountdown: ({ nodeId }) => {
      const { [nodeId]: _countdown, ...countdowns } = model.countdowns;
      const { [nodeId]: _edited, ...edited } = model.edited;
      return {
        model: {
          ...model,
          countdowns,
          edited,
          announcement: "Kept as a note.",
        },
      };
    },

    SelectedThread: ({ threadId }) => ({
      model: { ...model, selectedThreadId: threadId },
    }),
    ClosedThread: () => ({ model: { ...model, selectedThreadId: null } }),
    RevealedNode: ({ nodeId }) =>
      outline(model, Outliner.Message.Reveal({ id: nodeId })),
    AnsweredQuestion: ({ threadId, text }) => answer(model, threadId, text),
    ResolvedOps: ({ threadId, opIds, state }) =>
      resolveOps(model, threadId, opIds, state),
    ChangedDraft: ({ threadId, value }) => ({
      model: { ...model, drafts: { ...model.drafts, [threadId]: value } },
    }),
    SubmittedDraft: ({ threadId }) => submitDraft(model, threadId),
    StoppedThread: ({ threadId }) => ({
      model: updateThread(model, threadId, (thread) => ({
        ...thread,
        status: "Cancelled",
        headline: "Stopped",
        question: null,
      })),
      outbox: [{ _tag: "Cancel", threadId }],
    }),
    JumpedToAttention: ({ kind }) => jump(model, kind),
    ClickedPush: () => ({ model, outbox: [{ _tag: "Push" }] }),
    ClickedResetDemo: () => ({
      model: {
        ...model,
        synced: false,
        selectedThreadId: null,
        edited: {},
        countdowns: {},
        acceptedHere: [],
        announcement: "Resetting the demo outline.",
      },
      outbox: [{ _tag: "ResetDemo" }],
    }),
    CompletedFocus: () => ({ model }),
  });

/**
 * Every update ends the same way: ghosts are projected from the latest
 * threads, a changed outline is saved to the room, and the outbox is sent in
 * one command so the room sees the save before anything that depends on it.
 */
export const update = (model: Model, message: Message): Return => {
  const step = reduce(model, message);
  let next = reproject(step.model);
  if (next.threads !== model.threads) next = refreshCountdowns(next);
  const outbox = [...(step.outbox ?? [])];
  if (
    next.backend &&
    next.synced &&
    next.connection === "Online" &&
    !next.inFlight &&
    !next.error &&
    next.outline.revision !== next.savedRevision
  ) {
    const items = realItems(next.outline.items);
    const inFlight = {
      requestId: crypto.randomUUID(),
      items,
      baseItems: next.canonical,
      baseRevision: next.backend.revision,
      editorRevision: next.outline.revision,
    };
    outbox.unshift({ _tag: "SaveDocument", ...inFlight });
    next = { ...next, inFlight };
  }
  if (
    !next.backend &&
    next.synced &&
    next.connection === "Online" &&
    next.outline.revision !== next.savedRevision
  ) {
    outbox.unshift({
      _tag: "SaveDocument",
      items: realItems(next.outline.items),
    });
    next = { ...next, savedRevision: next.outline.revision };
  }
  return {
    model: next,
    commands: [
      ...(step.commands ?? []),
      ...(outbox.length > 0 ? [Send({ messages: outbox })] : []),
    ],
  };
};
