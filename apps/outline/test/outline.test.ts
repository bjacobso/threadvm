import { describe, expect, it } from "vitest";

import { mentionedAgent, taskOf } from "../src/shared/agents.ts";
import type { Items, Thread } from "../src/shared/protocol.ts";
import { applyOp, find, isApplied, item, walk } from "../src/shared/tree.ts";
import { attentionQueue, rollups } from "../src/client/attention.ts";
import { ghostsOf, project, realItems } from "../src/client/projection.ts";
import { fastForward, newThread, scriptFor } from "../src/worker/simulator.ts";
import { seed } from "../src/worker/seed.ts";

const outline: Items = [
  item("root", "Project", [
    item(
      "branch",
      "Backend",
      [item("task", "@claude add rate limiting to login")],
      {
        collapsed: true,
      },
    ),
  ]),
];

const threadOn = (nodeId: string, id = "t1"): Thread =>
  newThread({
    id,
    nodeId,
    agent: "claude",
    prompt: find(outline, nodeId)!.text,
    contextSize: 3,
    parentThreadId: null,
    now: 0,
  });

describe("mentions", () => {
  it("finds the first agent and strips mentions from the task", () => {
    expect(mentionedAgent("ask @Cursor then @claude")).toBe("cursor");
    expect(mentionedAgent("email me@claude.ai")).toBeUndefined();
    expect(taskOf("@claude: add rate limiting")).toBe("add rate limiting");
  });
});

describe("a run", () => {
  it("stops for a question, then for review, then finishes", () => {
    const asked = fastForward(threadOn("task"), outline, {
      depth: 0,
      now: 0,
    }).thread;
    expect(asked.status).toBe("NeedsInput");
    expect(asked.question?.options.length).toBeGreaterThan(1);

    const reviewing = fastForward(asked, outline, {
      depth: 0,
      answer: "Behind the flag",
      now: 0,
    }).thread;
    expect(reviewing.status).toBe("Review");
    expect(reviewing.proposal?.ops.every((op) => op.state === "Pending")).toBe(
      true,
    );

    const done = fastForward(reviewing, outline, {
      depth: 0,
      accept: true,
      now: 0,
    });
    expect(done.thread.status).toBe("Done");
    expect(find(done.items, "task")?.checked).toBe(true);
    expect(
      walk(done.items).some((node) =>
        node.text.startsWith("Decision: Behind the flag"),
      ),
    ).toBe(true);
  });

  it("stops delegating two levels down", () => {
    const deep = scriptFor(threadOn("task"), { items: outline, depth: 2 });
    const proposed = deep.flatMap((beat) =>
      beat._tag === "Propose" ? beat.ops : [],
    );
    const inserted = proposed.flatMap((op) =>
      op._tag === "Insert" ? walk(op.items) : [],
    );
    expect(
      inserted.some((node) => mentionedAgent(node.text) !== undefined),
    ).toBe(false);
  });
});

describe("suggestions in the outline", () => {
  const reviewing = fastForward(
    fastForward(threadOn("task"), outline, { depth: 0, now: 0 }).thread,
    outline,
    { depth: 0, answer: "Ship it directly", now: 0 },
  ).thread;
  const threads = { [reviewing.id]: reviewing };

  it("projects ghosts that never reach the saved document", () => {
    const projected = project(outline, threads);
    const ghosts = ghostsOf(threads);
    expect(
      walk(projected).filter((node) => ghosts.has(node.id)).length,
    ).toBeGreaterThan(0);
    expect(realItems(projected)).toEqual(outline);
    // A folded branch keeps its suggestions folded away.
    expect(find(projected, "branch")?.collapsed).toBe(true);
  });

  it("knows when undo has taken an accepted suggestion back", () => {
    const op = reviewing.proposal!.ops[0]!;
    const accepted = applyOp(outline, op);
    expect(isApplied(accepted, op)).toBe(true);
    expect(isApplied(outline, op)).toBe(false);
  });
});

describe("attention", () => {
  it("rolls a deep question up through every ancestor", () => {
    const asked = fastForward(threadOn("task"), outline, {
      depth: 0,
      now: 0,
    }).thread;
    const tallies = rollups(outline, { [asked.id]: asked });
    expect(tallies.get("root")?.NeedsInput).toBe(1);
    expect(tallies.get("branch")?.NeedsInput).toBe(1);
    expect(tallies.has("task")).toBe(false);
    expect(attentionQueue(outline, { [asked.id]: asked })[0]?.kind).toBe(
      "NeedsInput",
    );
  });
});

describe("the demo outline", () => {
  it("starts with work in every state", () => {
    const { items, threads } = seed(Date.now());
    const statuses = new Set(threads.map((thread) => thread.status));
    expect(statuses).toEqual(
      new Set(["Done", "NeedsInput", "Review", "Queued"]),
    );
    for (const thread of threads)
      expect(find(items, thread.nodeId)).toBeDefined();
  });
});

it("shows a CLI proposal for the first root bullet before it exists", () => {
  const thread: Thread = {
    ...threadOn("task"),
    nodeId: "new-root",
    status: "Review",
    proposal: {
      id: "cli",
      summary: "Add a root",
      ops: [
        {
          _tag: "Insert",
          id: "op-root",
          parentId: null,
          afterId: null,
          state: "Pending",
          items: [item("new-root", "Proposed project")],
        },
      ],
    },
  };
  expect(project([], { cli: thread })[0]?.text).toBe("Proposed project");
  expect(realItems(project([], { cli: thread }))).toEqual([]);
  expect(attentionQueue([], { cli: thread })[0]?.kind).toBe("Review");
});
