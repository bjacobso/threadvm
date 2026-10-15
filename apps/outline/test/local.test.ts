import { Outliner } from "@foldworks/outliner";
import { describe, expect, it } from "vitest";
import {
  diff,
  replay,
  toItems,
  renewDeletedIds,
} from "../src/local/document.ts";
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

it("coalesces ACP transport chunks into readable messages and retains code links", async () => {
  const { activity } = await import("../src/local/activity.ts");
  const base = {
    id: "event",
    runId: "run",
    nodeId: "node",
    time: 1,
    kind: "agent" as const,
  };
  const lines = activity(
    [
      {
        ...base,
        agent: {
          type: "update",
          payload: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Wrote " },
          },
        },
      },
      {
        ...base,
        agent: {
          type: "update",
          payload: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "the proof file." },
          },
        },
      },
      { ...base, kind: "commit", message: "abc123", codeSha: "abc123" },
      {
        ...base,
        agent: {
          type: "update",
          payload: { sessionUpdate: "usage_update", used: 20 },
        },
      },
    ],
    "run",
  );
  expect(lines.map((line) => line.text)).toEqual([
    "Wrote the proof file.",
    "Code commit abc123",
  ]);
});
