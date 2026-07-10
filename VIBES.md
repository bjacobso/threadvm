# Vibes

## North Star

ThreadVM should feel like a meta-IDE for agentic development environments.

Not a cloud IDE clone. Not a dashboard. Not a chat wrapper. The closest mental model is: what if VS Code's workbench chrome were rebuilt from first principles for disposable remote work cells, agent terminals, previews, logs, metadata, and lifecycle control?

The UI should feel:

- dense.
- quiet.
- inspectable.
- keyboard-first.
- terminal-native.
- durable across reconnects.
- built for many parallel workspaces.

The product surface is the factory floor. Each ThreadVM is a work cell. The chrome exists to move between cells, inspect state, operate terminals, and retire work.

## Design Language

Use VS Code as a reference for interaction density and panel behavior, not as a skin to copy.

Use shadcn and Tailwind from first principles:

- semantic tokens.
- composable primitives.
- source-owned components.
- minimal ornament.
- predictable focus rings.
- collapsible sections.
- resizable panes.
- keyboard and command palette flows.

The design should be mostly neutral, with status color used only when it carries meaning.

Current base direction:

- dark neutral theme.
- JetBrains Mono everywhere.
- sharp workbench structure.
- subtle borders.
- compact controls.
- no decorative backgrounds.
- no marketing layout.
- no large card-driven page sections.

## Workbench Chrome

The app should have real IDE chrome:

- activity rail.
- primary side bar.
- central editor/workspace area.
- bottom panel.
- secondary side bar / inspector.
- status bar.
- command palette.

For ThreadVM, the mapping is:

```text
Activity rail       workspace modes: inventory, agents, ports, logs, settings
Primary side bar    ThreadVM inventory and project tree
Editor area         terminal, preview, diff, runbook, agent transcript
Bottom panel        problems, provisioning, dev logs, task output
Secondary side bar  selected ThreadVM inspector
Status bar          connection, selected VM, branch, agent, ports, stream state
```

The current three-pane shell is the MVP workbench. It should evolve toward collapsible, rearrangeable workbench surfaces without losing the simple default layout.

## Panels

Panels are structural, not decorative cards.

Every panel should have:

- compact header.
- optional icon.
- title.
- small status/meta text.
- toolbar actions aligned right.
- scrollable body.
- collapsible sections inside the body.

Panel headers should be about 32-40px tall. Section headers should be about 28-32px tall. Dense rows are preferable to large blocks.

Panel sections should support:

- expanded/collapsed state.
- count or status badge.
- right-side actions.
- loading skeletons.
- empty state text only when needed.

Examples:

```text
Inventory
  Running
  Bootstrapping
  Failed
  Pinned
  Stopped

Inspector
  Overview
  Agent
  Ports
  Provisioning
  Logs
  Metadata

Bottom Panel
  Problems
  Output
  Dev Log
  Provisioning
```

Use cards only for repeated items or modal content that genuinely needs a frame. The workbench itself should be panes, splitters, sections, rows, and tabs.

## Activity Rail

Long term, add a narrow left activity rail.

Possible icons:

- workspaces.
- terminal.
- agents.
- ports.
- logs.
- source control.
- settings.

Rules:

- icon buttons with tooltips.
- active state is clear but restrained.
- no text labels by default.
- badge counts for failed, running, or blocked work.

The activity rail should switch the primary side bar's content, not navigate to a marketing-style page.

## Inventory

The inventory is the project navigator for work cells.

It should support:

- grouping by project.
- grouping by status.
- pinned section.
- search/filter.
- quick switch.
- stale/failed visual state.
- compact branch and port hints.
- keyboard navigation.

Rows should feel like VS Code explorer rows:

- 24-32px tall.
- icon/status glyph left.
- name truncates cleanly.
- branch/status metadata right or secondary line only when needed.
- hover actions appear without shifting layout.

Avoid large VM cards. A user may have many active cells.

## Terminal Area

The terminal is the primary operator console.

It should be visually dominant but not isolated from context:

- terminal toolbar above.
- tabs for multiple terminal/session surfaces later.
- explicit attach/restart/close actions.
- status inline with the toolbar.
- focus ring only when useful.
- no decorative frame around the terminal.

The terminal toolbar should eventually include:

- selected VM name.
- attach/reconnect/restart.
- engine selector if Ghostty Web lands.
- split/new session.
- copy mode.
- search.
- clear.
- font size.
- connection/status indicator.

Terminal surfaces should preserve layout stability on resize. The terminal should never be pushed around by status text, logs, or notices.

## Editor-Like Surfaces

The center area should not be terminal-only forever.

It should support tabs like:

- Terminal.
- Preview.
- Diff.
- Runbook.
- Agent.
- Logs.

Tabs should behave like IDE editor tabs:

- compact.
- closeable when relevant.
- preserve per-VM state.
- keyboard addressable.
- no card chrome around each view.

Preview and diff are first-class workbench surfaces, not external afterthoughts.

## Inspector

The inspector is the secondary side bar.

It should answer:

- What is selected?
- What is its state?
- What can I do to it?
- What is failing?
- Where are the logs, ports, and metadata?

Use collapsible sections rather than one long details page:

- Summary.
- Lifecycle.
- Agent.
- Ports.
- Provisioning.
- Dev Log.
- Metadata.
- Raw.

Actions should be icon-first where familiar:

- refresh.
- copy.
- open.
- stop.
- delete.
- pin.

Destructive actions require confirmation, but confirmations should be compact and direct.

## Bottom Panel

A bottom panel makes the app feel more like a development workbench.

It should hold noisy or time-based output:

- provisioning logs.
- dev logs.
- problems.
- task output.
- port probe output.
- agent events.

It should be:

- collapsible.
- resizable.
- tabbed.
- keyboard-toggleable.
- able to follow the selected ThreadVM.

Default can stay hidden until there is meaningful output or an error.

## Command Palette

The command palette is a core surface, not a shortcut novelty.

Commands should include:

- Create ThreadVM.
- Switch ThreadVM.
- Attach Terminal.
- Restart Terminal.
- Open Preview.
- Check Ports.
- Refresh Inventory.
- Stop ThreadVM.
- Remove ThreadVM.
- Open Project Registry.
- Toggle Inspector.
- Toggle Bottom Panel.
- Focus Inventory.
- Focus Terminal.
- Focus Inspector.

Command names should be verb-first and searchable. The palette should expose the product model better than buttons alone.

## Status Bar

Add a thin bottom status bar when the app has enough live state.

Candidate items:

- API connection state.
- reconciliation stream state.
- selected ThreadVM.
- VM state.
- branch.
- terminal session status.
- active agent.
- port count.
- provisioning status.

Keep it compact. Use it for ambient truth, not primary actions.

## Interaction Rules

Keyboard:

- Cmd/Ctrl-K opens command palette.
- shortcuts should be discoverable in command labels.
- focus movement between panels should be explicit.
- terminal shortcuts must not fight shell/TUI input.

Mouse:

- splitters should be easy to grab.
- hover actions should not resize rows.
- double-click row can attach/open.
- right-click context menus are appropriate for inventory rows.

State:

- selection persists.
- active terminal VM persists.
- collapsed sections should persist per user.
- pane sizes should eventually persist.

## Component Use

Use shadcn primitives as the workbench kit:

- `ResizablePanelGroup` for panes.
- `ScrollArea` for pane bodies.
- `Tooltip` for icon buttons.
- `Command` for palette and quick switch.
- `Tabs` for editor and bottom panel surfaces.
- `Dialog` and `AlertDialog` for focused workflows.
- `Sheet` for mobile inspector.
- `Badge` for compact state.
- `Separator` for pane and toolbar boundaries.
- `DropdownMenu` for overflow actions.
- `Table` or definition-list patterns for metadata.
- `Skeleton` for loading.

Avoid:

- page cards wrapping whole sections.
- gradient panels.
- oversized hero typography.
- decorative illustrations.
- rounded pill overload.
- one-off colors inside feature components.

## Visual Tokens

Keep the palette neutral and operational.

Important token groups:

- app background.
- pane/sidebar background.
- terminal background.
- terminal chrome.
- border.
- muted foreground.
- active selection.
- focus ring.
- status colors.

Status colors should be sparse:

- running: green.
- attached: blue/cyan.
- bootstrapping or pending: amber.
- failed/destructive: red.
- stopped/unknown: muted.

Color is secondary to text, icon, and placement. Never require color alone to understand state.

## Density

This is expert software. It can be dense.

Default scale:

- body text: 12-13px.
- metadata text: 11-12px.
- panel headers: 12px semibold.
- row height: 26-32px.
- toolbar buttons: icon or icon+short label.
- borders: 1px.
- radius: 4-8px max.

Use whitespace for scanning, not for drama.

## Responsive Shape

Desktop is the primary target.

Mobile and narrow layouts should preserve operations:

- inventory can become a sheet.
- inspector can become a sheet.
- terminal remains central.
- bottom panel can collapse behind tabs.

Do not redesign into a mobile dashboard. Keep the workbench model.

## What It Would Look Like As A VS Code Plugin

If this were a VS Code extension, it would probably have:

- an activity bar icon for ThreadVM.
- a side bar tree of work cells.
- webview editor tabs for terminal/preview/agent surfaces.
- a tree item context menu for stop/remove/attach/open preview.
- status bar items for selected VM and stream state.
- output channels for provisioning and dev logs.
- commands for create, attach, switch, and inspect.

ThreadVM as a standalone app should keep those affordances, but it is free to be better than a plugin:

- stronger terminal layout.
- richer inspector.
- multiple panes at once.
- direct control over shell chrome.
- more coherent factory-floor model.

## First UI Evolution

1. Add collapsible sections to the inventory and inspector.
2. Add a proper panel header component shared by inventory, terminal, inspector, and future bottom panel.
3. Add pane-size persistence.
4. Add a hidden-by-default bottom panel for provisioning/dev output.
5. Expand command palette coverage.
6. Add context menus to ThreadVM rows.
7. Add status bar once stream/session state is useful enough.
8. Keep the existing three-pane layout as the default workbench preset.
