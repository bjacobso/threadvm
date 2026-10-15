import * as stylex from "@stylexjs/stylex";
import { Button } from "@foldworks/ui";
import { Outliner, type Row } from "@foldworks/outliner";
import { History } from "@foldworks/history";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import type {
  AgentSignal,
  OutlineOperation,
  Proposal,
  Run,
} from "@threadvm/shared/domain";
import { activity } from "./activity.ts";
import { available, dirty, msg, type Model, type Message } from "./state.ts";

const sx = stylex.create({
  app: {
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    padding: "0 24px",
    height: 62,
    flexShrink: 0,
    borderBottom: "1px solid var(--border)",
  },
  main: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 320px",
    minHeight: 0,
    flexGrow: 1,
    "@media (max-width: 900px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  document: { overflowY: "auto", padding: "28px 32px", minWidth: 0 },
  aside: {
    borderLeft: "1px solid var(--border)",
    overflowY: "auto",
    padding: 24,
    "@media (max-width: 900px)": { display: "none" },
  },
  spacer: { flexGrow: 1 },
  muted: { color: "var(--muted-foreground)", fontSize: 12 },
});
type H = HtmlBuilder<Message>;
const cls = (style: stylex.StyleXStyles) => stylex.props(style).className ?? "";
const opId = (op: OutlineOperation) =>
  op.type === "insert" ? op.node.id : op.id;
const label = (op: OutlineOperation): string => {
  switch (op.type) {
    case "insert":
      return op.node.text;
    case "update":
      return [
        op.patch.text,
        op.patch.done === undefined
          ? undefined
          : op.patch.done
            ? "Mark done"
            : "Reopen",
      ]
        .filter(Boolean)
        .join(" · ");
    case "delete":
      return "Delete this bullet and its descendants";
    case "move":
      return `Move to ${op.parent ?? "top level"}${op.after ? ` after ${op.after}` : " (first)"}`;
  }
};
const action = (
  label: string,
  message: Message,
  m: Model,
  h: H,
  variant: "ghost" | "primary" = "ghost",
) =>
  Button.view(
    { label, variant, size: "xs", isDisabled: !available(m), onClick: message },
    h,
  );
const review = (m: Model, p: Proposal, ids: string[], h: H): Html =>
  h.div(
    [h.Class("local-actions")],
    [
      action(
        ids.length ? "Accept" : "Accept batch",
        { _tag: "Review", proposalId: p.id, decision: "accept", nodeIds: ids },
        m,
        h,
        "primary",
      ),
      action(
        ids.length ? "Reject" : "Reject batch",
        { _tag: "Review", proposalId: p.id, decision: "reject", nodeIds: ids },
        m,
        h,
      ),
    ],
  );
const proposalRows = (m: Model, parent: string | null, h: H): Html[] => {
  const result: Html[] = [];
  for (const p of m.data?.snapshot.proposals ?? []) {
    const groups = new Map<string, OutlineOperation[]>();
    for (const op of p.batch.operations) {
      if (!p.pending.includes(opId(op))) continue;
      // Inserts live under their proposed parent; other changes live under their target.
      // A proposed parent can itself be pending: keep its subtree together in the same inline card.
      let place = op.type === "insert" ? op.parent : op.id;
      const visited = new Set<string>();
      while (
        place &&
        !m.data?.snapshot.nodes.some((n) => n.id === place) &&
        !visited.has(place)
      ) {
        visited.add(place);
        const ancestor = p.batch.operations.find(
          (n) => n.type === "insert" && n.node.id === place,
        );
        place = ancestor?.type === "insert" ? ancestor.parent : null;
      }
      if (place !== parent) continue;
      const id = opId(op);
      groups.set(id, [...(groups.get(id) ?? []), op]);
    }
    for (const [id, ops] of groups)
      result.push(
        h.div(
          [
            h.Class("local-suggestion"),
            h.DataAttribute("proposal", p.id),
            h.DataAttribute("suggestion", id),
          ],
          [
            h.div(
              [h.Class("local-suggestion__text")],
              [
                h.span(
                  [h.Class("local-eyebrow")],
                  ["Suggested · awaiting your review"],
                ),
                ...ops.map((op) => h.div([], [label(op)])),
              ],
            ),
            review(m, p, [id], h),
          ],
        ),
      );
  }
  return result;
};
const pendingPermissions = (m: Model, run: Run): AgentSignal[] => {
  const events = (m.data?.events ?? []).filter((e) => e.runId === run.id);
  return events.flatMap((e) =>
    e.agent?.type === "permission" &&
    !events.some(
      (r) =>
        r.agent?.type === "permission_resolved" &&
        r.agent.requestId === e.agent?.requestId,
    ) &&
    !events.some((r) => r.agent?.type === "cancelled") &&
    run.status === "running"
      ? [e.agent]
      : [],
  );
};
const runPanel = (m: Model, run: Run, h: H): Html => {
  const opened = m.opened.includes(run.id);
  const observations = activity(m.data?.events ?? [], run.id).slice(-6);
  return h.section(
    [
      h.Class("local-run"),
      h.DataAttribute("run", run.id),
      h.AriaLabel(`Run ${run.id}`),
    ],
    [
      h.div(
        [h.Class("local-run__header")],
        [
          h.span(
            [
              h.Class("status-pill"),
              h.DataAttribute(
                "status",
                run.status === "running" ? "working" : "idle",
              ),
            ],
            [`${run.agent} · ${run.status}`],
          ),
          h.code([h.Class("local-run__branch")], [run.branch]),
          Button.view(
            {
              label: opened ? "Detach terminal" : "Attach terminal",
              size: "xs",
              variant: "ghost",
              onClick: { _tag: "Attach", runId: run.id },
            },
            h,
          ),
          ...(run.agent === "acp" && run.status === "running"
            ? [
                action(
                  "Cancel",
                  {
                    _tag: "Control",
                    action: "cancel",
                    runId: run.id,
                    requestId: "",
                    optionId: "",
                  },
                  m,
                  h,
                ),
              ]
            : []),
        ],
      ),
      ...pendingPermissions(m, run).map((permission) =>
        h.div(
          [h.Class("local-permission")],
          [
            h.strong([], [permission.title ?? "Permission requested"]),
            h.details(
              [],
              [
                h.summary([], ["Requested action"]),
                h.pre(
                  [h.Class("local-permission__details")],
                  [
                    JSON.stringify(permission.payload, null, 2) ??
                      "No additional details",
                  ],
                ),
              ],
            ),
            h.div(
              [h.Class("local-actions")],
              (permission.options ?? []).map((option) =>
                action(
                  option.name,
                  {
                    _tag: "Control",
                    runId: run.id,
                    action: "permission",
                    requestId: permission.requestId!,
                    optionId: option.id,
                  },
                  m,
                  h,
                ),
              ),
            ),
          ],
        ),
      ),
      ...(opened
        ? [
            h.iframe(
              [
                h.Src(`/terminal/${run.id}`),
                h.Title(`Terminal for ${run.agent} run ${run.id}`),
                h.Class("local-terminal"),
              ],
              [],
            ),
          ]
        : []),
      h.div(
        [h.Class("local-observations")],
        observations.map((event) => {
          return h.div(
            [],
            [
              h.time([], [new Date(event.time).toLocaleTimeString()]),
              " ",
              event.text,
            ],
          );
        }),
      ),
    ],
  );
};
const accessory = (m: Model, row: Row, h: H): Html =>
  h.div(
    [h.Class("local-row-content")],
    [
      h.div(
        [h.Class("local-row-actions")],
        [action(`Run ${m.agent}`, { _tag: "Start", nodeId: row.id }, m, h)],
      ),
      ...(m.delegating === row.id
        ? [
            h.div(
              [h.Class("local-permission")],
              [
                h.strong([], ["Delegate this intention"]),
                h.div(
                  [h.Class("local-actions")],
                  [
                    action(
                      `Start ${m.agent} run`,
                      { _tag: "Start", nodeId: row.id },
                      m,
                      h,
                      "primary",
                    ),
                    Button.view(
                      {
                        label: "Keep editing",
                        size: "xs",
                        variant: "ghost",
                        onClick: { _tag: "DismissRun" },
                      },
                      h,
                    ),
                  ],
                ),
              ],
            ),
          ]
        : []),
      ...proposalRows(m, row.id, h),
      ...(m.data?.runs ?? [])
        .filter((r) => r.nodeId === row.id)
        .map((run) => runPanel(m, run, h)),
    ],
  );

export const view = (m: Model, h: H): Document => ({
  title: "ThreadVM · Local outline",
  body: h.div(
    [h.Class(`${cls(sx.app)} local-app`)],
    [
      h.header(
        [h.Class(cls(sx.header))],
        [
          h.strong([], ["ThreadVM"]),
          h.span([h.Class(cls(sx.muted))], ["Local outline"]),
          h.span([h.Class(cls(sx.spacer))], []),
          h.span(
            [h.Class(cls(sx.muted)), h.Role("status")],
            [
              m.data === null
                ? "Connecting…"
                : m.sent !== null || m.busy
                  ? "Saving…"
                  : dirty(m)
                    ? "Unsaved edits"
                    : `Saved · r${m.data.snapshot.revision}`,
            ],
          ),
          h.a([h.Href("/inventory"), h.Class("link-chip")], ["VM inventory"]),
        ],
      ),
      ...(m.error
        ? [
            h.div(
              [h.Class("local-error"), h.Role("alert")],
              [
                m.error,
                ...(m.blocked
                  ? [
                      Button.view(
                        {
                          label: "Retry original batch",
                          variant: "ghost",
                          size: "xs",
                          onClick: { _tag: "Refresh" },
                        },
                        h,
                      ),
                      Button.view(
                        {
                          label: "Discard draft and reload",
                          variant: "ghost",
                          size: "xs",
                          onClick: { _tag: "Discard" },
                        },
                        h,
                      ),
                    ]
                  : []),
              ],
            ),
          ]
        : []),
      h.main(
        [h.Class(cls(sx.main))],
        [
          h.section(
            [h.Class(cls(sx.document)), h.AriaLabel("Local outline")],
            [
              h.div(
                [h.Class("outline-toolbar")],
                [
                  Button.view(
                    {
                      label: "Undo",
                      variant: "ghost",
                      size: "xs",
                      isDisabled: !History.canUndo(m.outline.history),
                      onClick: msg.Child(Outliner.Message.ClickedUndo()),
                    },
                    h,
                  ),
                  Button.view(
                    {
                      label: "Redo",
                      variant: "ghost",
                      size: "xs",
                      isDisabled: !History.canRedo(m.outline.history),
                      onClick: msg.Child(Outliner.Message.ClickedRedo()),
                    },
                    h,
                  ),
                  h.span([h.Class("outline-toolbar__spacer")], []),
                  h.label(
                    [h.Class("local-agent")],
                    [
                      "Executor ",
                      h.select(
                        [
                          h.AriaLabel("Executor"),
                          h.Value(m.agent),
                          h.OnChange((agent) => ({
                            _tag: "ChooseAgent",
                            agent: agent as Model["agent"],
                          })),
                        ],
                        ["shell", "codex", "claude", "acp"].map((agent) =>
                          h.option(
                            [h.Value(agent)],
                            [
                              agent === "acp"
                                ? "ACP (configured agent)"
                                : agent,
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              h.h1(
                [h.Class("local-title")],
                [
                  m.data?.snapshot.nodes.find((n) => n.parent === null)?.text ??
                    "Start with an intention",
                ],
              ),
              h.p(
                [h.Class("local-intro")],
                [
                  "Write what you want to happen. Delegate a bullet when it is ready. Review what comes back.",
                ],
              ),
              ...(m.data === null
                ? [h.p([], ["Opening the project…"])]
                : [
                    h.submodel({
                      slotId: "local-outline",
                      model: m.outline,
                      view: Outliner.view,
                      viewInputs: {
                        label: "Outline",
                        showCheckboxes: true,
                        spellcheck: false,
                        emptyLabel: "Your first intention",
                        isReadOnly: () => m.busy,
                        rowAccessory: (row: Row) => accessory(m, row, h),
                      },
                      toParentMessage: msg.Child,
                    }),
                  ]),
              ...proposalRows(m, null, h),
              h.footer(
                [h.Class("outline-pane__footer")],
                [
                  "Return · new bullet     Tab · nest     Drag · reorder     Run · explicit delegation",
                ],
              ),
            ],
          ),
          h.aside(
            [h.Class(cls(sx.aside)), h.AriaLabel("Local harness")],
            [
              h.h2([h.Class("panel__title")], ["Local harness"]),
              h.p(
                [h.Class("panel__subtitle")],
                ["Each run owns a Git worktree and a durable tmux session."],
              ),
              h.code([h.Class("local-project")], [m.data?.projectDir ?? ""]),
              h.h3([h.Class("section-title")], ["Review"]),
              ...(m.data?.snapshot.proposals
                .filter((p) => p.pending.length)
                .flatMap((p) => [
                  h.div(
                    [h.Class("local-batch")],
                    [
                      h.strong([], [`${p.pending.length} suggested bullets`]),
                      h.span(
                        [h.Class(cls(sx.muted))],
                        [
                          p.runId
                            ? `Run ${p.runId.slice(0, 8)}`
                            : "CLI proposal",
                        ],
                      ),
                      review(m, p, [], h),
                    ],
                  ),
                ]) ?? []),
              h.h3([h.Class("section-title")], ["Running"]),
              ...(m.data?.runs
                .filter(
                  (r) => r.status === "running" || r.status === "starting",
                )
                .map((r) =>
                  h.div(
                    [h.Class("local-batch")],
                    [
                      h.strong([], [r.agent]),
                      h.span([h.Class(cls(sx.muted))], [r.branch]),
                      h.span(
                        [
                          h.Class("status-pill"),
                          h.DataAttribute(
                            "status",
                            pendingPermissions(m, r).length
                              ? "needs"
                              : "working",
                          ),
                        ],
                        [
                          pendingPermissions(m, r).length
                            ? "Needs permission"
                            : r.status,
                        ],
                      ),
                    ],
                  ),
                ) ?? []),
              h.p(
                [h.Class("local-help")],
                [
                  "ACP controls agents through a standard protocol. Configure .threadvm/acp.json with an agent command and args. Shell, Codex and Claude terminal runs remain available.",
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  ),
});
