// The outline a new room starts with: one plan that shows every state an
// agent thread can be in, including a question two levels below a folded branch.
import type { Items, Thread } from "../shared/protocol.ts";
import { contextOf, find, item, updateItem } from "../shared/tree.ts";
import { mentionedAgent } from "../shared/agents.ts";
import { fastForward, newThread } from "./simulator.ts";

const MINUTE = 60_000;

const outline: Items = [
  item("launch", "Launch shared team workspaces", [
    item("goals", "Goals #context", [
      item("goal-share", "Teams share outlines, threads, and agent results"),
      item("goal-flag", "Ship behind the team-workspaces flag by Nov 14"),
    ]),
    item(
      "backend",
      "Backend",
      [item("plan", "@conductor break down sharing and permissions")],
      { collapsed: true },
    ),
    item("frontend", "Frontend", [
      item("dialog", "@cursor build the share dialog"),
      item(
        "invites",
        "Invite flow",
        [
          item("invite-mail", "@claude send invite emails with magic links"),
          item("invite-copy", "Copy: “You’ve been invited to {workspace}”"),
        ],
        { collapsed: true },
      ),
    ]),
    item("questions", "Open questions", [
      item("q-auth", "How do agents authenticate against private repos? #decision"),
      item("q-pricing", "Do agent minutes count against the team plan?"),
    ]),
  ]),
  item("scratch", "Scratchpad", [
    item("try-1", "Write a task, mention @claude, @cursor, @codex, or @conductor, then press Return"),
    item("try-2", "Agents never edit the outline directly. Their changes arrive as suggestions"),
    item("try-3", "Questions from agents stack up on every folded branch above them"),
  ]),
];

const dispatch = (
  items: Items,
  nodeId: string,
  threadId: string,
  parentThreadId: string | null,
  now: number,
): Thread => {
  const node = find(items, nodeId)!;
  return newThread({
    id: threadId,
    nodeId,
    agent: mentionedAgent(node.text)!,
    prompt: node.text,
    contextSize: contextOf(items, nodeId).size,
    parentThreadId,
    now,
  });
};

export const seed = (now: number): Readonly<{ items: Items; threads: ReadonlyArray<Thread> }> => {
  let items = outline;
  const threads: Thread[] = [];

  // A finished thread whose suggestions were accepted earlier today.
  const invite = fastForward(dispatch(items, "invite-mail", "t-invite", null, now - 95 * MINUTE), items, {
    depth: 0,
    answer: "After 7 days",
    accept: true,
    now: now - 95 * MINUTE,
  });
  items = invite.items;
  threads.push(invite.thread);
  // Its accepted follow-up asked Codex for a review; keep the bullet, skip the run.
  items = updateItem(items, "invite-mail", (node) => ({
    ...node,
    children: node.children.filter((child) => !child.text.startsWith("@codex")),
  }));

  // Conductor planned the backend; the plan was accepted and fanned out.
  const plan = fastForward(dispatch(items, "plan", "t-plan", null, now - 40 * MINUTE), items, {
    depth: 0,
    accept: true,
    now: now - 40 * MINUTE,
  });
  items = plan.items;
  threads.push(plan.thread);
  const [api, ui, tests] = find(items, "plan")!.children;

  // Deep in the folded backend, two agents are waiting on a person.
  threads.push(
    fastForward(dispatch(items, api!.id, "t-api", "t-plan", now - 38 * MINUTE), items, {
      depth: 1,
      now: now - 38 * MINUTE,
    }).thread,
  );
  threads.push(
    fastForward(dispatch(items, ui!.id, "t-ui", "t-plan", now - 38 * MINUTE), items, {
      depth: 1,
      now: now - 37 * MINUTE,
    }).thread,
  );
  // And one has suggestions ready for review.
  threads.push(
    fastForward(dispatch(items, tests!.id, "t-tests", "t-plan", now - 38 * MINUTE), items, {
      depth: 1,
      now: now - 36 * MINUTE,
    }).thread,
  );

  // The share dialog starts fresh, so the room has live work when it opens.
  threads.push(dispatch(items, "dialog", "t-dialog", null, now));

  return { items, threads };
};
