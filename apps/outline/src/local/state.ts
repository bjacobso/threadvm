import { Effect, Option, Schema as S, Stream } from "effect";
import { Command, Runtime, Subscription, Update } from "foldkit";
import { Outliner } from "@foldworks/outliner";
import { Items } from "../shared/protocol.ts";
import { Batch, Snapshot, View, type OutlineView } from "./wire.ts";
import { asNodes, diff, replay, toItems, renewDeletedIds } from "./document.ts";
import { view } from "./view.ts";
import { find } from "../shared/tree.ts";

export const Model = S.Struct({
  outline: Outliner.Model,
  data: S.NullOr(View),
  sent: S.NullOr(Items),
  reading: S.Boolean,
  busy: S.Boolean,
  error: S.String,
  blocked: S.Boolean,
  agent: S.Literals(["shell", "codex", "claude", "acp"]),
  opened: S.Array(S.String),
  delegating: S.NullOr(S.String),
});
export type Model = typeof Model.Type;
const Child = S.TaggedStruct("Child", { message: Outliner.Message });
const Tick = S.TaggedStruct("Tick", {});
const Read = S.TaggedStruct("Read", { data: View });
const Saved = S.TaggedStruct("Saved", { snapshot: Snapshot });
const Failed = S.TaggedStruct("Failed", {
  error: S.String,
  mutation: S.Boolean,
});
const Mutated = S.TaggedStruct("Mutated", {});
const Refresh = S.TaggedStruct("Refresh", {});
const Discard = S.TaggedStruct("Discard", {});
const ChooseAgent = S.TaggedStruct("ChooseAgent", {
  agent: Model.fields.agent,
});
const Start = S.TaggedStruct("Start", { nodeId: S.String });
const Review = S.TaggedStruct("Review", {
  proposalId: S.String,
  decision: S.Literals(["accept", "reject"]),
  nodeIds: S.Array(S.String),
});
const DismissRun = S.TaggedStruct("DismissRun", {});
const Attach = S.TaggedStruct("Attach", { runId: S.String });
const Control = S.TaggedStruct("Control", {
  runId: S.String,
  action: S.Literals(["permission", "cancel"]),
  requestId: S.String,
  optionId: S.String,
});
export const Message = S.Union([
  Child,
  Tick,
  Read,
  Saved,
  Failed,
  Mutated,
  Refresh,
  Discard,
  ChooseAgent,
  Start,
  Review,
  Attach,
  DismissRun,
  Control,
]);
export type Message = typeof Message.Type;
export const msg = {
  Child: (message: Outliner.Message): Message => ({ _tag: "Child", message }),
  Tick: (): Message => ({ _tag: "Tick" }),
};

const request = (path: string, body?: unknown) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(
        `/api/outline${path}`,
        body === undefined
          ? {}
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
      );
      const text = await response.text();
      const result: unknown = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const error = result as { message?: string; detail?: string };
        throw new Error(
          [error.message, error.detail].filter(Boolean).join(": ") ||
            `HTTP ${response.status}`,
        );
      }
      return result;
    },
    catch: (e) => String(e),
  });
const Load = Command.define("ReadLocalOutline", {
  args: {},
  messages: [Read, Failed],
  execute: () =>
    request("").pipe(
      Effect.flatMap(S.decodeUnknownEffect(View)),
      Effect.map((data) => Read.make({ data })),
      Effect.catch((e) =>
        Effect.succeed(Failed.make({ error: String(e), mutation: false })),
      ),
    ),
});
const Save = Command.define("ApplyLocalOutline", {
  args: { batch: Batch },
  messages: [Saved, Failed],
  execute: ({ batch }) =>
    request("/batches", batch).pipe(
      Effect.flatMap(S.decodeUnknownEffect(Snapshot)),
      Effect.map((snapshot) => Saved.make({ snapshot })),
      Effect.catch((e) =>
        Effect.succeed(Failed.make({ error: String(e), mutation: true })),
      ),
    ),
});
const Mutate = Command.define("ChangeLocalHarness", {
  args: { path: S.String, body: S.Unknown },
  messages: [Mutated, Failed],
  execute: ({ path, body }) =>
    request(path, body).pipe(
      Effect.as(Mutated.make({})),
      Effect.catch((e) =>
        Effect.succeed(Failed.make({ error: String(e), mutation: true })),
      ),
    ),
});
const fold = Update.foldChild({
  update: Outliner.update,
  read: (model: Model) => Option.some(model.outline),
  write: (model, outline) => ({ ...model, outline }),
  toParentMessage: msg.Child,
});
export const dirty = (m: Model) =>
  m.data !== null && diff(m.data.snapshot.nodes, m.outline.items).length > 0;
export const available = (m: Model) =>
  m.data !== null && !m.busy && m.sent === null && !dirty(m) && !m.blocked;
const reloadItems = (m: Model, data: OutlineView): Model => {
  const items = toItems(data.snapshot.nodes, m.outline.items);
  // Polling must not reset caret/undo history. Replace only actual document changes.
  if (JSON.stringify(items) === JSON.stringify(m.outline.items))
    return { ...m, data };
  const loaded = Outliner.update(
    m.outline,
    Outliner.Message.Load({ items }),
  ).model;
  return {
    ...m,
    data,
    outline: {
      ...loaded,
      focus:
        m.outline.focus &&
        data.snapshot.nodes.some((n) => n.id === m.outline.focus!.id)
          ? m.outline.focus
          : null,
    },
  };
};
export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message> => {
  const mutate = (
    path: string,
    body: unknown,
  ): Update.Return<Model, Message> =>
    available(model)
      ? {
          model: { ...model, busy: true, error: "" },
          commands: [Mutate({ path, body })],
        }
      : { model };
  switch (message._tag) {
    case "Child": {
      const child = message.message;
      if (child._tag === "Pressed" && child.action === "Split") {
        const node = find(model.outline.items, child.id);
        if (node && /(?:^|\s)\/run$/.test(node.text)) {
          const text = node.text.replace(/\s*\/run$/, "");
          const result = fold(
            model,
            Outliner.Message.EditedText({
              id: child.id,
              text,
              start: text.length,
              end: text.length,
              time: Date.now(),
            }),
          );
          return {
            ...result,
            model: { ...result.model, delegating: child.id },
          };
        }
      }
      return fold(model, child);
    }
    case "DismissRun":
      return { model: { ...model, delegating: null } };
    case "ChooseAgent":
      return { model: { ...model, agent: message.agent } };
    case "Attach":
      return {
        model: {
          ...model,
          opened: model.opened.includes(message.runId)
            ? model.opened.filter((id) => id !== message.runId)
            : [...model.opened, message.runId],
        },
      };
    case "Start":
      return mutate("/runs", { nodeId: message.nodeId, agent: model.agent });
    case "Review":
      return mutate("/review", {
        proposalId: message.proposalId,
        decision: message.decision,
        ...(message.nodeIds.length ? { nodeIds: message.nodeIds } : {}),
      });
    case "Control":
      return mutate("/control", {
        runId: message.runId,
        action: message.action,
        ...(message.action === "permission"
          ? { requestId: message.requestId, optionId: message.optionId }
          : {}),
      });
    case "Discard":
      return {
        model: {
          ...model,
          blocked: false,
          error: "",
          data: null,
          sent: null,
          reading: true,
        },
        commands: [Load({})],
      };
    case "Refresh":
      return { model: { ...model, blocked: false, error: "" } };
    case "Mutated":
      return {
        model: { ...model, busy: false, reading: true, delegating: null },
        commands: [Load({})],
      };
    case "Read": {
      const next = { ...model, reading: false };
      // A response started before a keystroke never overwrites a draft.
      if (dirty(model) || model.sent !== null || model.busy)
        return { model: next };
      return {
        model: {
          ...reloadItems(next, message.data),
          error: model.blocked ? model.error : "",
        },
      };
    }
    case "Saved": {
      if (model.data === null || model.sent === null) return { model };
      // Rebase keystrokes typed during the request onto its acknowledged result.
      // Disjoint concurrent edits stay present; the next batch retains this base revision.
      const delta = diff(asNodes(model.sent), model.outline.items);
      const items = toItems(
        replay(message.snapshot.nodes, delta),
        model.outline.items,
      );
      const outline = renewDeletedIds(
        { ...model.outline, items },
        message.snapshot.tombstones,
        () => crypto.randomUUID(),
      );
      const next: Model = {
        ...model,
        sent: null,
        error: "",
        data: { ...model.data, snapshot: message.snapshot },
        outline,
      };
      if (outline.focus && outline.focus.id !== model.outline.focus?.id)
        return fold(next, Outliner.Message.Reveal({ id: outline.focus.id }));
      return {
        model: {
          ...model,
          sent: null,
          error: "",
          data: { ...model.data, snapshot: message.snapshot },
          outline,
        },
      };
    }
    case "Failed":
      return {
        model: {
          ...model,
          reading: false,
          busy: false,
          sent: message.mutation ? null : model.sent,
          blocked: message.mutation || model.blocked,
          error: message.error,
        },
      };
    case "Tick": {
      if (model.busy || model.sent !== null || model.blocked) return { model };
      const operations = model.data
        ? diff(model.data.snapshot.nodes, model.outline.items)
        : [];
      if (operations.length && model.data)
        return {
          model: { ...model, sent: model.outline.items },
          commands: [
            Save({
              batch: { baseRevision: model.data.snapshot.revision, operations },
            }),
          ],
        };
      if (model.reading) return { model };
      return { model: { ...model, reading: true }, commands: [Load({})] };
    }
  }
};
const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  poll: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Stream.tick("700 millis").pipe(Stream.map(msg.Tick)),
    },
  ),
}));
export const run = () =>
  Runtime.run(
    Runtime.makeApplication({
      Model,
      Flags: S.Struct({}),
      init: () => ({
        model: {
          outline: Outliner.init({
            id: `local-${crypto.randomUUID().slice(0, 8)}`,
            items: [],
          }),
          data: null,
          sent: null,
          reading: true,
          busy: false,
          error: "",
          blocked: false,
          agent: "shell" as const,
          opened: [],
          delegating: null,
        },
        commands: [Load({})],
      }),
      update,
      view,
      subscriptions,
      container: document.getElementById("root"),
    }),
    { flags: Effect.succeed({}) },
  );
