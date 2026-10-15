import type { Node, OutlineOperation } from "@threadvm/shared/domain";
import type { Items } from "../shared/protocol.ts";

export const toItems = (
  nodes: ReadonlyArray<Node>,
  preferences: Items = [],
): Items => {
  const collapsed = new Map(
    flatten(preferences).map((n) => [n.id, n.collapsed]),
  );
  const visit = (parent: string | null): Items =>
    nodes
      .filter((n) => n.parent === parent)
      .map((n) => ({
        id: n.id,
        text: n.text,
        checked: n.done,
        collapsed: collapsed.get(n.id) ?? false,
        children: visit(n.id),
      }));
  return visit(null);
};
export const flatten = (
  items: Items,
): Array<{
  id: string;
  text: string;
  done: boolean;
  parent: string | null;
  after: string | null;
  collapsed: boolean;
}> => {
  const result: ReturnType<typeof flatten> = [];
  const visit = (items: Items, parent: string | null) => {
    let after: string | null = null;
    for (const n of items) {
      result.push({
        id: n.id,
        text: n.text,
        done: n.checked,
        parent,
        after,
        collapsed: n.collapsed,
      });
      visit(n.children, n.id);
      after = n.id;
    }
  };
  visit(items, null);
  return result;
};

// Simulates ordering only. Server-side applyOperations remains the authority for
// conflicts, immutable IDs, deleted anchors and atomic validation.
export const replay = (
  source: ReadonlyArray<Node>,
  operations: ReadonlyArray<OutlineOperation>,
): Node[] => {
  let nodes = [...source];
  for (const op of operations) {
    if (op.type === "update")
      nodes = nodes.map((n) =>
        n.id === op.id
          ? {
              ...n,
              text: op.patch.text ?? n.text,
              done: op.patch.done ?? n.done,
            }
          : n,
      );
    else if (op.type === "delete") {
      const removed = new Set([op.id]);
      let more = true;
      while (more) {
        more = false;
        for (const n of nodes)
          if (n.parent && removed.has(n.parent) && !removed.has(n.id)) {
            removed.add(n.id);
            more = true;
          }
      }
      nodes = nodes.filter((n) => !removed.has(n.id));
    } else {
      const node =
        op.type === "insert"
          ? { ...op.node, parent: op.parent, changedAt: 0 }
          : { ...nodes.find((n) => n.id === op.id)!, parent: op.parent };
      nodes = nodes.filter((n) => n.id !== node.id);
      const siblings = nodes.filter((n) => n.parent === node.parent);
      const after = op.after === undefined ? siblings.at(-1)?.id : op.after;
      const index = after
        ? nodes.findIndex((n) => n.id === after) + 1
        : siblings.length
          ? nodes.findIndex((n) => n.id === siblings[0]!.id)
          : nodes.length;
      nodes.splice(index, 0, node);
    }
  }
  return nodes;
};
export const asNodes = (items: Items): Node[] =>
  flatten(items).map(({ id, text, done, parent }) => ({
    id,
    text,
    done,
    parent,
    changedAt: 0,
  }));
export const diff = (
  before: ReadonlyArray<Node>,
  items: Items,
): OutlineOperation[] => {
  let working = [...before];
  const desired = flatten(items),
    wanted = new Set(desired.map((n) => n.id));
  const operations: OutlineOperation[] = [];
  const add = (op: OutlineOperation) => {
    operations.push(op);
    working = replay(working, [op]);
  };
  for (const next of desired) {
    const previous = working.find((n) => n.id === next.id);
    if (!previous)
      add({
        type: "insert",
        parent: next.parent,
        after: next.after,
        node: { id: next.id, text: next.text, done: next.done },
      });
    else {
      if (previous.text !== next.text || previous.done !== next.done)
        add({
          type: "update",
          id: next.id,
          patch: { text: next.text, done: next.done },
        });
      const siblings = working.filter((n) => n.parent === previous.parent);
      const after =
        siblings[siblings.findIndex((n) => n.id === next.id) - 1]?.id ?? null;
      if (previous.parent !== next.parent || after !== next.after)
        add({
          type: "move",
          id: next.id,
          parent: next.parent,
          after: next.after,
        });
    }
  }
  for (const node of [...working])
    if (!wanted.has(node.id) && working.some((n) => n.id === node.id))
      add({ type: "delete", id: node.id });
  return operations;
};

/** Undo restores content with fresh identities after a committed deletion.
 * Tombstoned IDs may never re-enter the canonical document. Rewrite history
 * before Foldworks restores it so its native focus commands use the new IDs. */
export const renewDeletedIds = (
  outline: import("@foldworks/outliner").Outliner.Model,
  tombstones: Readonly<Record<string, number>>,
  fresh: () => string,
): import("@foldworks/outliner").Outliner.Model => {
  const aliases = new Map<string, string>();
  for (const items of [
    outline.items,
    ...outline.history.past.map((s) => s.items),
    ...outline.history.future.map((s) => s.items),
  ])
    for (const node of flatten(items))
      if (Object.hasOwn(tombstones, node.id) && !aliases.has(node.id))
        aliases.set(node.id, fresh());
  if (aliases.size === 0) return outline;
  const id = (value: string) => aliases.get(value) ?? value;
  const items = (value: Items): Items =>
    value.map((node) => ({
      ...node,
      id: id(node.id),
      children: items(node.children),
    }));
  const focus = (value: typeof outline.focus) =>
    value === null ? null : { ...value, id: id(value.id) };
  const snapshot = (value: (typeof outline.history.past)[number]) => ({
    items: items(value.items),
    focus: focus(value.focus),
  });
  return {
    ...outline,
    items: items(outline.items),
    focus: focus(outline.focus),
    scopeId: outline.scopeId === null ? null : id(outline.scopeId),
    selection:
      outline.selection === null
        ? null
        : {
            anchorId: id(outline.selection.anchorId),
            headId: id(outline.selection.headId),
          },
    drag: null,
    hover: null,
    completion: null,
    history: {
      ...outline.history,
      past: outline.history.past.map(snapshot),
      future: outline.history.future.map(snapshot),
    },
  };
};
