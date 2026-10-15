import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Redo2,
  SendHorizontal,
  Undo2,
  X,
} from "@lucide/icons";
import { History } from "@foldworks/history";
import {
  Outliner,
  type HoverRequest,
  type Row,
  type RowDecoration,
  type TextSpan,
} from "@foldworks/outliner";
import { Mentions } from "@foldworks/text-intelligence";
import { Button, Icon } from "@foldworks/ui";
import type { Html } from "foldkit/html";

import { AGENTS, AGENT_IDS, mentionedAgent } from "../../shared/agents.ts";
import {
  isActive,
  type Items,
  type Op,
  type Thread,
} from "../../shared/protocol.ts";
import { rollups, type Tally } from "../attention.ts";
import { dataFor, describeAt, diagnosticsOf, spansOf } from "../mentions.ts";
import { Message } from "../message.ts";
import { COUNTDOWN_MS, type Model } from "../model.ts";
import {
  ghostsOf,
  inlineSuggestions,
  latestByNode,
  realItems,
  type Ghost,
} from "../projection.ts";
import { policy } from "../update.ts";
import { avatar, statusLabel, statusTone, type H } from "./parts.ts";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/u.test(navigator.platform);

const outlinerMessage = (message: Outliner.Message) =>
  Message.GotOutlinerMessage({ message });

/** Everything the rows need, computed once per render. */
type Scene = Readonly<{
  model: Model;
  real: Items;
  ghosts: ReadonlyMap<string, Ghost>;
  inline: ReturnType<typeof inlineSuggestions>;
  latest: ReadonlyMap<string, Thread>;
  tallies: ReadonlyMap<string, Tally>;
}>;

const sceneOf = (model: Model): Scene => {
  const real = realItems(model.outline.items);
  return {
    model,
    real,
    ghosts: ghostsOf(model.threads),
    inline: inlineSuggestions(model.threads),
    latest: latestByNode(model.threads),
    tallies: rollups(real, model.threads),
  };
};

// ---------------------------------------------------------------------------
// Decorations

const plain = (text: string): ReadonlyArray<TextSpan> => [{ text }];

const decorationFor = (
  scene: Scene,
  id: string,
  text: string,
  data: Mentions.Data,
): RowDecoration | undefined => {
  const ghost = scene.ghosts.get(id);
  if (ghost?._tag === "Question")
    return {
      tone: "question",
      marker: "?",
      spans: [{ text, kind: "question" }],
    };
  if (ghost?._tag === "Inserted")
    return {
      tone: "suggested",
      marker: "+",
      spans: spansOf(text, data) ?? plain(text),
    };

  const spans = spansOf(text, data);
  const diagnostics = diagnosticsOf(text, data);
  const suggestions = scene.inline.get(id) ?? [];
  const edit = suggestions.find((entry) => entry.op._tag === "Edit")?.op as
    | Extract<Op, { _tag: "Edit" }>
    | undefined;
  const structural = suggestions.find(
    (entry) => entry.op._tag === "Structural",
  )?.op;
  if (structural?._tag === "Structural")
    return {
      tone: "edited",
      spans: spans ?? plain(text),
      suffix: [{ text: `  ${structural.label}`, kind: "added" }],
    };
  const completes = suggestions.some((entry) => entry.op._tag === "Complete");
  if (edit !== undefined)
    return {
      tone: "edited",
      spans: [{ text, kind: "removed" }],
      suffix: [{ text: "  " }, { text: edit.after, kind: "added" }],
    };
  if (completes)
    return {
      tone: "edited",
      spans: spans ?? plain(text),
      suffix: [{ text: "  " }, { text: "✓ mark done", kind: "added" }],
      diagnostics,
    };
  const thread = scene.latest.get(id);
  const tone =
    thread === undefined ? undefined : `thread-${statusTone(thread)}`;
  if (spans === undefined && diagnostics.length === 0 && tone === undefined)
    return undefined;
  return {
    ...(spans === undefined ? {} : { spans }),
    ...(tone === undefined ? {} : { tone }),
    diagnostics,
  };
};

const decorationsOf = (
  scene: Scene,
): Readonly<Record<string, RowDecoration>> => {
  const data = dataFor(scene.real);
  const result: Record<string, RowDecoration> = {};
  const visit = (items: Items) => {
    for (const node of items) {
      const decoration = decorationFor(scene, node.id, node.text, data);
      if (decoration !== undefined) result[node.id] = decoration;
      visit(node.children);
    }
  };
  visit(scene.model.outline.items);
  return result;
};

// ---------------------------------------------------------------------------
// Row accessories

const reviewButtons = (
  thread: Thread,
  opIds: ReadonlyArray<string>,
  label: string,
  h: H,
): Html =>
  h.span(
    [h.Class("row-review")],
    [
      Button.view(
        {
          icon: Check,
          ariaLabel: `Accept: ${label}`,
          variant: "ghost",
          size: "xs",
          attributes: [h.DataAttribute("review", "accept"), h.Title("Accept")],
          onClick: Message.ResolvedOps({
            threadId: thread.id,
            opIds,
            state: "Accepted",
          }),
        },
        h,
      ),
      Button.view(
        {
          icon: X,
          ariaLabel: `Reject: ${label}`,
          variant: "ghost",
          size: "xs",
          attributes: [h.DataAttribute("review", "reject"), h.Title("Reject")],
          onClick: Message.ResolvedOps({
            threadId: thread.id,
            opIds,
            state: "Rejected",
          }),
        },
        h,
      ),
    ],
  );

const threadChip = (thread: Thread, h: H): Html =>
  h.button(
    [
      h.Class("thread-chip"),
      h.Type("button"),
      h.DataAttribute("status", statusTone(thread)),
      h.Title(`${AGENTS[thread.agent].name}: ${thread.headline}`),
      h.AriaLabel(
        `Open ${AGENTS[thread.agent].name}'s thread: ${statusLabel(thread)}`,
      ),
      h.OnClick(Message.SelectedThread({ threadId: thread.id })),
    ],
    [
      avatar(thread.agent, h),
      h.span([h.Class("thread-chip__pulse"), h.AriaHidden(true)], []),
      h.span([h.Class("thread-chip__label")], [statusLabel(thread)]),
    ],
  );

const countdownChip = (
  nodeId: string,
  remaining: number,
  agent: Thread["agent"],
  h: H,
): Html =>
  h.span(
    [h.Class("countdown")],
    [
      h.button(
        [
          h.Class("thread-chip"),
          h.Type("button"),
          h.DataAttribute("status", "sending"),
          h.Title("Send now"),
          h.OnClick(Message.ClickedSendNow({ nodeId })),
          h.Style({
            "--countdown": String(Math.max(0, remaining / COUNTDOWN_MS)),
          }),
        ],
        [
          avatar(agent, h),
          h.span([h.Class("countdown__ring"), h.AriaHidden(true)], []),
          h.span(
            [h.Class("thread-chip__label")],
            [
              `Sending to ${AGENTS[agent].name} in ${Math.ceil(remaining / 1000)}s`,
            ],
          ),
        ],
      ),
      h.button(
        [
          h.Class("countdown__hold"),
          h.Type("button"),
          h.OnClick(Message.ClickedHoldCountdown({ nodeId })),
        ],
        ["Keep as note"],
      ),
    ],
  );

const draftChip = (nodeId: string, agent: Thread["agent"], h: H): Html =>
  h.button(
    [
      h.Class("thread-chip thread-chip--draft"),
      h.Type("button"),
      h.DataAttribute("status", "draft"),
      h.Title(`Sends when you leave this bullet`),
      h.OnClick(Message.ClickedSendNow({ nodeId })),
    ],
    [
      avatar(agent, h),
      h.span(
        [h.Class("thread-chip__label")],
        [`Send to ${AGENTS[agent].name}`],
      ),
      Icon.view({ icon: SendHorizontal, size: 12 }, h),
    ],
  );

const tallyPills = (tally: Tally, h: H): ReadonlyArray<Html> => {
  const pill = (kind: string, count: number, label: string) =>
    count === 0
      ? []
      : [
          h.span(
            [h.Class("tally"), h.DataAttribute("kind", kind), h.Title(label)],
            [
              h.span([h.Class("tally__dot"), h.AriaHidden(true)], []),
              String(count),
            ],
          ),
        ];
  return [
    ...pill(
      "needs",
      tally.NeedsInput,
      `${tally.NeedsInput} waiting on you below`,
    ),
    ...pill("review", tally.Review, `${tally.Review} with suggestions below`),
    ...pill("working", tally.Working, `${tally.Working} working below`),
  ];
};

const questionAccessory = (thread: Thread, h: H): Html =>
  h.span(
    [h.Class("row-question")],
    [
      ...(thread.question?.options ?? []).map((option) =>
        h.button(
          [
            h.Class("option-chip"),
            h.Type("button"),
            h.Title(option),
            h.OnClick(
              Message.AnsweredQuestion({ threadId: thread.id, text: option }),
            ),
          ],
          [option],
        ),
      ),
      h.button(
        [
          h.Class("option-chip option-chip--reply"),
          h.Type("button"),
          h.OnClick(Message.SelectedThread({ threadId: thread.id })),
        ],
        ["Reply…"],
      ),
    ],
  );

const accessory = (scene: Scene, row: Row, h: H): Html | null => {
  const ghost = scene.ghosts.get(row.id);
  if (ghost?._tag === "Question") return questionAccessory(ghost.thread, h);
  if (ghost?._tag === "Inserted")
    return ghost.root && ghost.op.state === "Pending"
      ? h.span(
          [h.Class("row-suggestion")],
          [
            avatar(ghost.thread.agent, h),
            reviewButtons(ghost.thread, [ghost.op.id], row.text, h),
          ],
        )
      : null;

  const parts: Html[] = [];
  const inline = scene.inline.get(row.id) ?? [];
  for (const { thread, op } of inline)
    parts.push(reviewButtons(thread, [op.id], row.text, h));

  // Only folded branches carry their descendants' flags; open ones show the rows themselves.
  const tally =
    row.collapsed && row.hasChildren ? scene.tallies.get(row.id) : undefined;
  if (tally !== undefined) parts.push(...tallyPills(tally, h));

  const countdown = scene.model.countdowns[row.id];
  const thread = scene.latest.get(row.id);
  const agent = mentionedAgent(row.text);
  if (countdown !== undefined)
    parts.push(countdownChip(row.id, countdown.remaining, countdown.agent, h));
  else if (
    agent !== undefined &&
    scene.model.edited[row.id] === true &&
    (thread === undefined || !isActive(thread.status))
  )
    parts.push(draftChip(row.id, agent, h));
  else if (thread !== undefined) parts.push(threadChip(thread, h));

  return parts.length === 0 ? null : h.span([h.Class("row-accessory")], parts);
};

// ---------------------------------------------------------------------------

const hoverFor =
  (scene: Scene, h: H) =>
  ({ text, offset, source }: HoverRequest) => {
    const description = describeAt(
      scene.real,
      text,
      offset,
      source === "Keyboard",
    );
    if (description === undefined) return null;
    const agent = AGENT_IDS.find((id) => id === description.entity.id);
    return {
      from: description.from,
      to: description.to,
      content:
        agent === undefined
          ? Mentions.descriptionView(description, h)
          : h.div(
              [h.Class("agent-card")],
              [
                avatar(agent, h, "md"),
                h.div(
                  [],
                  [
                    h.strong([], [AGENTS[agent].name]),
                    h.span([], [AGENTS[agent].harness]),
                    h.p([], [AGENTS[agent].description]),
                  ],
                ),
              ],
            ),
    };
  };

const toolbar = (model: Model, h: H): Html =>
  h.div(
    [
      h.Class("outline-toolbar"),
      h.Role("toolbar"),
      h.AriaLabel("Outline tools"),
    ],
    [
      Button.view(
        {
          icon: Undo2,
          ariaLabel: "Undo",
          variant: "ghost",
          size: "icon",
          isDisabled: !History.canUndo(model.outline.history),
          onClick: outlinerMessage(Outliner.Message.ClickedUndo()),
        },
        h,
      ),
      Button.view(
        {
          icon: Redo2,
          ariaLabel: "Redo",
          variant: "ghost",
          size: "icon",
          isDisabled: !History.canRedo(model.outline.history),
          onClick: outlinerMessage(Outliner.Message.ClickedRedo()),
        },
        h,
      ),
      Button.view(
        {
          icon: ChevronsDownUp,
          ariaLabel: "Collapse everything",
          variant: "ghost",
          size: "icon",
          onClick: outlinerMessage(
            Outliner.Message.SetAllCollapsed({ collapsed: true }),
          ),
        },
        h,
      ),
      Button.view(
        {
          icon: ChevronsUpDown,
          ariaLabel: "Expand everything",
          variant: "ghost",
          size: "icon",
          onClick: outlinerMessage(
            Outliner.Message.SetAllCollapsed({ collapsed: false }),
          ),
        },
        h,
      ),
      h.span([h.Class("outline-toolbar__spacer")], []),
      h.span([h.Class("outline-toolbar__hint")], ["Mention"]),
      ...AGENT_IDS.map((agent) =>
        h.span(
          [
            h.Class("agent-tag"),
            h.DataAttribute("agent", agent),
            h.Title(AGENTS[agent].description),
          ],
          [`@${agent}`],
        ),
      ),
    ],
  );

export const outlinePane = (model: Model, h: H): Html => {
  const scene = sceneOf(model);
  return h.section(
    [h.Class("outline-pane"), h.AriaLabel("Outline")],
    [
      toolbar(model, h),
      h.div(
        [h.Class("outline-pane__document")],
        model.synced
          ? [
              h.submodel({
                slotId: "outline",
                model: model.outline,
                view: Outliner.view,
                viewInputs: {
                  ...policy,
                  label: "Outline",
                  showCheckboxes: false,
                  spellcheck: false,
                  emptyLabel: "Start writing",
                  decorations: decorationsOf(scene),
                  rowAccessory: (row: Row) => accessory(scene, row, h),
                  hover: hoverFor(scene, h),
                },
                toParentMessage: outlinerMessage,
              }),
            ]
          : [
              h.div(
                [h.Class("outline-pane__loading")],
                ["Opening the outline…"],
              ),
            ],
      ),
      h.footer(
        [h.Class("outline-pane__footer")],
        [
          h.span([], [h.kbd([], ["Return"]), " new bullet"]),
          h.span([], [h.kbd([], ["Tab"]), " nest"]),
          h.span([], [h.kbd([], ["@"]), " ask an agent"]),
          h.span([], [h.kbd([], [isMac ? "⌘J" : "Ctrl J"]), " next request"]),
        ],
      ),
    ],
  );
};
