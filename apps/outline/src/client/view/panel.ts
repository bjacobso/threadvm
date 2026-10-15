import { ArrowLeft, Check, ExternalLink, LocateFixed, SendHorizontal, Square, X } from "@lucide/icons";
import { Button, Icon, TreeDiff, type TreeDiffNode } from "@foldworks/ui";
import type { Html } from "foldkit/html";
import { Option } from "effect";

import { AGENTS } from "../../shared/agents.ts";
import {
  isActive,
  pendingOps,
  type Items,
  type Op,
  type Thread,
} from "../../shared/protocol.ts";
import { applyOp, contextOf, find, pathTo, toText } from "../../shared/tree.ts";
import { attentionQueue, type Kind } from "../attention.ts";
import { Message } from "../message.ts";
import type { Model } from "../model.ts";
import { byCreation, realItems } from "../projection.ts";
import { avatar, clock, doneIcon, statusLabel, statusTone, stepIcon, type H } from "./parts.ts";

const breadcrumb = (items: Items, nodeId: string): string =>
  (pathTo(items, nodeId) ?? [])
    .map((id) => find(items, id)?.text ?? "")
    .filter((text) => text !== "")
    .join(" › ");

const titleOf = (items: Items, thread: Thread): string => find(items, thread.nodeId)?.text ?? thread.prompt;

// ---------------------------------------------------------------------------
// Inbox

const SECTIONS: ReadonlyArray<Readonly<{ kind: Kind; title: string; empty: string }>> = [
  { kind: "NeedsInput", title: "Waiting on you", empty: "No questions right now." },
  { kind: "Review", title: "Suggestions to review", empty: "Nothing to review." },
  { kind: "Working", title: "Working", empty: "No agents are running." },
];

const inboxCard = (items: Items, thread: Thread, kind: Kind, h: H): Html =>
  h.article(
    [h.Class("inbox-card"), h.DataAttribute("kind", kind)],
    [
      h.button(
        [
          h.Class("inbox-card__open"),
          h.Type("button"),
          h.OnClick(Message.SelectedThread({ threadId: thread.id })),
        ],
        [
          avatar(thread.agent, h),
          h.span(
            [h.Class("inbox-card__text")],
            [
              h.span([h.Class("inbox-card__path")], [breadcrumb(items, thread.nodeId) || "Top level"]),
              h.span([h.Class("inbox-card__title")], [titleOf(items, thread)]),
              h.span(
                [h.Class("inbox-card__detail")],
                [kind === "NeedsInput" ? (thread.question?.prompt ?? "") : statusLabel(thread)],
              ),
            ],
          ),
        ],
      ),
      ...(kind === "NeedsInput" && thread.question !== null
        ? [
            h.div(
              [h.Class("inbox-card__options")],
              thread.question.options.map((option) =>
                h.button(
                  [
                    h.Class("option-chip"),
                    h.Type("button"),
                    h.OnClick(Message.AnsweredQuestion({ threadId: thread.id, text: option })),
                  ],
                  [option],
                ),
              ),
            ),
          ]
        : kind === "Review"
          ? [
              h.div(
                [h.Class("inbox-card__options")],
                [
                  h.button(
                    [
                      h.Class("option-chip option-chip--accept"),
                      h.Type("button"),
                      h.OnClick(
                        Message.ResolvedOps({
                          threadId: thread.id,
                          opIds: pendingOps(thread).map((op) => op.id),
                          state: "Accepted",
                        }),
                      ),
                    ],
                    ["Accept all"],
                  ),
                  h.button(
                    [
                      h.Class("option-chip"),
                      h.Type("button"),
                      h.OnClick(Message.SelectedThread({ threadId: thread.id })),
                    ],
                    ["Review…"],
                  ),
                ],
              ),
            ]
          : []),
    ],
  );

const inbox = (model: Model, h: H): Html => {
  const items = realItems(model.outline.items);
  const queue = attentionQueue(items, model.threads);
  const finished = byCreation(model.threads)
    .filter((thread) => thread.status === "Done" && find(items, thread.nodeId) !== undefined)
    .slice(-4)
    .reverse();
  return h.div(
    [h.Class("panel__body")],
    [
      h.header(
        [h.Class("panel__header")],
        [
          h.h2([h.Class("panel__title")], ["Inbox"]),
          h.p(
            [h.Class("panel__subtitle")],
            [
              queue.length === 0
                ? "Agents report back here and under the bullets that asked for them."
                : "Everything agents need from you, wherever it is in the outline.",
            ],
          ),
        ],
      ),
      ...SECTIONS.map(({ kind, title, empty }) => {
        const entries = queue.filter((entry) => entry.kind === kind);
        return h.section(
          [h.Class("inbox-section"), h.DataAttribute("kind", kind)],
          [
            h.h3([], [title, h.span([h.Class("inbox-section__count")], [String(entries.length)])]),
            ...(entries.length === 0
              ? [h.p([h.Class("inbox-section__empty")], [empty])]
              : entries.map(({ thread }) => inboxCard(items, thread, kind, h))),
          ],
        );
      }),
      ...(finished.length === 0
        ? []
        : [
            h.section(
              [h.Class("inbox-section"), h.DataAttribute("kind", "Done")],
              [
                h.h3([], ["Recently finished"]),
                ...finished.map((thread) =>
                  h.button(
                    [
                      h.Class("inbox-finished"),
                      h.Type("button"),
                      h.OnClick(Message.SelectedThread({ threadId: thread.id })),
                    ],
                    [avatar(thread.agent, h), h.span([], [thread.report || titleOf(items, thread)])],
                  ),
                ),
              ],
            ),
          ]),
    ],
  );
};

// ---------------------------------------------------------------------------
// Thread

const toDiffNodes = (items: Items): ReadonlyArray<TreeDiffNode> =>
  items.map((node) => ({
    id: node.id,
    label: `${node.checked ? "✓ " : ""}${node.text}`,
    children: toDiffNodes(node.children),
  }));

const opLabel = (items: Items, thread: Thread, op: Op): string => {
  switch (op._tag) {
    case "Insert": {
      const what = op.items.length === 1 ? `“${op.items[0]!.text}”` : `${op.items.length} bullets`;
      return op.parentId === thread.nodeId
        ? `Add ${what}`
        : `Add ${what} under “${find(items, op.parentId)?.text ?? "a bullet"}”`;
    }
    case "Edit":
      return `Reword to “${op.after}”`;
    case "Complete":
      return op.nodeId === thread.nodeId
        ? "Mark this task done"
        : `Mark “${find(items, op.nodeId)?.text ?? "a bullet"}” done`;
  }
};

const reviewCard = (items: Items, thread: Thread, h: H): Html | null => {
  const pending = pendingOps(thread);
  if (thread.proposal === null || pending.length === 0) return null;
  const node = find(items, thread.nodeId);
  const before = node === undefined ? [] : [node];
  const after = pending.reduce(applyOp, items);
  const afterNode = find(after, thread.nodeId);
  const ids = pending.map((op) => op.id);
  return h.section(
    [h.Class("card card--review")],
    [
      h.header(
        [h.Class("card__header")],
        [h.h3([], ["Suggested changes"]), h.span([h.Class("card__meta")], [thread.proposal.summary])],
      ),
      h.div(
        [h.Class("card__diff")],
        [
          TreeDiff.view(
            {
              label: `${AGENTS[thread.agent].name}'s suggested changes`,
              before: toDiffNodes(before),
              after: toDiffNodes(afterNode === undefined ? [] : [afterNode]),
              context: 1,
            },
            h,
          ),
        ],
      ),
      h.ul(
        [h.Class("op-list")],
        pending.map((op) =>
          h.li(
            [h.Class("op")],
            [
              h.span([h.Class("op__label")], [opLabel(items, thread, op)]),
              Button.view(
                {
                  icon: Check,
                  ariaLabel: "Accept",
                  variant: "ghost",
                  size: "xs",
                  onClick: Message.ResolvedOps({ threadId: thread.id, opIds: [op.id], state: "Accepted" }),
                },
                h,
              ),
              Button.view(
                {
                  icon: X,
                  ariaLabel: "Reject",
                  variant: "ghost",
                  size: "xs",
                  onClick: Message.ResolvedOps({ threadId: thread.id, opIds: [op.id], state: "Rejected" }),
                },
                h,
              ),
            ],
          ),
        ),
      ),
      h.footer(
        [h.Class("card__actions")],
        [
          Button.view(
            {
              label: pending.length === 1 ? "Accept" : `Accept all ${pending.length}`,
              icon: Check,
              variant: "primary",
              size: "sm",
              onClick: Message.ResolvedOps({ threadId: thread.id, opIds: ids, state: "Accepted" }),
            },
            h,
          ),
          Button.view(
            {
              label: "Reject",
              variant: "ghost",
              size: "sm",
              onClick: Message.ResolvedOps({ threadId: thread.id, opIds: ids, state: "Rejected" }),
            },
            h,
          ),
        ],
      ),
    ],
  );
};

const questionCard = (thread: Thread, h: H): Html | null =>
  thread.question === null
    ? null
    : h.section(
        [h.Class("card card--question")],
        [
          h.header([h.Class("card__header")], [h.h3([], [`${AGENTS[thread.agent].name} is asking`])]),
          h.p([h.Class("card__question")], [thread.question.prompt]),
          h.div(
            [h.Class("card__options")],
            thread.question.options.map((option) =>
              h.button(
                [
                  h.Class("option-chip option-chip--large"),
                  h.Type("button"),
                  h.OnClick(Message.AnsweredQuestion({ threadId: thread.id, text: option })),
                ],
                [option],
              ),
            ),
          ),
          h.p([h.Class("card__hint")], ["Or write your own answer below."]),
        ],
      );

const reportCard = (thread: Thread, h: H): Html | null =>
  thread.status !== "Done" || thread.report === ""
    ? null
    : h.section(
        [h.Class("card card--report")],
        [
          h.header([h.Class("card__header")], [h.h3([], ["Report"])]),
          h.p([], [thread.report]),
          ...(thread.links.length === 0
            ? []
            : [
                h.div(
                  [h.Class("card__links")],
                  thread.links.map((link) =>
                    h.a(
                      [h.Href(link.href), h.Target("_blank"), h.Rel("noreferrer"), h.Class("link-chip")],
                      [link.label, Icon.view({ icon: ExternalLink, size: 12 }, h)],
                    ),
                  ),
                ),
              ]),
        ],
      );

/** The part of the outline the agent was given: the path to its bullet and the branch below. */
const contextView = (items: Items, thread: Thread, h: H): Html => {
  const { path, node } = contextOf(items, thread.nodeId);
  const nested = path.reduceRight<Items>(
    (children, ancestor) => [{ ...ancestor, children }],
    node === undefined ? [] : [node],
  );
  return h.details(
    [h.Class("context")],
    [
      h.summary([], [`What ${AGENTS[thread.agent].name} can see · ${thread.contextSize} bullets`]),
      h.pre([], [toText(nested)]),
    ],
  );
};

const activityList = (thread: Thread, h: H): Html =>
  h.ol(
    [h.Class("activity")],
    thread.activity.length === 0
      ? [h.li([h.Class("activity__empty")], ["Waiting for a sandbox…"])]
      : thread.activity.map((entry) =>
          entry._tag === "Step"
            ? h.li(
                [h.Class("step"), h.DataAttribute("state", entry.state)],
                [
                  stepIcon(entry.kind, entry.state, h),
                  h.div(
                    [h.Class("step__text")],
                    [
                      h.span([h.Class("step__label")], [entry.label]),
                      h.span([h.Class("step__detail")], [entry.detail]),
                    ],
                  ),
                  h.time([h.Class("step__time")], [clock(entry.at)]),
                ],
              )
            : h.li(
                [h.Class("said"), h.DataAttribute("who", entry.who)],
                [
                  entry.who === "Agent" ? avatar(thread.agent, h) : h.span([h.Class("you")], ["You"]),
                  h.p([], [entry.text]),
                ],
              ),
        ),
  );

const composer = (model: Model, thread: Thread, h: H): Html => {
  const value = model.drafts[thread.id] ?? "";
  const name = AGENTS[thread.agent].name;
  const placeholder =
    thread.status === "NeedsInput"
      ? `Answer ${name}…`
      : isActive(thread.status)
        ? `Steer ${name} while it works…`
        : `Ask ${name} for a follow-up…`;
  return h.form(
    [h.Class("composer"), h.OnSubmit(Message.SubmittedDraft({ threadId: thread.id }))],
    [
      h.textarea(
        [
          h.Id(`composer-${thread.id}`),
          h.Class("composer__input"),
          h.Rows(2),
          h.Value(value),
          h.Placeholder(placeholder),
          h.AriaLabel(placeholder),
          h.OnInput((next) => Message.ChangedDraft({ threadId: thread.id, value: next })),
          h.OnKeyDownPreventDefault((key, modifiers) =>
            key === "Enter" && !modifiers.shiftKey
              ? Option.some(Message.SubmittedDraft({ threadId: thread.id }))
              : Option.none(),
          ),
        ],
        [],
      ),
      Button.view(
        {
          icon: SendHorizontal,
          ariaLabel: "Send",
          variant: "primary",
          size: "icon",
          isDisabled: value.trim() === "",
          attributes: [h.Type("submit")],
        },
        h,
      ),
    ],
  );
};

const threadView = (model: Model, thread: Thread, h: H): Html => {
  const items = realItems(model.outline.items);
  const agent = AGENTS[thread.agent];
  const runs = byCreation(model.threads).filter((other) => other.nodeId === thread.nodeId);
  return h.div(
    [h.Class("panel__body"), h.DataAttribute("thread", thread.id)],
    [
      h.nav(
        [h.Class("panel__nav")],
        [
          Button.view(
            { label: "Inbox", icon: ArrowLeft, variant: "ghost", size: "xs", onClick: Message.ClosedThread() },
            h,
          ),
          h.span([h.Class("panel__spacer")], []),
          Button.view(
            {
              icon: LocateFixed,
              ariaLabel: "Show in outline",
              variant: "ghost",
              size: "xs",
              attributes: [h.Title("Show in outline")],
              onClick: Message.RevealedNode({ nodeId: thread.nodeId }),
            },
            h,
          ),
          ...(isActive(thread.status)
            ? [
                Button.view(
                  {
                    label: "Stop",
                    icon: Square,
                    variant: "ghost",
                    size: "xs",
                    onClick: Message.StoppedThread({ threadId: thread.id }),
                  },
                  h,
                ),
              ]
            : []),
        ],
      ),
      h.header(
        [h.Class("thread-header")],
        [
          avatar(thread.agent, h, "md"),
          h.div(
            [],
            [
              h.div(
                [h.Class("thread-header__who")],
                [
                  h.strong([], [agent.name]),
                  h.span([h.Class("thread-header__harness")], [agent.harness]),
                ],
              ),
              h.span(
                [h.Class("status-pill"), h.DataAttribute("status", statusTone(thread))],
                [statusLabel(thread)],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("thread-task")],
        [
          h.span([h.Class("thread-task__path")], [breadcrumb(items, thread.nodeId) || "Top level"]),
          h.p([h.Class("thread-task__title")], [thread.prompt]),
        ],
      ),
      ...(thread.sandbox === null
        ? []
        : [
            h.dl(
              [h.Class("sandbox")],
              [
                h.dt([], ["Sandbox"]),
                h.dd([], [thread.sandbox.id]),
                h.dt([], ["Image"]),
                h.dd([], [thread.sandbox.image]),
                h.dt([], ["Branch"]),
                h.dd([], [thread.sandbox.branch]),
                h.dt([], ["Context"]),
                h.dd([], [`${thread.contextSize} bullets, read-only`]),
              ],
            ),
          ]),
      contextView(items, thread, h),
      ...[questionCard(thread, h), reviewCard(items, thread, h), reportCard(thread, h)].filter(
        (card): card is Html => card !== null,
      ),
      h.section(
        [h.Class("thread-activity")],
        [h.h3([h.Class("section-title")], ["Activity"]), activityList(thread, h)],
      ),
      ...(runs.length > 1
        ? [
            h.section(
              [h.Class("thread-runs")],
              [
                h.h3([h.Class("section-title")], ["Runs on this bullet"]),
                ...runs.map((run) =>
                  h.button(
                    [
                      h.Class("run-link"),
                      h.Type("button"),
                      h.AriaCurrent(run.id === thread.id ? "true" : "false"),
                      h.OnClick(Message.SelectedThread({ threadId: run.id })),
                    ],
                    [
                      run.status === "Done" ? doneIcon(h) : avatar(run.agent, h),
                      h.span([], [run.prompt]),
                    ],
                  ),
                ),
              ],
            ),
          ]
        : []),
      composer(model, thread, h),
    ],
  );
};

export const panel = (model: Model, h: H): Html => {
  const thread = model.selectedThreadId === null ? undefined : model.threads[model.selectedThreadId];
  return h.aside(
    [h.Class("panel"), h.AriaLabel(thread === undefined ? "Inbox" : "Agent thread")],
    [thread === undefined ? inbox(model, h) : threadView(model, thread, h)],
  );
};
