import {
  Box,
  Brain,
  Check,
  CircleAlert,
  Eye,
  GitBranch,
  LoaderCircle,
  Pencil,
  Search,
  Terminal,
  type LucideIconData,
} from "@lucide/icons";
import { Icon } from "@foldworks/ui";
import type { Html, HtmlBuilder } from "foldkit/html";

import { AGENTS } from "../../shared/agents.ts";
import { pendingOps, type AgentId, type StepKind, type Thread } from "../../shared/protocol.ts";
import type { Message } from "../message.ts";

export type H = HtmlBuilder<Message>;

export const avatar = (agent: AgentId, h: H, size: "sm" | "md" = "sm"): Html =>
  h.span(
    [
      h.Class(`agent-avatar agent-avatar--${size}`),
      h.DataAttribute("agent", agent),
      h.Title(`${AGENTS[agent].name} · ${AGENTS[agent].harness}`),
      h.AriaHidden(true),
    ],
    [AGENTS[agent].initials],
  );

/** What a thread is doing, in a few words. */
export const statusLabel = (thread: Thread): string => {
  switch (thread.status) {
    case "Queued":
    case "Provisioning":
      return "Starting";
    case "Working":
      return thread.headline;
    case "NeedsInput":
      return "Needs you";
    case "Review": {
      const count = pendingOps(thread).length;
      return `${count} to review`;
    }
    case "Done":
      return pendingOps(thread).length > 0 ? `${pendingOps(thread).length} to review` : "Done";
    case "Cancelled":
      return "Stopped";
    case "Failed":
      return "Failed";
  }
};

/** Used as `data-status` for color. */
export const statusTone = (thread: Thread): string => {
  if (thread.status === "NeedsInput") return "needs";
  if (pendingOps(thread).length > 0 && thread.status !== "Cancelled") return "review";
  switch (thread.status) {
    case "Queued":
    case "Provisioning":
    case "Working":
      return "working";
    case "Done":
      return "done";
    default:
      return "idle";
  }
};

const STEP_ICONS: Readonly<Record<StepKind, LucideIconData>> = {
  sandbox: Box,
  git: GitBranch,
  read: Eye,
  bash: Terminal,
  edit: Pencil,
  search: Search,
  think: Brain,
};

export const stepIcon = (kind: StepKind, state: "Running" | "Done" | "Failed", h: H): Html =>
  h.span(
    [h.Class("step__icon"), h.DataAttribute("state", state)],
    [
      Icon.view(
        {
          icon: state === "Running" ? LoaderCircle : state === "Failed" ? CircleAlert : STEP_ICONS[kind],
          size: 14,
        },
        h,
      ),
    ],
  );

export const doneIcon = (h: H): Html => Icon.view({ icon: Check, size: 12 }, h);

export const clock = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
