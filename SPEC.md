# Spec

## Product

ThreadVM is a local web control plane for exe.dev-backed development workspaces.

Current implementation supports:

- reflecting exe.dev VMs into a browser UI.
- maintaining project registry config.
- creating a ThreadVM from a project.
- provisioning repo, branch, bootstrap commands, dev command, ports, and metadata.
- attaching a browser terminal to a VM over a local server-owned PTY/SSH bridge.
- streaming inventory and provisioning snapshots.
- inspecting metadata, ports, dev logs, and lifecycle actions.

## Workspace Layout

```text
apps/web        Vite React UI
apps/server     Effect Platform HTTP server
apps/cli        CLI launcher entrypoint
packages/shared domain schemas, typed API, services
examples        default project registry YAML
scripts         probes and PTY fallback helper
```

Package manager and build system:

- `pnpm@10.20.0`
- Turborepo
- TypeScript 7
- ESM packages

## Runtime Stack

Frontend:

- Vite 8
- React 19
- Tailwind CSS 4
- shadcn/Radix component source
- lucide-react icons
- Sonner toasts
- Effect `AtomRef` reactivity via `effect/unstable/reactivity`
- xterm.js 6 with `@xterm/addon-fit`
- JetBrains Mono via `@fontsource-variable/jetbrains-mono`

Backend:

- Effect 4 beta
- Effect Platform Node HTTP server
- Effect `HttpApi` for typed JSON APIs
- a schema-validated Effect WebSocket route for terminal IO
- custom SSE routes for reconciliation and provisioning streams
- `node-pty` primary PTY implementation
- Python `scripts/pty_bridge.py` fallback if `node-pty` spawn fails
- raw `ssh exe.dev ...` for exe.dev operations
- raw `ssh <vm-host> bash -lc ...` for VM commands

## Configuration

Project registry:

- default path: `examples/projects.yaml`
- override: `THREADVM_PROJECTS_FILE`
- format: YAML object keyed by project id

Local metadata store:

- default path: `~/.threadvm/store.json`
- override: `THREADVM_STORE_FILE`
- stores recoverable ThreadVM metadata by VM id

Ports:

- API server: `THREADVM_PORT`, default `3333`
- Vite dev server: `THREADVM_WEB_PORT`, default `5173`
- Vite proxies `/api` and `/rpc` to the API server

Mocks and overrides:

- `THREADVM_EXEDEV_MOCK=1` returns a synthetic exe.dev VM.
- `THREADVM_EXEDEV_MOCK_ID`, `THREADVM_EXEDEV_MOCK_NAME`, `THREADVM_EXEDEV_MOCK_HOST` customize the mock VM.
- `THREADVM_SSH_MOCK=1` returns synthetic SSH command output.
- `THREADVM_TERMINAL_COMMAND` overrides the terminal command launched by `TerminalBridge`.
- `THREADVM_TERMINAL_LOCAL_TMUX=1` enables local tmux session detection for terminal probes and local adapters.

## Domain Model

Implemented schema classes live in `packages/shared/src/domain/schema.ts`.

Core objects:

- `Project`
- `ThreadVm`
- `Port`
- `ProvisioningStep`
- `ThreadVmMetadata`
- `TerminalSocketRequest`
- `TerminalClientMessage` input/resize/ping union
- `TerminalServerMessage` ready/output/status/pong/error union
- typed response objects for create, lifecycle, dev log, ports, reconciliation, provisioning, and project registry mutations

ThreadVM states:

```text
discovering
creating
bootstrapping
ready
running
blocked
stopped
failed
destroying
unknown
```

## Server API

Typed `HttpApi` routes:

```text
GET    /api/projects
PUT    /api/projects/:id
DELETE /api/projects/:id

GET    /api/threadvms
GET    /api/threadvms/:id
GET    /api/threadvms/:id/dev-log
GET    /api/threadvms/:id/ports
POST   /api/threadvms
POST   /api/threadvms/:id/stop
DELETE /api/threadvms/:id
```

Streaming routes:

```text
GET    /rpc/threadvms/reconcile
GET    /rpc/threadvms/:id/provisioning
GET    /rpc/terminal/:threadVmId/socket?cols=<cols>&rows=<rows>[&restart=1] (WebSocket)
```

Docs:

```text
GET /docs
GET /docs/openapi.json
```

Production server also serves `apps/web/dist` as an SPA when present.

## Backend Services

`CommandService`

- wraps Node `execFile`
- returns stdout, stderr, and exit code
- enforces timeout and max buffer

`ConfigService`

- reads and writes project registry YAML
- supports list, get, save, and delete
- creates parent directories on write

`ExeDevService`

- shells out to `ssh exe.dev`
- supports list, get, create, clone, tag, untag, comment, stop, remove
- parses `ssh exe.dev ls` output into `ThreadVm`
- falls back to a diagnostic mock VM if list fails

`SshService`

- runs remote scripts through `ssh <host> bash -lc <script>`
- supports mock output for local probes

`LocalStore`

- reads and writes JSON ThreadVM metadata
- supports list, get, upsert, and remove

`WorkspaceService`

- reconciles exe.dev VM state with local and remote metadata
- creates VMs by clone or fresh image
- derives slug, VM name, branch, ports, metadata paths, dev pid path, and dev log path
- writes exe.dev tags and comments
- writes `/workdir/.harness/threadvm.json` inside the VM
- prepares repo and branch
- runs configured bootstrap commands sequentially
- starts configured dev command with `nohup`
- probes configured ports
- records provisioning steps, output excerpts, and failures
- returns create immediately while provisioning continues in a detached Effect fiber
- reads dev log tail, checks port reachability, stops VMs, and removes VMs

`RemoteTerminalSession`

- derives a deterministic, collision-resistant tmux session name from the VM id
- provisions tmux during ThreadVM bootstrap using a supported remote package manager
- checks whether a session exists before attachment
- kills the existing tmux session only for an explicit restart
- creates a detached session before reporting readiness and constructs the structured `ssh -tt` tmux attach command

`TerminalBridge`

- creates one fresh local PTY per browser WebSocket attachment
- replaces the previous local attachment for the same VM without terminating tmux
- starts `ssh -tt <vm.host> 'tmux attach-session ...'` for real VMs
- uses the browser's measured rows and columns as the PTY's initial size
- uses `node-pty` first with `xterm-256color` and truecolor environment hints
- falls back to `python3 scripts/pty_bridge.py` if `node-pty` spawn throws
- exposes scoped output, input, resize, and exit operations
- bounds PTY output buffering and terminates overflowing local attachments
- has no replay buffer, output cursor, or ANSI mouse-mode parser

## Frontend

Entry:

- `apps/web/src/client/main.tsx`
- renders `apps/web/src/app/App.tsx`

Main UI:

- full-height three-pane shell with resizable inventory, terminal, and inspector panels
- mobile/small-screen inspector sheet
- command palette opened with Cmd/Ctrl-K
- toasts for user-visible async results

Inventory:

- lists ThreadVMs
- tracks loading and reconciliation errors
- supports selection persisted in localStorage
- opens New ThreadVM and Project Registry dialogs

New ThreadVM dialog:

- selects project
- accepts summary, branch override, base VM override, image override, starting prompt, pinned flag
- calls `POST /api/threadvms`
- selects the created VM on success

Project registry dialog:

- loads projects from API
- saves and removes project entries
- writes back to YAML through the server

Terminal:

- xterm.js renderer with fit addon
- per-VM terminal session state
- disposable xterm instance and fresh local PTY for every attachment
- one ordered WebSocket for attach, reconnect, restart, input, resize, status, and heartbeat
- deterministic remote tmux session per ThreadVM
- active terminal VM persisted in localStorage for auto-attach
- OSC 52 clipboard handling with browser clipboard fallback notice
- keyboard shortcuts for attach/restart through `keyboardShortcuts.ts`

Inspector:

- overview metadata table
- lifecycle stop/remove actions
- port links and remote port checks
- provisioning stream status
- provisioning steps with output excerpts
- dev log refresh and tail display

Client state:

- uses Effect `AtomRef`
- central state file: `apps/web/src/state/atoms.ts`
- API client: `apps/web/src/state/apiClient.ts`
- localStorage keys:
  - `threadvm.selectedVmId`
  - `threadvm.activeTerminalVmId`

## Provisioning Flow

`POST /api/threadvms`:

1. Load project config.
2. Slugify summary.
3. Choose VM name `<project>-<slug>`.
4. Choose branch from request or project branch prefix plus slug.
5. Clone `baseDevbox` or create `image`.
6. Create metadata with state `creating`.
7. Persist local metadata.
8. Write exe.dev tags/comment best-effort.
9. Update state to `bootstrapping`.
10. Fork detached provisioning.
11. Return `202` with the bootstrapping ThreadVM.

Detached provisioning:

1. provision and verify the remote tmux runtime.
2. prepare repository and branch.
3. write VM metadata.
4. run bootstrap commands.
5. start dev command in background.
6. probe configured ports.
7. mark `ready` or `failed`.
8. persist metadata locally, remotely, and to exe.dev best-effort.

## Terminal Flow

1. Browser fits a clean xterm instance and opens the terminal WebSocket with
   its initial dimensions.
2. Server validates the request and resolves the VM through
   `WorkspaceService`.
3. `RemoteTerminalSession` checks or restarts the deterministic remote tmux
   session.
4. `TerminalBridge` creates a fresh scoped local PTY running `ssh -tt` and
   attaches it to tmux.
5. Server emits `ready` and `attached`, then forwards PTY output.
6. Browser sends input, resize, and ping messages on the same socket.
7. Server processes client messages through one bounded queue in arrival order.
8. Disconnect closes the local SSH PTY but leaves remote tmux running.
9. Reconnect creates a fresh xterm and PTY; tmux redraws the durable screen and
   terminal modes.

## Scripts

Root scripts:

```text
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm start
pnpm probe:terminal
pnpm probe:boundaries
pnpm probe:dev
pnpm probe:web-style
pnpm probe:terminal-ui
```

Probe scripts:

- `scripts/workspace_boundary_probe.ts`
- `scripts/web_style_probe.ts`
- `scripts/dev_probe.mjs`
- `scripts/terminal_probe.mjs`
- `scripts/terminal_ui_probe.ts`

## Known Current Constraints

- Terminal renderer is directly xterm.js; Ghostty Web is not implemented yet.
- Terminal transport is SSE plus POST, not WebSocket or Effect RPC.
- `TerminalBridge` is in `packages/shared` even though it is server-only and depends on `node-pty`.
- Python PTY fallback still exists.
- exe.dev integration is command-output parsing, not an SDK.
- Reconciliation/provisioning streams poll snapshots on intervals.
- Metadata writes to exe.dev and remote VM are partly best-effort during provisioning.
- Local store is a cache/recovery aid, not authoritative source of truth.
