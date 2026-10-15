import { RotateCcw } from "@lucide/icons";
import { Button } from "@foldworks/ui";
import type { Document, HtmlBuilder } from "foldkit/html";

import { totals } from "../attention.ts";
import { Message } from "../message.ts";
import type { Model } from "../model.ts";
import { realItems } from "../projection.ts";
import { outlinePane } from "./outline.ts";
import { panel } from "./panel.ts";
import type { H } from "./parts.ts";

const CONNECTION_LABELS: Readonly<Record<Model["connection"], string>> = {
  Connecting: "Connecting",
  Online: "Live",
  Offline: "Reconnecting",
};

const header = (model: Model, h: H) => {
  const real = realItems(model.outline.items);
  const tally = totals(real, model.threads);
  const counter = (kind: "NeedsInput" | "Review" | "Working", count: number, label: string) =>
    h.button(
      [
        h.Class("attention"),
        h.Type("button"),
        h.DataAttribute("kind", kind),
        h.DataAttribute("empty", String(count === 0)),
        h.Disabled(count === 0),
        h.Title(count === 0 ? label : `Jump to the next (${kind === "NeedsInput" ? "⌘J" : "click"})`),
        h.OnClick(Message.JumpedToAttention({ kind })),
      ],
      [h.span([h.Class("attention__dot"), h.AriaHidden(true)], []), h.strong([], [String(count)]), ` ${label}`],
    );
  return h.header(
    [h.Class("app-header")],
    [
      h.div(
        [h.Class("app-header__brand")],
        [
          h.span([h.Class("brand-mark"), h.AriaHidden(true)], []),
          h.span([h.Class("brand-name")], ["Outline"]),
          h.span([h.Class("brand-doc")], [real[0]?.text ?? ""]),
        ],
      ),
      h.div(
        [h.Class("app-header__attention"), h.AriaLabel("Agent activity")],
        [
          counter("NeedsInput", tally.NeedsInput, "need you"),
          counter("Review", tally.Review, "to review"),
          counter("Working", tally.Working, "working"),
        ],
      ),
      h.div(
        [h.Class("app-header__end")],
        [
          h.span(
            [h.Class("connection"), h.DataAttribute("state", model.connection)],
            [h.span([h.Class("connection__dot"), h.AriaHidden(true)], []), CONNECTION_LABELS[model.connection]],
          ),
          Button.view(
            {
              icon: RotateCcw,
              ariaLabel: "Reset the demo outline",
              variant: "ghost",
              size: "icon",
              attributes: [h.Title("Reset the demo outline")],
              onClick: Message.ClickedResetDemo(),
            },
            h,
          ),
        ],
      ),
    ],
  );
};

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "Outline",
  body: h.div(
    [h.Class("app")],
    [
      header(model, h),
      h.main([h.Class("app-main")], [outlinePane(model, h), panel(model, h)]),
      h.div([h.Class("sr-only"), h.Role("status"), h.AriaLive("polite")], [model.announcement]),
    ],
  ),
});
