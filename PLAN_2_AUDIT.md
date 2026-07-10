# PLAN_2 Implementation Audit

Date: 2026-07-09

> Terminal architecture note (2026-07-10): Plan 2's SSE output plus POST
> input/resize bridge was replaced by the durable tmux and WebSocket design in
> `PLAN_3.md`. The Plan 2 evidence below remains a record of that completed
> phase; it is not a description of the current terminal transport.

This audit checks `PLAN_2.md` against the current repository state. It is meant
to keep completion claims concrete: each item below cites the file or command
that proves the implementation.

## Summary

`PLAN_2.md` is implemented for the current phase.

The project is now a pnpm/Turborepo monorepo with:

- a Vite/React web app,
- an Effect Platform local server,
- a CLI entrypoint,
- shared Effect v4 domain/API/service packages,
- shadcn/Tailwind 4 UI primitives and tokens,
- Effect Atom client state,
- typed `HttpApi` resources plus RPC-shaped streaming routes,
- a persistent browser terminal backed by SSH/PTTY,
- project registry, create/provision, lifecycle, ports, logs, and reconciliation
  workflows,
- executable probes for build, typecheck, dev orchestration, terminal behavior,
  workspace boundaries, and semantic web styling.

## Goal And Preserved MVP Pieces

| Requirement | Status | Evidence |
| --- | --- | --- |
| Durable local web app with cleaner frontend architecture | Proved | `apps/web/src/app/App.tsx`, `apps/web/src/features/*`, `apps/web/src/state/*` |
| Small monorepo with shared typed contracts | Proved | `pnpm-workspace.yaml`, `turbo.json`, `apps/*`, `packages/shared/src/api/ThreadVmApi.ts`, `packages/shared/src/domain/schema.ts` |
| Minimal polished shadcn/Tailwind design system | Proved | `apps/web/components.json`, `apps/web/src/components/ui/*`, `apps/web/src/client/styles.css`, `scripts/web_style_probe.ts` |
| Effect Platform local server stays | Proved | `apps/server/src/main.ts` uses `HttpRouter`, `HttpApiBuilder`, `NodeHttpServer` |
| Typed `HttpApi` contract stays | Proved | `packages/shared/src/api/ThreadVmApi.ts`, `packages/shared/src/api/handlers.ts` |
| exe.dev reflection through Effect services stays | Proved | `packages/shared/src/services/ExeDevService.ts`, `packages/shared/src/services/WorkspaceService.ts` |
| Browser terminal backed by SSH/PTTY bridge stays | Superseded by Plan 3 | `TerminalBridge.ts` now creates a fresh scoped PTY per WebSocket; remote tmux owns persistence |
| Persistent per-VM terminal sessions, resize, reconnect, OSC 52 copy | Superseded by Plan 3 | `RemoteTerminalSession.ts`, `terminalSessionActions.ts`, `TerminalPane.tsx`, `scripts/terminal_probe.mjs` |

## Product Direction

| Requirement | Status | Evidence |
| --- | --- | --- |
| Focused operations console, not landing page | Proved | `App.tsx` renders the three-pane application directly; no landing/hero route exists |
| Left rail inventory, center terminal, right inspector | Proved | `App.tsx` uses `ResizablePanelGroup` with `ThreadVmList`, `TerminalPane`, `InspectorPanel` |
| Minimal chrome, no decorative hero/gradients/noise | Proved | `scripts/web_style_probe.ts` blocks raw color-heavy styling; current styles are token-based |
| Dense, keyboard-friendly terminal-adjacent interface | Proved | `ThreadVmCommandPalette.tsx`, `threadVmNavigation.ts`, `keyboardShortcuts.ts`, `TerminalPane.tsx` |

## Stack Decisions

| Requirement | Status | Evidence |
| --- | --- | --- |
| Vite | Proved | `apps/web/vite.config.ts`, `apps/web/package.json` |
| React | Proved | `apps/web/src/client/main.tsx`, `apps/web/package.json` |
| Effect Atom for client state | Proved | `apps/web/src/state/atoms.ts` imports `AtomRef` from `effect/unstable/reactivity` |
| shadcn/ui source components | Proved | `apps/web/components.json`, `apps/web/src/components/ui/*` |
| Tailwind CSS v4 and design tokens | Proved | `apps/web/src/client/styles.css`, `tailwindcss` and `@tailwindcss/vite` in `apps/web/package.json` |
| JetBrains Mono across app and terminal | Proved | `@fontsource-variable/jetbrains-mono` in `apps/web/package.json`; font imports and stacks in `styles.css`; xterm font stack in `xtermTheme.ts` |
| xterm.js remains renderer | Proved | `@xterm/xterm` and `@xterm/addon-fit` in `apps/web/package.json`; `TerminalPane.tsx` |
| Effect Platform backend | Proved | `apps/server/src/main.ts` |
| Effect services for exe.dev, SSH, store, terminal bridge, workspace orchestration | Proved | `packages/shared/src/services/{ExeDevService,SshService,LocalStore,TerminalBridge,WorkspaceService}.ts` |
| `HttpApi` typed resources | Proved | `ThreadVmApi.ts`, `handlers.ts`, `apiClient.ts` |
| RPC or RPC-shaped streaming for terminal/provisioning/reconciliation | Proved | `apps/server/src/terminalRoutes.ts`, `apps/server/src/reconciliationRoutes.ts` under `/rpc/*` |

## State Management

| Requirement | Status | Evidence |
| --- | --- | --- |
| `threadVmsAtom` reflected inventory | Proved | `apps/web/src/state/atoms.ts`; exercised by `scripts/terminal_ui_probe.ts` |
| `selectedThreadVmAtom` current selection | Proved | `atoms.ts`, `threadVmAtoms.ts`, `terminal_ui_probe.ts` |
| `terminalSessionAtomFamily` per-VM state | Proved | `atoms.ts`, `terminalAtoms.ts`, `terminalSessionActions.ts` |
| `terminalUiAtom` transient status/clipboard/focus | Proved | `atoms.ts`, `TerminalPane.tsx`, `App.tsx`, `terminal_ui_probe.ts` |
| `projectConfigAtom` loaded registry | Proved | `atoms.ts`, `ProjectRegistryDialog.tsx`, `NewThreadVmDialog.tsx` |
| `reconciliationAtom` refresh/stream state | Proved | `atoms.ts`, `reconciliationRoutes.ts`, `App.tsx` |
| Fetching/mutation live in atoms/services, not component bodies | Proved | `apiClient.ts`, action objects in `atoms.ts`, Effect services in `packages/shared/src/services` |
| Long-running streams have cleanup | Proved | `reconciliationStreamAtom`, `provisioningStreamAtom`, `TerminalPane` cleanup, `terminalSessionActionAtom.cleanup` |
| Server state comes from Effect services and exe.dev, not local atoms | Proved | `WorkspaceService.ts`, `ExeDevService.ts`; atoms call API client only |

Implementation note: `PLAN_2.md` names `terminalAttachAtomFamily(vmId)`. The current implementation splits that responsibility into `terminalSessionAtomFamily(vmId)` for per-VM state and `terminalSessionActionAtom` for attach/reconnect/restart workflows. This is the same behavior with clearer separation between durable state and imperative xterm view operations.

## Monorepo And Package Manager

| Requirement | Status | Evidence |
| --- | --- | --- |
| pnpm workspace | Proved | `pnpm-workspace.yaml`, `pnpm-lock.yaml`, no `package-lock.json` |
| Root package manager metadata | Proved | root `package.json` has `packageManager: "pnpm@10.20.0"` |
| Turborepo | Proved | `turbo.json`, root scripts use `turbo` |
| Split into web/server/shared first | Proved | `apps/web`, `apps/server`, `packages/shared` |
| CLI/future surface | Proved | `apps/cli`, `apps/cli/package.json`, `apps/cli/src/main.ts` |
| Root scripts for dev/build/typecheck/lint/start | Proved | root `package.json` |
| `pnpm dev` runs web and server | Proved | `scripts/dev_probe.mjs`, `pnpm probe:dev` |
| `pnpm build` builds all packages | Proved | `turbo.json`; verified by `pnpm probe:terminal` |
| `pnpm typecheck` checks all packages | Proved | root script; verified by `pnpm typecheck` |
| No circular/cross-boundary package dependencies | Proved | `scripts/workspace_boundary_probe.ts`, `pnpm probe:boundaries` |

## shadcn, Tailwind 4, Tokens, Typography

| Requirement | Status | Evidence |
| --- | --- | --- |
| shadcn initialized in Vite app, not repo root | Proved | `apps/web/components.json` |
| Components source-owned in `apps/web/src/components/ui` | Proved | `apps/web/src/components/ui/*` |
| Preferred core components present | Proved | `button`, `badge`, `separator`, `scroll-area`, `resizable`, `tooltip`, `dropdown-menu`, `command`, `dialog`, `sheet`, `tabs`, `table`, `skeleton`, `sonner`, `alert`, `field`, `input`, `textarea`, `select`, `switch` files exist |
| Semantic tokens only/no raw color-heavy component styling | Proved | `styles.css`; `scripts/web_style_probe.ts`; `pnpm probe:web-style` |
| Terminal/control-plane theme | Proved | `styles.css` tokens: `--terminal-*`, `--status-*`, `--sidebar-*` |
| JetBrains Mono package-provided/offline build assets | Proved | `@fontsource-variable/jetbrains-mono`; Vite build emits JetBrains Mono font assets |
| Base font and xterm font stack | Proved | `styles.css`, `xtermTheme.ts` |

## UI Architecture

| Requirement | Status | Evidence |
| --- | --- | --- |
| `ResizablePanelGroup` app shell | Proved | `App.tsx` |
| `ScrollArea` inventory/inspector | Proved | `ThreadVmList.tsx`, `InspectorPanel.tsx` |
| `Separator` between toolbar and terminal | Proved | `TerminalPane.tsx` |
| `Button`, `Badge`, `Tooltip`, `DropdownMenu`, `Command` usage | Proved | feature components under `apps/web/src/features` |
| Minimal full-height pane layout, not nested cards | Proved | `App.tsx`, `ThreadVmList.tsx`, `TerminalPane.tsx`, `InspectorPanel.tsx` |
| Compact mobile/narrow inspector access | Proved | `Sheet` in `App.tsx` |

## Feature Modules

| Feature | Status | Evidence |
| --- | --- | --- |
| ThreadVM list files from plan | Proved | `ThreadVmList.tsx`, `ThreadVmRow.tsx`, `ThreadVmStateBadge.tsx`, `threadVmAtoms.ts` |
| ThreadVM refresh from API | Proved | `refreshThreadVmsAtom` in `atoms.ts`, `ThreadVmList.tsx` |
| Persisted selected VM | Proved | `selectedThreadVmIdAtom`, `setSelectedThreadVmId`, `storage.ts`, `terminal_ui_probe.ts` |
| Status/source/branch/port hints | Proved | `ThreadVmRow.tsx`, `ThreadVmStateBadge.tsx`, `threadVmActions.ts` |
| Keyboard navigation | Proved | `threadVmNavigation.ts`, `ThreadVmList.tsx`, `terminal_ui_probe.ts` |
| Terminal feature files from plan | Proved | `TerminalPane.tsx`, `TerminalToolbar.tsx`, `terminalAtoms.ts`, `osc52.ts`, `xtermTheme.ts` |
| Terminal copy fallback through sonner/toolbar | Proved | `TerminalPane.tsx`, `TerminalToolbar.tsx` |
| Session age and reused/new badge | Proved | `TerminalToolbar.tsx` |
| Reconnect/restart keyboard shortcuts | Proved | `keyboardShortcuts.ts`, `TerminalPane.tsx`, `terminal_ui_probe.ts` |
| Inspector feature files from plan | Proved | `InspectorPanel.tsx`, `MetadataTable.tsx`, `PortLinks.tsx`, `LifecycleActions.tsx` |
| Inspector metadata/table styling, badges, actions, destructive confirmation | Proved | `MetadataTable.tsx`, `InspectorPanel.tsx`, `LifecycleActions.tsx` |

## API Client Plan

| Requirement | Status | Evidence |
| --- | --- | --- |
| Centralized frontend API client | Proved | `apps/web/src/state/apiClient.ts` |
| Shared schemas used for streaming decode | Proved | `apiClient.ts` decodes reconciliation/provisioning events with shared schemas |
| `HttpApiClient.make(ThreadVmApi, { baseUrl })` | Proved | `apiClient.ts` |
| `FetchHttpClient.layer` | Proved | `apiClient.ts` |
| Client calls exposed through atom actions | Proved | `atoms.ts` actions call `threadVmApi`; components dispatch atom actions |

## Migration Phases

| Phase | Exit Criteria | Status | Evidence |
| --- | --- | --- | --- |
| Phase 1 | App stabilized, features extracted, probes for terminal attach/reconnect/resize | Proved | `features/*`, `apiClient.ts`, `osc52.ts`, `scripts/terminal_probe.mjs`, `scripts/terminal_ui_probe.ts` |
| Phase 2 | Tailwind 4/shadcn, equivalent UI, no raw color-heavy styling | Proved | `components/ui/*`, `styles.css`, `pnpm probe:web-style`, `pnpm probe:terminal` |
| Phase 3 | Effect Atom state, xterm imperative lifecycle retained, cleanup | Proved | `atoms.ts`, `TerminalPane.tsx`, `terminalSessionActions.ts`, `terminal_ui_probe.ts` |
| Phase 4 | pnpm/Turborepo split, dev/build/typecheck, no circular deps | Proved | `pnpm-workspace.yaml`, `turbo.json`, `probe:dev`, `probe:terminal`, `probe:boundaries`, `typecheck` |
| Phase 5 | Product workflows | Proved | `NewThreadVmDialog.tsx`, `ProjectRegistryDialog.tsx`, `WorkspaceService.ts`, `PortLinks.tsx`, `InspectorPanel.tsx`, `reconciliationRoutes.ts`; Herdr remains optional/deferred |

## Near-Term Implementation Order

All ten near-term items in `PLAN_2.md` are complete:

1. `PLAN_2.md` exists.
2. JetBrains Mono is global and terminal-applied.
3. `TerminalPane`, `ThreadVmList`, and `InspectorPanel` are extracted.
4. Tailwind 4 and shadcn are installed.
5. CSS tokens are Tailwind/shadcn based.
6. Buttons/status spans use shadcn `Button`/`Badge`.
7. Three-pane shell uses `ResizablePanelGroup`.
8. Selected VM and inventory use Effect Atom.
9. Terminal attach/reconnect/restart state is atom-driven.
10. Turborepo move has been done.

## Open Questions Resolved For This Phase

| Question | Current decision |
| --- | --- |
| `packages/ui` now or later? | Later. shadcn components live in `apps/web/src/components/ui` until another app needs them, matching the plan's allowed path. |
| One process in production? | `apps/server` serves `apps/web/dist` plus API routes, proven by `scripts/terminal_probe.mjs`. |
| SSE plus POST input or `@effect/rpc`? | Historical Plan 2 decision. Plan 3 replaced terminal SSE/POST with one schema-validated Effect WebSocket while provisioning/reconciliation remain SSE. |
| Vendor JetBrains Mono? | Use the package-provided `@fontsource-variable/jetbrains-mono`; Vite bundles font assets for offline production use. |
| Default shadcn radius/tokens or tighter preset? | Use a tighter ThreadVM token preset in `styles.css` with `--terminal-*`, `--status-*`, and sidebar tokens. |

## Verification Commands

Latest required checks:

```sh
pnpm probe:dev
pnpm typecheck
pnpm probe:terminal
```

`pnpm probe:terminal` includes:

- `pnpm build`
- `pnpm probe:boundaries`
- `pnpm probe:web-style`
- `node scripts/terminal_probe.mjs`
- `pnpm probe:terminal-ui`

## Residual Non-Blocking Work

These are not required to satisfy `PLAN_2.md`, but are reasonable follow-ups:

- Code-split the web bundle if the Vite large chunk warning becomes important.
- Promote `apps/web/src/components/ui` into `packages/ui` if another app starts reusing the UI library.
- Replace the RPC-shaped SSE/POST terminal routes with `@effect/rpc` only if it improves the contract without hurting terminal ergonomics.
- Add an optional Herdr launcher when the terminal-first workflow has settled.
