// Deterministic stand-ins for agent harnesses. A script is a list of beats
// computed from the thread and the outline; the Durable Object plays one beat
// at a time and records `cursor`, so a run resumes where it stopped after the
// object restarts. Nothing here touches a real sandbox or provider.
import { agentInfo, taskOf } from "../shared/agents.ts";
import type {
  Activity,
  Items,
  Link,
  Op,
  Question,
  StepKind,
  Thread,
} from "../shared/protocol.ts";
import { applyOp, contextOf, item } from "../shared/tree.ts";

export type Beat =
  | Readonly<{
      _tag: "Provision";
      ms: number;
      image: string;
      branch: string;
      detail: string;
    }>
  | Readonly<{
      _tag: "Step";
      ms: number;
      kind: StepKind;
      label: string;
      detail: string;
    }>
  | Readonly<{ _tag: "Say"; ms: number; text: string }>
  | Readonly<{ _tag: "Ask"; question: Question }>
  | Readonly<{ _tag: "Propose"; summary: string; ops: ReadonlyArray<Op> }>
  | Readonly<{ _tag: "Finish"; report: string; links: ReadonlyArray<Link> }>;

/** What a script can know beyond the thread itself. */
export type ScriptContext = Readonly<{
  items: Items;
  /** How many threads up the delegation chain this one sits. Chains stop at two. */
  depth: number;
}>;

const hash = (value: string): number => {
  let result = 2166136261;
  for (const char of value)
    result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
};

const slugOf = (task: string): string =>
  task
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .split("-")
    .slice(0, 5)
    .join("-") || "task";

const sentence = (text: string): string =>
  text ? text[0]!.toUpperCase() + text.slice(1) : text;

/** The task without planning verbs, so a plan reads "for sharing" rather than "for break down sharing". */
const topicOf = (task: string): string =>
  task
    .replace(
      /^(break down|plan|split up|split|organize|coordinate|own|drive|scope)\s+/iu,
      "",
    )
    .replace(/^(the|a|an)\s+/iu, "") || task;

type Area = "permissions" | "data" | "interface" | "email" | "general";

const areaOf = (task: string): Area =>
  /\b(permissions?|acl|roles?|owners?|share|sharing|access)\b/iu.test(task)
    ? "permissions"
    : /\b(migrations?|schema|tables?|database|models?|api)\b/iu.test(task)
      ? "data"
      : /\b(ui|interface|dialog|page|screens?|layout|design|buttons?|settings|modal)\b/iu.test(
            task,
          )
        ? "interface"
        : /\b(emails?|invites?|notifications?|magic links?)\b/iu.test(task)
          ? "email"
          : "general";

const FILES: Readonly<Record<Area, ReadonlyArray<string>>> = {
  permissions: [
    "src/server/acl.ts",
    "src/server/routes/share.ts",
    "db/migrations/0042_acl.sql",
  ],
  data: [
    "db/migrations/0043_workspace_members.sql",
    "src/server/models/member.ts",
  ],
  interface: [
    "src/ui/ShareDialog.ts",
    "src/ui/MemberList.ts",
    "src/ui/styles/share.css",
  ],
  email: ["src/server/mail/invite.ts", "src/server/mail/templates/invite.mjml"],
  general: ["src/app/workspace.ts", "src/app/workspace.test.ts"],
};

const SEARCH: Readonly<Record<Area, string>> = {
  permissions: "canAccess|ownerId",
  data: "createTable|members",
  interface: "Dialog|Popover",
  email: "sendMail|invite",
  general: "workspace",
};

const QUESTIONS: Readonly<Record<Area, Omit<Question, "id">>> = {
  permissions: {
    prompt: "Should owners be able to transfer ownership of a shared outline?",
    options: [
      "Yes, owners can transfer",
      "No, the creator stays owner",
      "Only workspace admins",
    ],
  },
  data: {
    prompt:
      "Can I run the migration against staging, or keep it local for now?",
    options: ["Run it on staging", "Keep it local"],
  },
  interface: {
    prompt: "Which direction should I take for the layout?",
    options: ["Compact popover", "Full dialog with tabs", "Inline side panel"],
  },
  email: {
    prompt: "Should invite links expire?",
    options: ["After 7 days", "After 24 hours", "Never"],
  },
  general: {
    prompt: "Should this ship behind the team-workspaces flag?",
    options: ["Behind the flag", "Ship it directly"],
  },
};

const FINDINGS: Readonly<Record<Area, ReadonlyArray<string>>> = {
  permissions: [
    "Share links never expire; add a TTL and revoke on role change",
    "POST /api/share has no rate limit",
  ],
  data: [
    "Migration locks `members` for ~4s on large workspaces; backfill in batches",
  ],
  interface: ["Dialog traps focus but Esc leaves the invite field dirty"],
  email: ["Magic links are logged in plain text by the mail worker"],
  general: ["Two code paths build the workspace URL differently"],
};

/** One suggestion per bullet, so each can be accepted or rejected on its own. */
const inserts = (
  opId: (suffix: string) => string,
  parentId: string,
  items: Items,
): ReadonlyArray<Op> =>
  items.map((inserted) => ({
    _tag: "Insert",
    id: opId(`add-${inserted.id}`),
    state: "Pending",
    parentId,
    afterId: null,
    items: [inserted],
  }));

const sandboxIdOf = (threadId: string): string =>
  `sbx-${(hash(threadId) % 0xfffff).toString(16).padStart(5, "0")}`;

/** The beats for a thread. Beats before the thread's cursor have already played. */
export const scriptFor = (
  thread: Thread,
  context: ScriptContext,
): ReadonlyArray<Beat> => {
  const task = taskOf(thread.prompt) || "this task";
  const area = areaOf(task);
  const seed = hash(thread.id);
  const slug = slugOf(task);
  const pr = 1200 + (seed % 380);
  const sandboxId = sandboxIdOf(thread.id);
  const files = FILES[area];
  const { path, node } = contextOf(context.items, thread.nodeId);
  const root = path[0]?.text ?? node?.text ?? "the outline";
  const opId = (suffix: string) => `${thread.id}-${suffix}`;
  const itemId = (suffix: string) => `${thread.id}-${suffix}`;
  const canDelegate = context.depth < 2;
  const answer = thread.answers[0] ?? "";
  const question = (id: string, base: Omit<Question, "id">): Question => ({
    id: opId(id),
    ...base,
  });

  const readOutline: Beat = {
    _tag: "Step",
    ms: 800,
    kind: "read",
    label: "Read the outline",
    detail: `${thread.contextSize} bullets under “${root}”`,
  };

  switch (thread.agent) {
    case "conductor": {
      const topic = topicOf(task);
      const plan = [
        item(itemId("plan-api"), `@claude implement the backend for ${topic}`),
        item(itemId("plan-ui"), `@cursor build the interface for ${topic}`),
        item(itemId("plan-tests"), `@codex write tests for ${topic}`),
      ];
      return [
        {
          _tag: "Provision",
          ms: 900,
          image: "conductor · 3 parallel workspaces",
          branch: `conductor/${slug}`,
          detail: "Reserved three isolated workspaces",
        },
        readOutline,
        {
          _tag: "Step",
          ms: 1200,
          kind: "think",
          label: "Planned the work",
          detail: "Three workstreams that can run in parallel",
        },
        {
          _tag: "Say",
          ms: 500,
          text: `I split “${topic}” into backend, interface, and tests. Accept the ones you want; each starts in its own sandbox.`,
        },
        {
          _tag: "Propose",
          summary: `${plan.length} workstreams for ${topic}`,
          ops: inserts(opId, thread.nodeId, plan),
        },
        {
          _tag: "Say",
          ms: 400,
          text: "Accepted workstreams are running. Their questions will show up under each bullet.",
        },
        {
          _tag: "Finish",
          report: `Planned ${topic} as parallel workstreams and handed them off.`,
          links: [],
        },
      ];
    }

    case "claude":
    default: {
      const decided = answer
        ? [item(itemId("decision"), `Decision: ${answer} #decision`)]
        : [];
      const followUp = canDelegate
        ? [item(itemId("followup"), `@codex review PR #${pr} for edge cases`)]
        : [];
      return [
        {
          _tag: "Provision",
          ms: 1000,
          image: "ubuntu-24.04 · node 24 · 4 vCPU",
          branch: `claude/${slug}`,
          detail: `Booted ${sandboxId}`,
        },
        {
          _tag: "Step",
          ms: 900,
          kind: "git",
          label: "Cloned acme/workspace",
          detail: `git switch -c claude/${slug}`,
        },
        readOutline,
        {
          _tag: "Step",
          ms: 900,
          kind: "search",
          label: `rg "${SEARCH[area]}" src`,
          detail: `${3 + (seed % 9)} matches in ${2 + (seed % 4)} files`,
        },
        {
          _tag: "Say",
          ms: 500,
          text: `Plan: ${task}, touching ${files.join(", ")}. One question before I write code.`,
        },
        { _tag: "Ask", question: question("ask", QUESTIONS[area]) },
        {
          _tag: "Step",
          ms: 1600,
          kind: "edit",
          label: `Edited ${files.length + 2} files`,
          detail: `+${120 + (seed % 140)} −${10 + (seed % 40)} · ${files[0]}`,
        },
        {
          _tag: "Step",
          ms: 1500,
          kind: "bash",
          label: "pnpm test",
          detail: `${40 + (seed % 60)} passed · 0 failed`,
        },
        {
          _tag: "Step",
          ms: 700,
          kind: "git",
          label: `Opened PR #${pr}`,
          detail: `claude/${slug} → main`,
        },
        {
          _tag: "Propose",
          summary: "Record the result and mark the task done",
          ops: [
            ...inserts(opId, thread.nodeId, [
              item(itemId("pr"), `PR #${pr}: ${sentence(task)}`, [
                item(itemId("files"), `Changed ${files.join(", ")}`),
                item(itemId("tests"), "All checks green"),
              ]),
              ...decided,
              ...followUp,
            ]),
            {
              _tag: "Complete",
              id: opId("done"),
              state: "Pending",
              nodeId: thread.nodeId,
            },
          ],
        },
        {
          _tag: "Finish",
          report: `Opened PR #${pr} for “${task}”. Tests pass.`,
          links: [
            {
              label: `PR #${pr}`,
              href: `https://github.com/acme/workspace/pull/${pr}`,
            },
          ],
        },
      ];
    }

    case "cursor": {
      const [component] = FILES.interface;
      const preview = `https://cursor-${slug}.preview.acme.dev`;
      const direction = answer || "the existing patterns";
      const before = node?.text ?? thread.prompt;
      return [
        {
          _tag: "Provision",
          ms: 900,
          image: "cursor-agent · node 24",
          branch: `cursor/${slug}`,
          detail: "Started a background agent",
        },
        readOutline,
        {
          _tag: "Step",
          ms: 900,
          kind: "search",
          label: "Looked for similar components",
          detail: "Found Dialog, Popover, and MemberList",
        },
        {
          _tag: "Ask",
          question: question("ask", QUESTIONS.interface),
        },
        {
          _tag: "Step",
          ms: 1700,
          kind: "edit",
          label: `Built ${component!.split("/").at(-1)}`,
          detail: `+${180 + (seed % 120)} −${seed % 30} · ${direction}`,
        },
        {
          _tag: "Step",
          ms: 1200,
          kind: "bash",
          label: "pnpm build && pnpm test:visual",
          detail: "12 screenshots, 0 differences outside the new view",
        },
        {
          _tag: "Step",
          ms: 800,
          kind: "sandbox",
          label: "Deployed a preview",
          detail: preview,
        },
        {
          _tag: "Propose",
          summary: "Describe the result in the outline",
          ops: [
            {
              _tag: "Edit",
              id: opId("rename"),
              state: "Pending",
              nodeId: thread.nodeId,
              before,
              after: `${before.trimEnd()} (${direction.toLowerCase()})`,
            },
            ...inserts(opId, thread.nodeId, [
              item(itemId("preview"), `Preview: ${preview}`),
              item(
                itemId("open"),
                "Empty state copy still needs a decision #design",
              ),
            ]),
          ],
        },
        {
          _tag: "Finish",
          report: `Built ${task} as ${direction.toLowerCase()} and deployed a preview.`,
          links: [{ label: "Preview", href: preview }],
        },
      ];
    }

    case "shell":
    case "codex": {
      const findings = FINDINGS[area];
      const fix = canDelegate
        ? [
            item(
              itemId("fix"),
              `@claude fix: ${findings[0]!.split(";")[0]!.toLowerCase()}`,
            ),
          ]
        : [];
      return [
        {
          _tag: "Provision",
          ms: 900,
          image: "codex-universal",
          branch: `codex/${slug}`,
          detail: "Started a cloud task",
        },
        readOutline,
        {
          _tag: "Step",
          ms: 1500,
          kind: "bash",
          label: "pnpm test --coverage",
          detail: `${60 + (seed % 30)}% statement coverage`,
        },
        {
          _tag: "Step",
          ms: 1100,
          kind: "search",
          label: "Audited request handlers",
          detail: `${findings.length} findings`,
        },
        {
          _tag: "Say",
          ms: 500,
          text: `${findings.length === 1 ? "One finding" : `${findings.length} findings`} worth your attention. I added them as suggestions under the task.`,
        },
        {
          _tag: "Propose",
          summary: `${findings.length} finding${findings.length === 1 ? "" : "s"} and a fix`,
          ops: inserts(opId, thread.nodeId, [
            ...findings.map((finding, index) =>
              item(itemId(`finding-${index}`), `Finding: ${finding}`),
            ),
            item(itemId("covered"), "Covered: permission checks have 14 tests"),
            ...fix,
          ]),
        },
        {
          _tag: "Finish",
          report: `Reviewed “${task}”: ${findings.length} finding${findings.length === 1 ? "" : "s"}.`,
          links: [],
        },
      ];
    }
  }
};

// ---------------------------------------------------------------------------
// Playing beats. Each function returns the next thread; the Durable Object
// persists and broadcasts it.

let counter = 0;
const activityId = (thread: Thread) =>
  `${thread.id}-a${thread.activity.length}-${++counter}`;

const said = (
  thread: Thread,
  who: "Agent" | "Human",
  text: string,
  now: number,
): Activity => ({
  _tag: "Said",
  id: activityId(thread),
  at: now,
  who,
  text,
});

/** Starts a beat. Timed beats come back to `finishBeat` after `ms`. */
export const startBeat = (thread: Thread, beat: Beat, now: number): Thread => {
  const base = { ...thread, updatedAt: now };
  switch (beat._tag) {
    case "Provision":
      return {
        ...base,
        status: "Provisioning",
        headline: "Provisioning a sandbox",
        sandbox: {
          id: sandboxIdOf(thread.id),
          image: beat.image,
          branch: beat.branch,
        },
        activity: [
          ...thread.activity,
          {
            _tag: "Step",
            id: activityId(thread),
            at: now,
            kind: "sandbox",
            label: `Sandbox for ${agentInfo(thread.agent).harness}`,
            detail: beat.detail,
            state: "Running",
          },
        ],
      };
    case "Step":
      return {
        ...base,
        status: "Working",
        headline: beat.label,
        activity: [
          ...thread.activity,
          {
            _tag: "Step",
            id: activityId(thread),
            at: now,
            kind: beat.kind,
            label: beat.label,
            detail: beat.detail,
            state: "Running",
          },
        ],
      };
    case "Say":
      return { ...base, status: "Working", headline: "Writing an update" };
    case "Ask":
      return {
        ...base,
        status: "NeedsInput",
        headline: beat.question.prompt,
        question: beat.question,
        activity: [
          ...thread.activity,
          said(thread, "Agent", beat.question.prompt, now),
        ],
      };
    case "Propose":
      return {
        ...base,
        status: "Review",
        headline: beat.summary,
        proposal: {
          id: `${thread.id}-proposal`,
          summary: beat.summary,
          ops: beat.ops,
        },
      };
    case "Finish":
      return {
        ...base,
        status: "Done",
        headline: beat.report,
        report: beat.report,
        links: beat.links,
        cursor: thread.cursor + 1,
      };
  }
};

/** Completes a timed beat and moves the cursor past it. */
export const finishBeat = (thread: Thread, beat: Beat, now: number): Thread => {
  const done = { ...thread, updatedAt: now, cursor: thread.cursor + 1 };
  switch (beat._tag) {
    case "Provision":
      return {
        ...done,
        status: "Working",
        activity: thread.activity.map((entry) =>
          entry._tag === "Step" && entry.state === "Running"
            ? { ...entry, state: "Done" }
            : entry,
        ),
      };
    case "Step":
      return {
        ...done,
        activity: thread.activity.map((entry) =>
          entry._tag === "Step" && entry.state === "Running"
            ? { ...entry, state: "Done" }
            : entry,
        ),
      };
    case "Say":
      return {
        ...done,
        activity: [...thread.activity, said(thread, "Agent", beat.text, now)],
      };
    case "Ask":
    case "Propose":
    case "Finish":
      return done;
  }
};

export const isTimed = (beat: Beat): beat is Extract<Beat, { ms: number }> =>
  "ms" in beat;

export const answer = (thread: Thread, text: string, now: number): Thread => ({
  ...thread,
  status: "Working",
  headline: "Continuing with your answer",
  question: null,
  answers: [...thread.answers, text],
  activity: [...thread.activity, said(thread, "Human", text, now)],
  cursor: thread.cursor + 1,
  updatedAt: now,
});

export const resolve = (
  thread: Thread,
  opIds: ReadonlyArray<string>,
  state: "Pending" | "Accepted" | "Rejected",
  now: number,
): Thread => {
  if (thread.proposal === null) return thread;
  const ops = thread.proposal.ops.map((op) =>
    opIds.includes(op.id) ? { ...op, state } : op,
  );
  const settled = ops.every((op) => op.state !== "Pending");
  const accepted = ops.filter((op) => op.state === "Accepted").length;
  const proposal = { ...thread.proposal, ops };
  if (!settled || thread.status !== "Review")
    return { ...thread, proposal, updatedAt: now };
  return {
    ...thread,
    proposal,
    status: "Working",
    headline: accepted ? "Wrapping up" : "Wrapping up without changes",
    activity: [
      ...thread.activity,
      said(
        thread,
        "Agent",
        accepted === ops.length
          ? "Thanks. All suggestions are in the outline."
          : accepted
            ? `Kept ${accepted} of ${ops.length} suggestions.`
            : "Understood. I left the outline as it was.",
        now,
      ),
    ],
    cursor: thread.cursor + 1,
    updatedAt: now,
  };
};

export const steer = (thread: Thread, text: string, now: number): Thread => ({
  ...thread,
  updatedAt: now,
  activity: [
    ...thread.activity,
    said(thread, "Human", text, now),
    said(
      thread,
      "Agent",
      "Got it. I’ll take that into account for the rest of this run.",
      now,
    ),
  ],
});

export const cancel = (thread: Thread, now: number): Thread => ({
  ...thread,
  status: "Cancelled",
  headline: "Stopped",
  question: null,
  updatedAt: now,
  activity: thread.activity.map((entry) =>
    entry._tag === "Step" && entry.state === "Running"
      ? { ...entry, state: "Failed" }
      : entry,
  ),
});

export const newThread = (
  init: Readonly<{
    id: string;
    nodeId: string;
    agent: Thread["agent"];
    prompt: string;
    contextSize: number;
    parentThreadId: string | null;
    now: number;
  }>,
): Thread => ({
  id: init.id,
  nodeId: init.nodeId,
  agent: init.agent,
  prompt: init.prompt,
  contextSize: init.contextSize,
  parentThreadId: init.parentThreadId,
  status: "Queued",
  headline: `Queued for ${agentInfo(init.agent).harness}`,
  createdAt: init.now,
  updatedAt: init.now,
  sandbox: null,
  activity: [],
  question: null,
  answers: [],
  proposal: null,
  report: "",
  links: [],
  cursor: 0,
});

/**
 * Plays a script without waiting, for seeding. Stops at a question or a
 * proposal unless told how to answer or review; accepted suggestions are
 * applied to the returned outline.
 */
export const fastForward = (
  start: Thread,
  items: Items,
  options: Readonly<{
    depth: number;
    answer?: string;
    accept?: boolean;
    now: number;
  }>,
): Readonly<{ thread: Thread; items: Items }> => {
  let thread = start;
  let outline = items;
  let now = options.now;
  for (let guard = 0; guard < 64; guard += 1) {
    const beat = scriptFor(thread, { items: outline, depth: options.depth })[
      thread.cursor
    ];
    if (beat === undefined) break;
    now += isTimed(beat) ? beat.ms : 200;
    thread = startBeat(thread, beat, now);
    if (isTimed(beat)) {
      thread = finishBeat(thread, beat, now);
      continue;
    }
    if (beat._tag === "Ask") {
      if (options.answer === undefined) break;
      thread = answer(thread, options.answer, now);
      continue;
    }
    if (beat._tag === "Propose") {
      if (options.accept === undefined) break;
      for (const op of beat.ops)
        if (options.accept) outline = applyOp(outline, op);
      thread = resolve(
        thread,
        beat.ops.map((op) => op.id),
        options.accept ? "Accepted" : "Rejected",
        now,
      );
      continue;
    }
    break;
  }
  return { thread, items: outline };
};
