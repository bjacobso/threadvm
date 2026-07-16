# Vibes

## North Star

Harness should feel like ChatGPT or Codex for live development workspaces: calm,
direct, and easy to enter. The infrastructure can be sophisticated without the
interface feeling like an infrastructure console.

The product is a focused place to start a task, watch it run, open its terminal,
and inspect the result. It is not a VS Code clone, a VM dashboard, or a dense
operations workbench.

The UI should feel:

- conversational without becoming a chat imitation.
- consumer-friendly without becoming decorative.
- brutally clean.
- quiet and confident.
- fast to scan.
- approachable to someone who does not know the internal architecture.
- powerful when details are needed, but simple by default.

## Product Language

Lead with the user's work, not the implementation primitive.

Prefer:

- task instead of ThreadVM.
- workspace instead of VM or work cell.
- new task instead of create ThreadVM.
- connect instead of attach terminal.
- details instead of inspector.
- projects instead of project registry.
- search tasks instead of quick switch.

Technical names are appropriate inside advanced details, logs, and errors when
they help someone diagnose a problem. They should not dominate primary
navigation or first-run copy.

Keep labels short and sentence-cased. Avoid uppercase section labels, internal
acronyms, factory metaphors, and copy that describes the control plane rather
than the user's goal.

## Design Language

Build from raw shadcn primitives and semantic tokens. The result should feel
source-owned and unthemed, not like a branded component kit.

- use neutral surfaces with one clear elevation step.
- use system sans for product UI and monospace only for code, logs, and terminal
  output.
- use rounded selection states and controls, but avoid pill-heavy interfaces.
- use borders only to explain real structure.
- use status color only when it carries meaning.
- keep icons familiar, sparse, and secondary to labels.
- prefer whitespace and alignment over extra containers.
- avoid gradients, decorative backgrounds, glows, and ornamental cards.

The dark theme should use one warm neutral charcoal token for navigation, top
bars, and gutter surfaces. Reserve true black for the terminal so its boundary
is obvious without a heavy frame. Borders should be quiet, consistent gray
separators and should not divide chrome surfaces that already share a color.
Focus treatments should be visible during keyboard use without drawing boxes
around whole regions during ordinary interaction.

## App Shell

The default shell has two layers:

1. A stable task sidebar grouped by project.
2. A generous primary workspace for the selected task.

Keep the sidebar within a compact, resizable width so additional viewport space
always benefits the primary workspace. Its resize seam should disappear until
hovered or focused.

Details, logs, ports, and lifecycle controls live in a secondary sheet or
contextual surface. They should not permanently compress the primary workspace.
Resizable regions are useful, but splitters should disappear into the layout
until hovered or focused.

The sidebar should feel closer to ChatGPT or Codex history than a file explorer:

- a clear New task action at the top.
- search close at hand.
- friendly project group names.
- compact, rounded task rows.
- subtle state and pin indicators.
- row actions that appear on hover without shifting content.
- no tree chevrons, activity rail, or Explorer label by default.

## Primary Workspace

The selected task name is the primary title. Project, branch, and connection
state are supporting context, not a breadcrumb hierarchy or editor tab strip.
Keep that information in one top bar above the workspace.

The header should have one level and only the actions that matter now:

- connect or reconnect.
- view details.
- restart when needed.
- handle pending clipboard access when present.

The terminal remains the dominant tool and keeps a purpose-built monospace
surface. Present it as one rounded, inset panel that fills the remaining main
area with a slim, visible gutter. The terminal should feel like a focused canvas
rather than another structural pane. Its surrounding controls should feel like
the rest of the product, not like emulated terminal or editor chrome.

Future preview, diff, agent, and log surfaces should be simple modes within the
task rather than a reconstruction of IDE editor tabs.

## Details

The details sheet answers four questions:

- What is this workspace doing?
- What can I open?
- What needs attention?
- What can I do next?

Use plain section titles, compact metadata, shadcn tabs where they improve
scanning, and clear destructive-action confirmation. Hide paths, raw payloads,
and provider-specific metadata behind advanced disclosure when the surface gets
too long.

## Interaction

- preserve keyboard navigation and Command-K search.
- keep hit targets comfortable even when rows are visually compact.
- do not expose hover-only actions as the sole way to complete an important
  task.
- use sheets and dialogs for focused secondary work.
- write empty states as a helpful next action, not a diagnostic message.
- prefer immediate, reversible actions; confirm destructive ones.
- make loading calm and layout-stable.

## Quality Bar

At a glance, a new user should understand how to start a task and reopen an
existing one. An experienced user should still be able to reach terminals,
ports, logs, lifecycle actions, and raw metadata quickly.

When a design choice makes the product feel more like an IDE, admin dashboard,
or cloud console, simplify it until the user's task is primary again.
