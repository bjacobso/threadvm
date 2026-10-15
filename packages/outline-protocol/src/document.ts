import type { Node, OutlineOperation } from "@threadvm/shared/domain";
import type { Items } from "./index.ts";

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
          patch: {
            ...(previous.text !== next.text ? { text: next.text } : {}),
            ...(previous.done !== next.done ? { done: next.done } : {}),
          },
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
