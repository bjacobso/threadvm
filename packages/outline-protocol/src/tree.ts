// Pure outline operations shared by the browser and the Durable Object. The
// browser uses `@foldworks/outliner` for editing; these cover what both sides
// need to agree on: where an agent's suggestions land and what it can read.
import type { Item, Items, Op } from "./index.ts";

export const item = (
  id: string,
  text: string,
  children: Items = [],
  options: Readonly<{ collapsed?: boolean; checked?: boolean }> = {},
): Item => ({
  id,
  text,
  collapsed: options.collapsed ?? false,
  checked: options.checked ?? false,
  children,
});

export const walk = (items: Items): ReadonlyArray<Item> =>
  items.flatMap((node) => [node, ...walk(node.children)]);

export const find = (items: Items, id: string): Item | undefined => {
  for (const node of items) {
    if (node.id === id) return node;
    const found = find(node.children, id);
    if (found !== undefined) return found;
  }
  return undefined;
};

/** Ancestor ids, outermost first. */
export const pathTo = (
  items: Items,
  id: string,
): ReadonlyArray<string> | undefined => {
  for (const node of items) {
    if (node.id === id) return [];
    const below = pathTo(node.children, id);
    if (below !== undefined) return [node.id, ...below];
  }
  return undefined;
};

export const mapItems = (items: Items, f: (node: Item) => Item): Items =>
  items.map((node) => f({ ...node, children: mapItems(node.children, f) }));

export const updateItem = (
  items: Items,
  id: string,
  f: (node: Item) => Item,
): Items => {
  let changed = false;
  const next = items.map((node) => {
    if (node.id === id) {
      changed = true;
      return f(node);
    }
    const children = updateItem(node.children, id, f);
    if (children === node.children) return node;
    changed = true;
    return { ...node, children };
  });
  return changed ? next : items;
};

export const filterItems = (
  items: Items,
  keep: (node: Item) => boolean,
): Items => {
  let changed = false;
  const next: Item[] = [];
  for (const node of items) {
    if (!keep(node)) {
      changed = true;
      continue;
    }
    const children = filterItems(node.children, keep);
    if (children !== node.children) changed = true;
    next.push(children === node.children ? node : { ...node, children });
  }
  return changed ? next : items;
};

/** Inserts after a sibling, or at the end of the parent's children when the sibling is gone. */
export const insertUnder = (
  items: Items,
  parentId: string | null,
  afterId: string | null,
  inserted: Items,
): Items =>
  parentId === null
    ? [
        ...items.slice(
          0,
          afterId === null
            ? items.length
            : items.findIndex((n) => n.id === afterId) + 1,
        ),
        ...inserted,
        ...items.slice(
          afterId === null
            ? items.length
            : items.findIndex((n) => n.id === afterId) + 1,
        ),
      ]
    : updateItem(items, parentId, (parent) => {
        const index =
          afterId === null
            ? -1
            : parent.children.findIndex((c) => c.id === afterId);
        const at = index < 0 ? parent.children.length : index + 1;
        return {
          ...parent,
          collapsed: false,
          children: [
            ...parent.children.slice(0, at),
            ...inserted,
            ...parent.children.slice(at),
          ],
        };
      });

/** Applies an accepted suggestion. Suggestions whose anchor is gone change nothing. */
export const applyOp = (items: Items, op: Op): Items => {
  switch (op._tag) {
    case "Structural":
      return items;
    case "Insert":
      return insertUnder(items, op.parentId, op.afterId, op.items);
    case "Edit":
      return updateItem(items, op.nodeId, (node) => ({
        ...node,
        text: op.after,
      }));
    case "Complete":
      return updateItem(items, op.nodeId, (node) => ({
        ...node,
        checked: true,
      }));
  }
};

/** Whether an accepted suggestion's effect is still in the outline, for undo and redo. */
export const isApplied = (items: Items, op: Op): boolean => {
  switch (op._tag) {
    case "Structural":
      return false;
    case "Insert":
      return op.items.every(
        (inserted) => find(items, inserted.id) !== undefined,
      );
    case "Edit":
      return find(items, op.nodeId)?.text === op.after;
    case "Complete":
      return find(items, op.nodeId)?.checked === true;
  }
};

/** What an agent can see: the path to its bullet and everything beneath it. */
export const contextOf = (
  items: Items,
  nodeId: string,
): Readonly<{
  path: ReadonlyArray<Item>;
  node: Item | undefined;
  size: number;
}> => {
  const node = find(items, nodeId);
  const path = (pathTo(items, nodeId) ?? []).flatMap(
    (id) => find(items, id) ?? [],
  );
  return { path, node, size: path.length + (node ? walk([node]).length : 0) };
};

/** Indented plain text, for showing an agent's context. */
export const toText = (items: Items, depth = 0): string =>
  items
    .map(
      (node) =>
        `${"  ".repeat(depth)}- ${node.checked ? "[x] " : ""}${node.text}\n${toText(node.children, depth + 1)}`,
    )
    .join("");
