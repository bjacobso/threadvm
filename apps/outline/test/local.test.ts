import { renewDeletedIds } from "../src/client/history.ts";
import { Outliner } from "@foldworks/outliner";
import { describe, expect, it } from "vitest";
import { diff, replay, toItems } from "@threadvm/outline-protocol/document";
import type { Node } from "@threadvm/shared/domain";
const node = (id: string, parent: string | null = null): Node => ({
  id,
  parent,
  text: id,
  done: false,
  changedAt: 0,
});
describe("local outline batches", () => {
  it("moves a surviving child out before deleting its old parent", () => {
    const before = [node("a"), node("b", "a"), node("c")];
    const desired = toItems([node("c"), node("b", "c")]);
    const operations = diff(before, desired);
    expect(operations.map((o) => o.type)).toEqual(["move", "move", "delete"]);
    expect(toItems(replay(before, operations))).toEqual(desired);
  });
  it("preserves disjoint server inserts when rebasing keystrokes typed during a save", () => {
    const sent = [node("a")];
    const typed = toItems([{ ...node("a"), text: "next keystrokes" }]);
    const acknowledged = [node("a"), node("remote")];
    expect(toItems(replay(acknowledged, diff(sent, typed)))).toEqual(
      toItems([{ ...node("a"), text: "next keystrokes" }, node("remote")]),
    );
  });
  it("does not write collapse preferences into the shared outline", () => {
    const before = [node("a"), node("b", "a")];
    const items = toItems(before).map((n) => ({ ...n, collapsed: true }));
    expect(diff(before, items)).toEqual([]);
  });
  it("emits parent-first inserts, sibling ordering, and checked state", () => {
    const before = [node("old")];
    const desired = toItems([
      node("new"),
      node("child", "new"),
      { ...node("old"), done: true },
    ]);
    expect(toItems(replay(before, diff(before, desired)))).toEqual(desired);
  });
});

it("renews deleted identities in undo history without changing surviving IDs", () => {
  const original = toItems([
    node("kept"),
    node("deleted"),
    node("child", "deleted"),
  ]);
  const base = Outliner.init({ id: "test", items: toItems([node("kept")]) });
  const model = {
    ...base,
    history: {
      past: [{ items: original, focus: { id: "deleted", start: 0, end: 0 } }],
      future: [],
      coalescingKey: null,
    },
  };
  let counter = 0;
  const renewed = renewDeletedIds(
    model,
    { deleted: 1, child: 1 },
    () => `restored-${++counter}`,
  );
  const restored = Outliner.update(
    renewed,
    Outliner.Message.ClickedUndo(),
  ).model;
  expect(restored.items.map((n) => n.id)).toEqual(["kept", "restored-1"]);
  expect(restored.items[1]!.children[0]!.id).toEqual("restored-2");
  expect(restored.focus?.id).toBe("restored-1");
  expect(
    diff([node("kept")], restored.items)
      .filter((op) => op.type === "insert")
      .map((op) => op.node.id),
  ).toEqual(["restored-1", "restored-2"]);
});

import { init } from "../src/client/model.ts";
import { update } from "../src/client/update.ts";
import { Message } from "../src/client/message.ts";
const backend = {
  kind: "local" as const,
  revision: 1,
  projectDir: "/tmp/project",
  remote: "",
  branch: "main",
  available: ["shell" as const],
  tombstones: {},
};
it("keeps local keystrokes and disjoint remote inserts when a save is acknowledged", () => {
  const base = toItems([node("a")]);
  const sent = toItems([{ ...node("a"), text: "sent" }]);
  const typed = toItems([{ ...node("a"), text: "new keystrokes" }]);
  const model = {
    ...init({ outlineId: "local", sessionId: "tab" }),
    backend,
    synced: true,
    connection: "Online" as const,
    canonical: base,
    outline: { ...Outliner.init({ id: "test", items: typed }), revision: 3 },
    savedRevision: 1,
    inFlight: {
      requestId: "save-1",
      items: sent,
      baseItems: base,
      baseRevision: 1,
      editorRevision: 2,
    },
  };
  const acknowledged = toItems([
    { ...node("a"), text: "sent" },
    node("other-tab"),
  ]);
  const result = update(
    model,
    Message.ReceivedServerMessage({
      message: {
        _tag: "DocumentChanged",
        items: acknowledged,
        backend: { ...backend, revision: 3 },
        requestId: "save-1",
      },
    }),
  );
  expect(result.model.outline.items.map((n) => n.text)).toEqual([
    "new keystrokes",
    "other-tab",
  ]);
  expect(result.model.inFlight?.baseRevision).toBe(3);
  expect(result.model.inFlight?.items[0]?.text).toBe("new keystrokes");
});
it("retains an unacknowledged batch across a reconnect and never overwrites a draft with a snapshot", () => {
  const base = toItems([node("a")]),
    sent = toItems([{ ...node("a"), text: "offline draft" }]);
  const inFlight = {
    requestId: "retry-same-id",
    items: sent,
    baseItems: base,
    baseRevision: 1,
    editorRevision: 2,
  };
  const model = {
    ...init({ outlineId: "local", sessionId: "tab" }),
    backend,
    synced: true,
    connection: "Online" as const,
    canonical: base,
    outline: { ...Outliner.init({ id: "test", items: sent }), revision: 2 },
    savedRevision: 1,
    inFlight,
  };
  const result = update(
    model,
    Message.ReceivedServerMessage({
      message: { _tag: "Snapshot", items: base, threads: [], backend },
    }),
  );
  expect(result.model.outline.items).toEqual(sent);
  expect(result.model.inFlight).toEqual(inFlight);
  expect(result.commands).toHaveLength(1);
});
