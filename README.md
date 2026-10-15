# ThreadVM

ThreadVM is a filesystem-native, Git-versioned outline meta-harness. Humans
author intent, agents execute and propose, and the outline is where both meet.
Every bullet has a stable ID. Delegate a node to give it an isolated code
worktree, a local tmux executor, observations and an attachable browser terminal.

The first outline slice is implemented alongside the existing exe.dev workspace
control plane. The outliner is the default pane; **VM inventory** opens the
existing VM provisioning, inspector and remote terminal interface.

## Local Outline Workflow

Install dependencies and build once with `pnpm install && pnpm build`. Run the
built CLI directly (or use the `threadvm` binary from `@threadvm/cli`):

```sh
node /path/to/threadvm/apps/cli/dist/main.js init /path/to/project
node /path/to/threadvm/apps/cli/dist/main.js open /path/to/project
```

The project must be a Git repository. Make an initial code commit before starting
a run. Local execution needs Git, tmux and a shell; `--agent codex` or
`--agent claude` additionally needs that executor installed on PATH. `open`
starts the server on port 3333 and requests the default browser. On a headless
machine, open the printed URL yourself.

```sh
threadvm init [dir]
threadvm open [dir]
threadvm web                         # existing server launcher, outline + VM tab
threadvm outline show               # snapshot, proposals, runs and events as JSON
threadvm outline show --markdown     # read-only projection with stable ID anchors
threadvm outline apply batch.json   # human edit; also accepts stdin with -
threadvm propose batch.json         # agent proposal, pending human review
threadvm proposal accept <id> [nodeId ...]
threadvm proposal reject <id> [nodeId ...]
threadvm run <nodeId> --agent shell  # also codex or claude
threadvm observe <runId> 'progress'
threadvm observe <runId> <sha> --kind commit
threadvm remote add origin <thoughts-repo-url>
threadvm push [remote] [branch]
```

Use `--dir /path/to/project` on non-launch commands, or set
`THREADVM_PROJECT_DIR`. New runs default to `shell`; the UI lets you choose an
executor before explicitly approving launch. Enter adds a sibling; Tab and
Shift-Tab indent/outdent; Alt-Up/Down reorder; `/run` + Enter opens delegation.
Node buttons provide the same actions. Proposal cards appear where changes would
live, with node and batch accept/reject controls.

Example human batch or agent proposal (use the current `snapshot.revision` from
`outline show`):

```json
{
  "baseRevision": 0,
  "operations": [
    {
      "type": "insert",
      "parent": null,
      "node": { "id": "auth", "text": "Implement authorization", "done": false }
    }
  ]
}
```

Operations are `insert` (node, parent, optional after), `update` (id, patch),
`move` (id, parent, optional after), and `delete` (id, including descendants).
`parent: null` means root; `after: null` means first sibling; omitted `after`
means last sibling. Node patches contain text and/or done. Different node edits
rebase across revisions. A stale edit to the same node, a deleted reference or
a cycle fails atomically. Accept dependent proposed parents before their children,
or accept the complete batch.

`.threadvm/` is its own nested Git repository, excluded from the outer repository.
`snapshot.json`, `ops.jsonl`, `outline.md`, proposals and run summaries form thought
history. Each human/accepted batch is one commit; proposal submission/rejection
and delegation summaries also have their own commits. `events.jsonl` is a local,
append-only execution log. Runtime capabilities, worktrees and transcripts are
ignored. Code stays in the project's Git history on `threadvm/<node>-<run>`
branches. Finished run summaries link to the final code HEAD. `push` defaults to
`origin main` in the thoughts repository.

Runs receive their ancestor path, subtree and CLI instructions. A run-scoped
`threadvm` wrapper is on PATH, with `THREADVM_RUN_ID`,
`THREADVM_RUN_CAPABILITY` and `THREADVM_CONTEXT_FILE` set. The CLI allows that
context to read/propose and observe its own run; human mutation/review, remotes
and additional delegation are denied. This is an API ownership contract in a
trusted local environment, not an OS sandbox. MCP and Markdown round-trip editing
are deferred; the CLI is the complete agent write path for this slice.

The UI polls filesystem-backed state, so CLI writes appear without a separate
daemon. Browser/server restarts recover outline, pending reviews, events and live
tmux sessions. Closing a terminal leaves the run alive. Worktrees and branches
remain available for manual review and cleanup after execution.

```sh
pnpm probe:outline       # real temp Git repo, CLI, worktree/tmux, recovery, remotes
pnpm probe:outline-ui    # real headless Chrome, UI edits/review/terminal/restarts
```

The Chrome probe writes `.context/plan4-inline-proposal.png` and
`.context/plan4-running-node.png`. See [PLAN_4.md](./PLAN_4.md) for the design.

## exe.dev Workspace Workflow

The existing remote workspace flow remains available from the VM inventory tab.

## Outline prototype

[`apps/outline`](apps/outline) is a separate experience prototype: an outliner
where bullets that mention `@claude`, `@cursor`, `@codex`, or `@conductor`
become agent threads that ask questions and propose changes as suggestions. It
is built with Foldkit, Foldworks, and Effect, and deploys to Cloudflare with
Alchemy. See its README.

## What It Does

ThreadVM runs a local web UI that reflects your exe.dev environments.

From the browser you should be able to:

- See every harness-managed exe.dev VM, grouped by project and status.
- Create a new coding thread from a repo and idea summary.
- Clone a pre-warmed exe.dev base devbox or create a fresh VM.
- Bootstrap the repo, branch, dependencies, dev server, and ports.
- Click a `ThreadVM` and use a terminal attached directly to the remote VM.
- Start Herdr manually inside that terminal if you want Herdr for the thread.
- Open preview URLs, inspect metadata, stop VMs, destroy VMs, and eventually review diffs.

The local app is not meant to be the source of truth. It can cache UI state and logs, but the real inventory should come from exe.dev metadata and VM-local metadata that can be recovered over SSH.

## Why

Agent workflows get messy when every branch, bug, and experiment shares the same laptop checkout. ThreadVM gives each thread its own machine:

- isolated from other work.
- persistent across reconnects.
- disposable when the thread is done.
- reachable over SSH and HTTPS.
- visible through one local web UI.
- attachable through a browser-based SSH terminal.

It is a web-based meta-layer over:

- exe.dev: persistent Linux VMs, SSH, HTTPS, devbox clones, GitHub/secrets integrations.
- Herdr: optional terminal multiplexing, panes, tabs, and persistent agent sessions inside a VM.
- Effect: typed services, resource safety, streaming, `HttpApi`, and RPC boundaries.

## Desired Workflow

```sh
threadvm web
```

The command starts a local server and opens the web UI.

In the UI:

1. Click `New ThreadVM`.
2. Choose a project, such as `onboarded`.
3. Enter an idea, bug, or draft summary.
4. ThreadVM creates or clones an exe.dev VM.
5. The server bootstraps the repo and opens a VM terminal.
6. The browser auto-attaches to the remote VM shell.

Clicking an existing `ThreadVM` should attach to the VM shell without rebuilding the environment.

## Running Locally

Install dependencies:

```sh
pnpm install
```

Run the web app and local API server:

```sh
pnpm dev
```

For terminal work where the backend must remain fixed while Vite hot reloads
the React UI, run:

```sh
pnpm dev:stable
```

The Vite client runs at:

```text
http://127.0.0.1:5173
```

The Effect Platform API server runs at:

```text
http://127.0.0.1:3333
```

For temporary ports, set `THREADVM_WEB_PORT` and `THREADVM_PORT` before running
`pnpm dev`. The Vite proxy follows `THREADVM_PORT`, so the browser keeps using
same-origin `/api` and `/rpc` requests.

Build and run the production bundle:

```sh
pnpm build
pnpm start
```

The production server serves the built UI and API from:

```text
http://127.0.0.1:3333
```

Useful checks:

```sh
pnpm typecheck
pnpm probe:boundaries
pnpm probe:dev
pnpm probe:web-style
pnpm probe:terminal
curl http://127.0.0.1:3333/api/threadvms
curl http://127.0.0.1:3333/docs/openapi.json
```

## Architecture

ThreadVM is web-first. The CLI exists to launch the local web server and provide automation hooks.

```text
Browser UI
  | HttpApi resources
  | one terminal WebSocket
  v
Local ThreadVM server
  | Effect services + fresh scoped SSH PTY
  v
exe.dev ThreadVM
  | persistent named tmux session
  v
remote shell / vim / agents / Herdr
```

The codebase is a small pnpm/Turborepo workspace:

```text
apps/web        Vite + React + shadcn/Tailwind UI
apps/server     local Effect Platform server
apps/cli        CLI entrypoint for launching the server
packages/shared typed API, domain schemas, and Effect services
```

The backend is organized around Effect services:

- `ExeDevService`: wraps raw `ssh exe.dev ...` commands and reflects VM metadata.
- `SshService`: runs non-interactive commands inside a specific VM.
- `RemoteTerminalSession`: provisions tmux and owns deterministic remote session naming and attach/restart commands.
- `TerminalBridge`: owns one scoped local PTY for each browser WebSocket attachment, attaching to remote or local tmux.
- `ThoughtsRepo`, `OutlineStore`: serialize outline operations and proposal review in the nested thoughts Git repository.
- `RunEventLog`, `LocalRunSubstrate`: retain execution events and manage local worktree/tmux runs.
- `HerdrService`: deferred optional integration for users who want managed Herdr sessions later.
- `WorkspaceService`: coordinates creation, bootstrap, metadata, ports, and lifecycle actions.
- `LocalStore`: stores cache, UI preferences, provisioning logs, and annotations.

The public server API uses Effect `HttpApi` for request/response resources,
shared Effect schemas over WebSocket for terminal IO, and SSE for
reconciliation and provisioning workflows.

## Durable Terminal

The browser does not SSH directly into a VM. The local server owns the connection.

Connection flow:

1. Browser creates a clean xterm instance and opens one WebSocket containing
   its initial rows and columns.
2. Server resolves the VM from exe.dev metadata and verifies the remote tmux
   runtime.
3. Server starts a fresh local PTY-backed SSH client which runs:

   ```sh
   ssh -tt <vm-host> 'tmux attach-session -t <threadvm-session>'
   ```

4. Output, input, resize, status, and heartbeat messages share that ordered
   WebSocket lifecycle.
5. Disconnecting disposes the browser xterm and local SSH PTY but leaves the
   remote tmux session running.
6. Reconnect creates a fresh PTY and xterm; tmux redraws its complete current
   screen and renegotiates terminal modes.

ThreadVM does not replay historical raw PTY bytes or reconstruct mouse modes.
The remote tmux session owns durable terminal state, the WebSocket owns
transport, and xterm owns only the current browser rendering.

From that shell, the user can run `herdr`, `codex`, `claude`, a dev server, or any other VM-local tool. Later, ThreadVM can add optional managed Herdr sessions and pane layout automation.

## Metadata

ThreadVM-managed VMs should be discoverable from exe.dev metadata or tags.

Minimum metadata:

```text
harness=true
harness.kind=threadvm
harness.project=<project>
harness.slug=<slug>
harness.summary=<summary>
harness.repo=<repo>
harness.branch=<branch>
harness.createdBy=<local-user>
```

If exe.dev metadata is not rich enough for every field, ThreadVM should mirror richer metadata into:

```text
/work/.harness/threadvm.json
```

Local cache can speed up the UI, but list/detail views should reconcile against exe.dev and VM metadata.

## Example Project Config

```yaml
projects:
  onboarded:
    repo: https://repo.int.exe.xyz/org/onboarded.git
    defaultBranch: main
    baseDevbox: onboarded-base
    image: exeuntu
    workdir: /work/onboarded
    branchPrefix: ben/
    bootstrap:
      - mise install
      - pnpm install
      - pnpm db:prepare
    dev:
      command: pnpm dev
      cwd: apps/web
      ports: [3000]
    herdr:
      install: auto
      sessionPrefix: threadvm
    agents:
      default: codex
      panes:
        - label: agent
          command: codex
        - label: server
          command: pnpm dev
          cwd: apps/web
        - label: tests
          command: pnpm test --watch
```

## Planned API Shape

Resource APIs:

```text
GET    /api/projects
PUT    /api/projects/:id
DELETE /api/projects/:id
GET    /api/threadvms
GET    /api/threadvms/:id
POST   /api/threadvms
POST   /api/threadvms/:id/start
POST   /api/threadvms/:id/stop
DELETE /api/threadvms/:id
GET    /api/threadvms/:id/ports
```

Streaming/RPC workflows:

```text
GET /rpc/threadvms/reconcile
ThreadVmRpc.createAndBootstrap
ThreadVmRpc.reconcile
GET /rpc/terminal/:threadVmId/socket?cols=<cols>&rows=<rows>
GET /rpc/threadvms/:id/provisioning
```

## MVP Order

1. Scaffold the Effect TypeScript app.
2. Add `threadvm web`.
3. Implement `ExeDevService.listVms` with raw `ssh exe.dev ls`.
4. Render reflected `ThreadVMs` in the sidebar.
5. Add a detail view for a selected VM.
6. Bridge the browser terminal to `ssh <vm-host>`.
7. Add `New ThreadVM` creation after attach works.

This proves the core risk first: a browser can list exe.dev VMs and attach to a remote VM terminal through the local ThreadVM server.

## Development Status

Implemented:

- Effect Platform server using `HttpLayerRouter`.
- Typed `HttpApi` for projects and ThreadVM resources, plus a schema-validated Effect WebSocket terminal protocol.
- Generated OpenAPI JSON at `/docs/openapi.json`.
- exe.dev VM reflection through raw `ssh exe.dev ls`.
- Vite/React/xterm web UI with ThreadVM sidebar, inspector, quick switcher, and attach button.
- shadcn/Tailwind 4 UI tokens with JetBrains Mono across app chrome and terminal.
- Effect Atom client state for inventory, project config, reconciliation, selected ThreadVM, per-VM terminal status, and clipboard notices.
- SSE reconciliation stream for live ThreadVM inventory snapshots.
- New ThreadVM form backed by `POST /api/threadvms`.
- Project registry editor backed by `PUT /api/projects/:id` and `DELETE /api/projects/:id`.
- Local metadata cache for created ThreadVMs, including project, branch, summary, starting prompt, pinned state, repo, and preview-port hints.
- exe.dev tags and comments for ThreadVM-managed VMs, with rich metadata mirrored into VM-side JSON.
- Background SSH provisioning after create/clone: repo clone/fetch, branch checkout, configured bootstrap commands, VM-side metadata write, dev command startup, configured port probing before `ready`, durable step-level progress, and command output excerpts.
- Typed `GET /api/threadvms/:id/ports` port checks with inspector status badges beside preview links.
- Per-VM row action menu for copying hosts, opening previews, and checking ports.
- Tabbed shadcn inspector panes for overview metadata, port checks, and provisioning/dev logs, with a sheet-backed compact inspector path for narrow viewports.
- VM-side metadata recovery from configured project workdirs, with recovered metadata written back into the local cache.
- Per-VM provisioning SSE stream at `/rpc/threadvms/:id/provisioning`.
- Stop/remove lifecycle endpoints and inspector actions backed by exe.dev.
- Durable per-ThreadVM tmux sessions with a fresh scoped SSH PTY and one ordered WebSocket per browser attachment.
- Bounded inbound and outbound terminal queues, typed protocol errors, origin checks, heartbeat messages, and deterministic cleanup.
- Workspace boundary probe preventing circular app/server/shared imports: `pnpm probe:boundaries`.
- Web style probe preventing raw color utility drift outside shadcn/Tailwind tokens: `pnpm probe:web-style`.
- Scripted terminal probe for attach, ordered input/resize, repeated tmux reconnect reuse, mouse-mode renegotiation, restart, and cleanup: `pnpm probe:terminal`.
- Example project config in `examples/projects.yaml`.

Next:

- Add optional Herdr install/start/layout automation after the plain VM terminal path is solid.

See [PLAN.md](./PLAN.md) for the broader product plan and
[PLAN_3.md](./PLAN_3.md) for the durable terminal architecture.

## License

License TBD.
