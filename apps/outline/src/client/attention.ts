// What needs a person, and where. Counts roll up through every ancestor, so a
// question five levels down still shows on the folded branch you can see.
import { AGENTS } from "../shared/agents.ts";
import {
  isActive,
  pendingOps,
  type Items,
  type Thread,
} from "../shared/protocol.ts";
import { find, walk } from "../shared/tree.ts";
import { byCreation } from "./projection.ts";

export type Kind = "NeedsInput" | "Review" | "Working";

export type Tally = Readonly<Record<Kind, number>>;

const EMPTY: Tally = { NeedsInput: 0, Review: 0, Working: 0 };

export const kindOf = (thread: Thread): Kind | undefined => {
  if (thread.status === "NeedsInput") return "NeedsInput";
  if (
    thread.status !== "Cancelled" &&
    thread.status !== "Failed" &&
    pendingOps(thread).length > 0
  )
    return "Review";
  if (isActive(thread.status)) return "Working";
  return undefined;
};

/** Threads that want something, most urgent first, in outline order within each kind. */
export const attentionQueue = (
  items: Items,
  threads: Readonly<Record<string, Thread>>,
): ReadonlyArray<Readonly<{ thread: Thread; kind: Kind }>> => {
  const order = new Map(walk(items).map((node, index) => [node.id, index]));
  const rank: Record<Kind, number> = { NeedsInput: 0, Review: 1, Working: 2 };
  return byCreation(threads)
    .flatMap((thread) => {
      const kind = kindOf(thread);
      return kind !== undefined &&
        (order.has(thread.nodeId) ||
          pendingOps(thread).some(
            (op) => op._tag === "Insert" && op.parentId === null,
          ))
        ? [{ thread, kind }]
        : [];
    })
    .sort(
      (a, b) =>
        rank[a.kind] - rank[b.kind] ||
        (order.get(a.thread.nodeId) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.thread.nodeId) ?? Number.MAX_SAFE_INTEGER),
    );
};

/** For each bullet, what its descendants' threads want. Its own threads are not counted. */
export const rollups = (
  items: Items,
  threads: Readonly<Record<string, Thread>>,
): ReadonlyMap<string, Tally> => {
  const own = new Map<string, Tally>();
  for (const thread of Object.values(threads)) {
    const kind = kindOf(thread);
    if (kind === undefined) continue;
    const tally = own.get(thread.nodeId) ?? EMPTY;
    own.set(thread.nodeId, { ...tally, [kind]: tally[kind] + 1 });
  }
  const result = new Map<string, Tally>();
  const visit = (nodes: Items): Tally =>
    nodes.reduce<Tally>((sum, node) => {
      const below = visit(node.children);
      if (below.NeedsInput + below.Review + below.Working > 0)
        result.set(node.id, below);
      const mine = own.get(node.id) ?? EMPTY;
      return {
        NeedsInput: sum.NeedsInput + below.NeedsInput + mine.NeedsInput,
        Review: sum.Review + below.Review + mine.Review,
        Working: sum.Working + below.Working + mine.Working,
      };
    }, EMPTY);
  visit(items);
  return result;
};

export const totals = (
  items: Items,
  threads: Readonly<Record<string, Thread>>,
): Tally =>
  attentionQueue(items, threads).reduce<Tally>(
    (sum, { kind }) => ({ ...sum, [kind]: sum[kind] + 1 }),
    EMPTY,
  );

export const agentName = (thread: Thread): string => AGENTS[thread.agent].name;

/** Announced when a thread starts wanting something. */
export const announcementFor = (
  before: Thread | undefined,
  after: Thread,
  items: Items,
): string => {
  const title = find(items, after.nodeId)?.text ?? after.prompt;
  const name = agentName(after);
  if (after.status === "NeedsInput" && before?.status !== "NeedsInput")
    return `${name} needs your input on “${title}”.`;
  if (after.status === "Review" && before?.status !== "Review")
    return `${name} suggested ${pendingOps(after).length} change${pendingOps(after).length === 1 ? "" : "s"} to “${title}”.`;
  if (after.status === "Done" && before?.status !== "Done")
    return `${name} finished “${title}”.`;
  return "";
};
