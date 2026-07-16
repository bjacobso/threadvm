# ThreadVM Plan 2

## Goal

Evolve ThreadVM from the MVP harness into a durable local web app with a cleaner frontend architecture, a small monorepo, shared typed contracts, and a minimal but polished shadcn/Tailwind design system.

The working pieces from the MVP should stay:

- Effect Platform local server.
- Typed `HttpApi` contract.
- exe.dev reflection through Effect services.
- Browser terminal backed by SSH/PTTY bridge.
- Persistent per-VM terminal sessions, resize propagation, reconnect, and OSC 52 clipboard forwarding.

The next phase should improve how the app is structured and how the UI is built.

## Product Direction

ThreadVM should feel like a focused operations console, not a landing page or marketing site.

The UI should remain minimal:

- Left rail: reflected ThreadVM inventory.
- Center: active terminal and workflow surfaces.
- Right inspector: metadata, ports, actions, logs.
- No decorative hero sections, large cards, gradients, or visual noise.
- Dense, keyboard-friendly, terminal-adjacent interface.

Use shadcn components and design tokens to make the UI consistent, accessible, and easier to maintain, while keeping the visual chrome quiet.

## Stack Decisions

### Frontend

- Vite.
- React.
- Effect Atom for client state.
- shadcn/ui for component source.
- Tailwind CSS v4 for styling and design tokens.
- JetBrains Mono across the entire app, including chrome and terminal.
- xterm.js remains the terminal renderer.

### Backend

- Effect Platform.
- Effect services for exe.dev, SSH, local store, terminal bridge, workspace orchestration.
- `HttpApi` for typed resource endpoints.
- RPC or RPC-shaped streaming endpoints for terminal IO, provisioning logs, reconciliation events, and long-running workflows.

### State Management

Use Effect Atom for client state instead of ad hoc React state once the UI grows past the current single-file shape.

State domains:

- `threadVmsAtom`: reflected VM inventory.
- `selectedThreadVmAtom`: current selection.
- `terminalSessionAtomFamily`: per-VM terminal attach/reconnect state.
- `terminalUiAtom`: transient UI state such as status, clipboard notice, and focused panel.
- `projectConfigAtom`: loaded project registry.
- `reconciliationAtom`: polling or streaming VM metadata refresh state.

React component state is still fine for local widget state, but app state should move into atoms.

## Monorepo Decision

Use a Turborepo monorepo if we are about to add shadcn, shared contracts, and multiple app/package boundaries. It is worth it for ThreadVM because the project naturally splits into:

- a web app,
- a local server,
- shared domain schemas,
- shared API contract,
- shared UI components and tokens,
- future CLI and plugin surfaces.

Avoid over-fragmenting. Start with a small monorepo and only split packages around real ownership boundaries.

Recommended structure:

```text
threadvm/
  apps/
    web/
      index.html
      src/
        app/
        features/
        routes/
        state/
        terminal/
      vite.config.ts
    server/
      src/
        main.ts
        terminalRoutes.ts
    cli/
      src/
        main.ts
  packages/
    api/
      src/
        ThreadVmApi.ts
        handlers.ts
    domain/
      src/
        schema.ts
    services/
      src/
        CommandService.ts
        ConfigService.ts
        ExeDevService.ts
        TerminalBridge.ts
        WorkspaceService.ts
    ui/
      src/
        components/
        lib/
        styles/
  scripts/
    pty_bridge.py
  examples/
    projects.yaml
  package.json
  turbo.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

If we want less churn initially, use an intermediate structure:

```text
apps/web
apps/server
packages/shared
```

Then split `packages/shared` into `api`, `domain`, and `services` later.

## Package Manager

Move to `pnpm` when adopting Turborepo.

Reasons:

- Better workspace support.
- Better dependency isolation.
- Common Turborepo path.
- shadcn monorepo examples work cleanly with workspace packages.

Migration notes:

- Replace `package-lock.json` with `pnpm-lock.yaml`.
- Add `packageManager` to root `package.json`.
- Keep scripts simple:
  - `pnpm dev`
  - `pnpm build`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm start`

## shadcn and Tailwind 4 Plan

Initialize shadcn in the Vite app, not at the repo root.

Target:

- Tailwind v4.
- shadcn components source-owned under `packages/ui` or `apps/web/src/components/ui`, depending on how quickly we adopt the monorepo.
- Semantic tokens only.
- No raw one-off color palettes in components.
- Minimal theme tuned for a terminal/control-plane app.

Preferred shadcn components:

- `button`
- `badge`
- `separator`
- `scroll-area`
- `resizable`
- `tooltip`
- `dropdown-menu`
- `command`
- `dialog`
- `sheet`
- `tabs`
- `table`
- `skeleton`
- `sonner`
- `alert`
- `field`
- `input`
- `textarea`
- `select`
- `switch`

Use components for structure, but avoid card-heavy layouts. Cards are appropriate for repeated items, dialogs, and framed tools. The main app shell should be full-height bands/panes.

### Design Tokens

Use Tailwind v4 tokens and shadcn CSS variables for:

- background.
- foreground.
- muted.
- border.
- accent.
- destructive.
- ring.
- sidebar.
- terminal surface.
- terminal chrome.
- status tokens.

Add ThreadVM-specific tokens only when the generic tokens are not expressive enough:

- `--terminal-background`
- `--terminal-foreground`
- `--terminal-selection`
- `--status-running`
- `--status-attached`
- `--status-blocked`
- `--status-failed`

## Typography

Use JetBrains Mono across the whole UI:

- app chrome.
- buttons.
- metadata tables.
- terminal.
- command palette.
- logs.

Implementation:

- Prefer local or package-provided font files if we want offline reliability.
- Otherwise import via CSS during development and later vendor it.
- Set the base font family in the global stylesheet.
- Set xterm `fontFamily` to the same stack.

Font stack:

```css
font-family:
  "JetBrains Mono",
  ui-monospace,
  SFMono-Regular,
  Menlo,
  Monaco,
  Consolas,
  "Liberation Mono",
  monospace;
```

## UI Architecture

### App Shell

Replace custom CSS shell with shadcn-compatible primitives:

- `ResizablePanelGroup` for left rail, terminal pane, inspector.
- `ScrollArea` for VM list and inspector.
- `Separator` between toolbar and terminal.
- `Button` for actions.
- `Badge` for state labels.
- `Tooltip` for compact icon buttons.
- `DropdownMenu` for per-VM actions.
- `Command` dialog for quick switching between VMs.

Keep the shell visually minimal:

- no nested cards.
- no large section wrappers.
- no decorative gradients.
- tight spacing.
- stable panel dimensions.

### ThreadVM List

Feature module:

```text
apps/web/src/features/threadvms/
  ThreadVmList.tsx
  ThreadVmRow.tsx
  ThreadVmStateBadge.tsx
  threadVmAtoms.ts
```

Behavior:

- Refresh inventory from `GET /api/threadvms`.
- Keep selected VM in an atom persisted to local storage.
- Show status, source, branch, and port hint when available.
- Support keyboard navigation later.

### Terminal

Feature module:

```text
apps/web/src/features/terminal/
  TerminalPane.tsx
  TerminalToolbar.tsx
  terminalAtoms.ts
  osc52.ts
  xtermTheme.ts
```

Keep:

- xterm.js.
- fit addon.
- terminal resize RPC.
- reconnect to existing per-VM session.
- restart session action.
- OSC 52 clipboard forwarding.

Improve:

- move terminal state into Effect Atom.
- expose copy fallback through `sonner` or a toolbar action.
- show session age and reused/new status in a compact badge.
- add keyboard shortcut for reconnect/restart only after the core UX is stable.

### Inspector

Feature module:

```text
apps/web/src/features/inspector/
  InspectorPanel.tsx
  MetadataTable.tsx
  PortLinks.tsx
  LifecycleActions.tsx
```

Use:

- `Table` or definition-list-like component styling for metadata.
- `Badge` for source/state.
- `Button` with icon for actions.
- `AlertDialog` for destructive VM deletion.

## Effect Atom State Plan

Initial atom layer:

```text
apps/web/src/state/
  apiClient.ts
  atoms.ts
  storage.ts
```

Atoms:

- `threadVmsAtom`
  - async load from typed API client.
- `refreshThreadVmsAtom`
  - action atom that reloads inventory.
- `selectedThreadVmIdAtom`
  - persisted local storage atom.
- `selectedThreadVmAtom`
  - derived from inventory and selected ID.
- `terminalAttachAtomFamily(vmId)`
  - attach/reconnect/restart workflow.
- `terminalStatusAtomFamily(vmId)`
  - detached/connecting/attached/disconnected/exited.
- `clipboardNoticeAtom`
  - OSC 52 copy result.

Principles:

- Fetching and mutation live in atoms or Effect services, not in component bodies.
- Components subscribe to state and dispatch actions.
- Long-running streams should have explicit resource cleanup.
- Server state still comes from Effect services and exe.dev, not local atoms.

## API Client Plan

The frontend should use a typed client derived from the same `HttpApi` definition where practical.

Short-term:

- Keep `fetch` wrapper but move it to `apiClient.ts`.
- Centralize endpoint paths.
- Decode responses with shared schemas where useful.

Medium-term:

- Use `HttpApiClient.make(ThreadVmApi, { baseUrl })`.
- Provide `FetchHttpClient.layer`.
- Expose client calls through Effect Atom actions.

## Migration Phases

### Phase 1: Stabilize Current App

- Keep current single-package app.
- Add JetBrains Mono globally.
- Move terminal and VM list out of `main.tsx`.
- Extract API client.
- Extract OSC 52 handling.
- Add tests or scripted probes for terminal attach/reconnect/resize.

Exit criteria:

- The current app behaves the same.
- No monorepo churn yet.
- UI is easier to refactor.

### Phase 2: Add Tailwind 4 and shadcn

- Install Tailwind v4.
- Initialize shadcn for the Vite app.
- Add core components: button, badge, separator, scroll-area, resizable, tooltip, dropdown-menu, dialog, sonner.
- Move global styles into Tailwind/shadcn token structure.
- Convert the app shell and toolbar to shadcn components.
- Keep terminal surface unstyled except for token-driven colors and JetBrains Mono.

Exit criteria:

- Existing UI is visually equivalent or slightly cleaner.
- No feature regressions.
- No raw color-heavy component styling.

### Phase 3: Adopt Effect Atom

- Install Effect Atom.
- Move selected VM, inventory, terminal attach state, clipboard notice, and loading states into atoms.
- Keep xterm imperative lifecycle inside `TerminalPane`, but drive attach/status from atoms.
- Add explicit cleanup for streams and terminal sessions.

Exit criteria:

- Components are mostly render functions.
- Async workflows are testable outside the component tree.

### Phase 4: Move to Turborepo

- Convert to pnpm workspace.
- Add `turbo.json`.
- Split into `apps/web`, `apps/server`, and `packages/shared` first.
- Move shadcn components either into `packages/ui` or keep them in `apps/web` until reused by another app.
- Add root scripts for dev/build/typecheck.

Exit criteria:

- `pnpm dev` runs web and server.
- `pnpm build` builds all packages.
- `pnpm typecheck` checks all packages.
- No circular dependencies between app/server/shared packages.

### Phase 5: Improve Product Workflows

- New ThreadVM creation flow.
- Project registry editor.
- Bootstrap/dev command runner.
- Port detection and preview links.
- Reconciliation stream.
- Optional Herdr launch helper, still not required.

## Near-Term Implementation Order

1. Add `PLAN_2.md`.
2. Add JetBrains Mono globally in the current app.
3. Extract `TerminalPane`, `ThreadVmList`, and `InspectorPanel` from `main.tsx`.
4. Add Tailwind 4 and shadcn.
5. Convert current CSS tokens into shadcn/Tailwind tokens.
6. Replace custom buttons/status spans with shadcn `Button` and `Badge`.
7. Add `ResizablePanelGroup` for the three-pane shell.
8. Add Effect Atom for selected VM and inventory.
9. Move terminal attach/reconnect/restart status into atoms.
10. Decide whether to do the Turborepo move immediately or after the first shadcn conversion.

## Open Questions

- Should `packages/ui` exist immediately, or should shadcn components live in `apps/web` until another app needs them?
- Should the server and web app share one process in production, or should `apps/server` serve `apps/web/dist` as an explicit artifact?
- Should terminal streams stay SSE plus POST input, or move to `@effect/rpc` once the rest of the app state is cleaner?
- Should JetBrains Mono be vendored for offline use?
- Should the app use shadcn's default radius and color tokens, or define a tighter ThreadVM token preset?

## Non-Goals For This Phase

- Do not rebuild the backend around a different framework.
- Do not replace Effect Platform with Express.
- Do not make the app a general cloud IDE.
- Do not make Herdr mandatory.
- Do not build a marketing landing page.
- Do not create decorative UI that competes with the terminal.
