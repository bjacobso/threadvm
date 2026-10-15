// Agents' pending suggestions and questions appear inside the outline as
// read-only "ghost" rows. They live in the outliner's items so they nest,
// fold, and scroll with everything else, but they are never saved: the real
// document is the outline with every ghost removed, and ghosts are projected
// again from the threads after every change.
import {
  isActive,
  pendingOps,
  type Item,
  type Items,
  type Op,
  type Thread,
} from "../shared/protocol.ts";
import { filterItems, find, item, updateItem } from "../shared/tree.ts";

const GHOST = "~";

export const isGhost = (id: string): boolean => id.startsWith(GHOST);

const insertedId = (opId: string, itemId: string) =>
  `${GHOST}${opId}${GHOST}${itemId}`;
const questionId = (threadId: string) => `${GHOST}ask${GHOST}${threadId}`;

/** What a ghost row stands for. */
export type Ghost =
  | Readonly<{
      _tag: "Inserted";
      thread: Thread;
      op: Extract<Op, { _tag: "Insert" }>;
      root: boolean;
    }>
  | Readonly<{ _tag: "Question"; thread: Thread }>;

export const realItems = (items: Items): Items =>
  filterItems(items, (node) => !isGhost(node.id));

const ghostly = (opId: string, items: Items): Items =>
  items.map((node) => ({
    ...node,
    id: insertedId(opId, node.id),
    children: ghostly(opId, node.children),
  }));

/** Inserts without unfolding the parent: a folded branch shows its suggestions as a count. */
const placeUnder = (
  items: Items,
  parentId: string | null,
  afterId: string | null,
  inserted: Items,
) =>
  parentId === null
    ? [...items, ...inserted]
    : updateItem(items, parentId, (parent) => {
        const index =
          afterId === null
            ? -1
            : parent.children.findIndex((c) => c.id === afterId);
        const at = index < 0 ? parent.children.length : index + 1;
        return {
          ...parent,
          children: [
            ...parent.children.slice(0, at),
            ...inserted,
            ...parent.children.slice(at),
          ],
        };
      });

export const byCreation = (
  threads: Readonly<Record<string, Thread>>,
): ReadonlyArray<Thread> =>
  Object.values(threads).sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );

/** Whether a thread's pending suggestions should be on screen. */
const showsSuggestions = (thread: Thread) =>
  thread.status !== "Cancelled" && thread.status !== "Failed";

export const project = (
  real: Items,
  threads: Readonly<Record<string, Thread>>,
): Items => {
  let items = real;
  for (const thread of byCreation(threads)) {
    if (
      find(real, thread.nodeId) === undefined &&
      !pendingOps(thread).some(
        (op) => op._tag === "Insert" && op.parentId === null,
      )
    )
      continue;
    if (thread.status === "NeedsInput" && thread.question !== null) {
      const prompt = thread.question.prompt;
      items = updateItem(items, thread.nodeId, (node) => ({
        ...node,
        children: [item(questionId(thread.id), prompt), ...node.children],
      }));
    }
    if (!showsSuggestions(thread)) continue;
    for (const op of pendingOps(thread)) {
      if (
        op._tag === "Insert" &&
        (op.parentId === null || find(real, op.parentId) !== undefined)
      )
        items = placeUnder(
          items,
          op.parentId,
          op.afterId,
          ghostly(op.id, op.items),
        );
    }
  }
  return items;
};

/** Resolves every ghost row id to the thread and suggestion behind it. */
export const ghostsOf = (
  threads: Readonly<Record<string, Thread>>,
): ReadonlyMap<string, Ghost> => {
  const ghosts = new Map<string, Ghost>();
  for (const thread of Object.values(threads)) {
    ghosts.set(questionId(thread.id), { _tag: "Question", thread });
    for (const op of thread.proposal?.ops ?? []) {
      if (op._tag !== "Insert") continue;
      const visit = (items: Items, root: boolean) => {
        for (const node of items) {
          ghosts.set(insertedId(op.id, node.id), {
            _tag: "Inserted",
            thread,
            op,
            root,
          });
          visit(node.children, false);
        }
      };
      visit(op.items, true);
    }
  }
  return ghosts;
};

/** Pending edits and completions, which decorate existing bullets rather than add rows. */
export const inlineSuggestions = (
  threads: Readonly<Record<string, Thread>>,
): ReadonlyMap<string, ReadonlyArray<Readonly<{ thread: Thread; op: Op }>>> => {
  const byNode = new Map<string, Array<Readonly<{ thread: Thread; op: Op }>>>();
  for (const thread of byCreation(threads)) {
    if (!showsSuggestions(thread)) continue;
    for (const op of pendingOps(thread)) {
      if (op._tag === "Insert") continue;
      byNode.set(op.nodeId, [...(byNode.get(op.nodeId) ?? []), { thread, op }]);
    }
  }
  return byNode;
};

const sameItem = (a: Item, b: Item): boolean =>
  a === b ||
  (a.id === b.id &&
    a.text === b.text &&
    a.collapsed === b.collapsed &&
    a.checked === b.checked &&
    sameItems(a.children, b.children));

export const sameItems = (a: Items, b: Items): boolean =>
  a === b ||
  (a.length === b.length &&
    a.every((node, index) => sameItem(node, b[index]!)));

/** The latest thread anchored to each bullet. */
export const latestByNode = (
  threads: Readonly<Record<string, Thread>>,
): ReadonlyMap<string, Thread> => {
  const latest = new Map<string, Thread>();
  for (const thread of byCreation(threads)) {
    if(latest.get(thread.nodeId)?.execution && !thread.execution) continue;
    latest.set(thread.nodeId, thread);
  }
  return latest;
};

export const activeOn = (
  threads: Readonly<Record<string, Thread>>,
  nodeId: string,
): boolean =>
  Object.values(threads).some(
    (thread) => thread.nodeId === nodeId && isActive(thread.status),
  );
