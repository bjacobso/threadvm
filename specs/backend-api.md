# Backend and API

## Domain Model

Implemented schema classes live in `packages/shared/src/domain/schema.ts`.

Core objects:

- `HarnessConfig` and its project, workspace, base, repository, and task schemas
- `Project`
- `ThreadVm`
- `Port`
- `ProvisioningStep`
- `ThreadVmMetadata`
- `TerminalSocketRequest`
- `TerminalClientMessage` input/resize/ping union
- `TerminalServerMessage` ready/output/status/pong/error union
- typed response objects for create, lifecycle, dev log, plan, ports, reconciliation, provisioning, and project registry mutations

`Project.configKind` distinguishes legacy registry entries from the read-only
versioned-config projection. The future base runtime should use the
`HarnessConfig` model directly rather than extending the compatibility
projection.

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
GET    /api/threadvms/:id/plan
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

- discovers and validates versioned consumer config from the invocation directory
- reloads the selected `harness.yaml` for project reads
- exposes versioned config as a read-only compatibility project
- retains read/write support for the legacy project registry YAML
- supports legacy list, get, save, and delete and creates parent directories on write

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
- refuses to route `configKind: harness` projects through the legacy
  single-repository creation flow

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

## Provisioning Flow

The following is the implemented legacy single-repository flow. It remains
available for entries from `examples/single-project/projects.yaml`.

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
