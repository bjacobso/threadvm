# Web-Based Coding Harness Plan

## Goal

Build a local web-based harness that manages one isolated exe.dev VM per idea, bug, draft, or experiment.

The app should:

- Start a local web UI for creating and managing workspaces.
- List all current `ThreadVMs` by reflecting exe.dev metadata.
- Create one exe.dev VM or clone per workspace.
- Give each VM access to the selected repo, such as `onboarded` or a personal project.
- Bootstrap dependencies, branch state, dev services, and ports.
- Show a terminal attached directly to the remote VM when a `ThreadVM` is clicked.
- Expose all server behavior through Effect services, `HttpApi`, and RPC-style streaming endpoints.

The harness is not primarily a local database of workspaces. Local storage can cache information and store UI preferences, but the source of truth should be exe.dev metadata and what can be observed from the VM through raw `ssh exe.dev ...` and direct SSH commands.

## Product Model

### Core Objects

- `Project`: configured repo plus bootstrap/dev-server/runbook defaults.
- `ThreadVM`: an exe.dev VM representing one coding thread.
- `Workspace`: local UI/view model for a `ThreadVM` plus project annotations.
- `EnvironmentMetadata`: exe.dev tags, VM name, host, state, image/base, created time, repo, branch, ports, and lifecycle.
- `TerminalSession`: local browser terminal connected through the harness server to a remote VM shell.
- `HerdrSession`: optional future session model for users who want managed Herdr panes.
- `Port`: configured or detected service port with label and preview URL.

### Primary Flow

1. User runs `harness web` or `harness dev`.
2. Harness starts a local web server and opens the app.
3. Backend reconciles `ThreadVMs` by querying exe.dev over raw SSH.
4. UI shows a sidebar of all known `ThreadVMs`, grouped by project/status.
5. User clicks a `ThreadVM`.
6. Backend verifies the VM and opens a terminal bridge.
7. Browser renders the VM shell with xterm-style input/output.
8. User can create, attach, preview, stop, destroy, or inspect metadata from the UI.

## Architecture Principles

- Web UI first; CLI is only a launcher and automation surface.
- Effect end to end:
  - services for exe.dev, SSH, config, local cache, terminal bridges, and workspace orchestration.
  - typed errors for all external command failures.
  - scoped resources for SSH processes, WebSocket streams, and terminal sessions.
  - structured logging, retries, timeouts, and interruption.
- `HttpApi` for resource-oriented request/response APIs.
- RPC/streaming for live workflows:
  - terminal IO.
  - provisioning progress.
  - metadata reconciliation events.
  - optional Herdr status updates later.
- exe.dev metadata is authoritative.
- Local state is cache plus annotations, not the system of record.
- Raw SSH is the initial exe.dev adapter. The exe.dev SDK can be added later behind the same Effect service.

## Suggested Repository Layout

```text
harness/
  PLAN.md
  README.md
  package.json
  src/
    app/
      client/
      server/
    domain/
      Project.ts
      ThreadVm.ts
      Workspace.ts
    services/
      ConfigService.ts
      ExeDevService.ts
      LocalStore.ts
      ProjectService.ts
      SshService.ts
      TerminalBridge.ts
      WorkspaceService.ts
    api/
      HttpApi.ts
      Rpc.ts
    cli/
      main.ts
  examples/
    projects.yaml
```

TypeScript remains the right first choice because the desired stack is Effect-based and the app needs shared server/client types.

Use current stable Effect packages for the initial implementation. Effect v4 is active but should be an explicit later migration decision, not an accidental dependency choice.

## Effect Service Boundaries

### `ExeDevService`

Wraps raw exe.dev SSH commands.

Responsibilities:

- `listVms`
- `getVm`
- `createVm`
- `cloneVm`
- `removeVm`
- `stopVm`
- `startVm`
- `setMetadata`
- `getMetadata`
- `runExeCommand`

Initial transport:

```sh
ssh exe.dev ls
ssh exe.dev new <vm> --image <image>
ssh exe.dev cp <base> <vm>
ssh exe.dev rm <vm>
```

The service should parse stdout into typed domain values and classify failures as typed errors.

### `SshService`

Runs commands against an individual VM host.

Responsibilities:

- wait for SSH readiness.
- run setup commands.
- copy small files or write metadata.
- probe ports.
- start long-running remote processes when needed.

### `TerminalBridge`

Connects the browser terminal to the remote VM shell.

Responsibilities:

- open a local WebSocket/SSE/RPC stream for terminal IO.
- spawn and supervise the local SSH bridge process.
- forward browser keystrokes to the remote VM shell.
- forward remote output to the browser terminal.
- handle resize events.
- clean up bridge processes when clients disconnect.

Initial approach:

- Browser uses xterm.js or equivalent.
- Server opens a PTY-backed process such as `ssh <vm-host>`.
- Server streams PTY output over WebSocket/RPC.
- Users can run `herdr`, agents, tests, or dev servers manually from this shell.
- Later add optional managed Herdr sessions and pane layouts behind a separate service.

### `WorkspaceService`

Coordinates project config, exe.dev metadata, remote setup, ports, and local cache.

Responsibilities:

- create `ThreadVM`.
- reconcile exe.dev VM metadata into UI models.
- bootstrap repo and dev services.
- derive preview URLs.
- expose lifecycle actions.

### `LocalStore`

Stores non-authoritative local information:

- UI preferences.
- recently selected workspace.
- project annotations not yet written to exe.dev metadata.
- cached reconciliation snapshots.
- provisioning logs.

Do not treat local rows as proof a VM exists. Every list/detail view should be reconciled with exe.dev.

## API Design

### `HttpApi`

Resource-style APIs:

- `GET /api/projects`
- `GET /api/threadvms`
- `GET /api/threadvms/:id`
- `POST /api/threadvms`
- `POST /api/threadvms/:id/start`
- `POST /api/threadvms/:id/stop`
- `DELETE /api/threadvms/:id`
- `GET /api/threadvms/:id/ports`

The server implementation should be derived from typed Effect `HttpApi` definitions so request params, payloads, success responses, and error responses share one schema.

### RPC and Streaming

Use RPC-style endpoints for operations that are long-running or bidirectional:

- `ThreadVmRpc.createAndBootstrap`
  - streams provisioning events.
- `ThreadVmRpc.reconcile`
  - streams discovered metadata changes.
- `TerminalRpc.attach`
  - bidirectional terminal IO.
- `TerminalRpc.resize`
  - terminal resize events.
- optional `HerdrRpc.watchStatus` later.
  - streams pane/agent status changes.

If the first implementation uses plain WebSockets for terminal IO, keep the boundary shaped like an RPC service so it can later move to `@effect/rpc` without changing domain code.

## Metadata Strategy

exe.dev metadata should identify harness-managed VMs.

Required metadata/tags:

- `harness=true`
- `harness.kind=threadvm`
- `harness.project=<project>`
- `harness.slug=<slug>`
- `harness.summary=<summary>`
- `harness.repo=<repo>`
- `harness.branch=<branch>`
- `harness.createdBy=<local-user>`

Optional metadata:

- `harness.preview.3000=<url>`
- `harness.state=<creating|bootstrapping|ready|running|blocked|stopped|failed>`
- `harness.pinned=true`
- `harness.ttl=<duration-or-timestamp>`

If exe.dev does not support arbitrary metadata in the required shape, encode the minimum into VM names/tags and mirror richer metadata into `/work/.harness/threadvm.json` inside the VM. The local store may cache this file, but reconciliation should be able to recover it from the VM.

## UI Design

### Main Screen

- Left sidebar:
  - projects.
  - all `ThreadVMs`.
  - status chips for creating, ready, running, blocked, stopped, failed.
  - changed-file count when available.
  - exposed ports.
- Main pane:
  - selected `ThreadVM` VM terminal.
  - empty state that creates a new workspace.
- Right inspector:
  - repo, branch, host, base image, age, metadata.
  - preview links.
  - lifecycle actions.
  - recent provisioning logs.

### New Workspace Flow

Fields:

- project.
- idea/summary.
- base devbox or image.
- branch name override.
- starting prompt.
- pin/TTL.

On submit:

- open a provisioning progress stream.
- show each Effect step as it runs.
- attach the VM terminal automatically when ready.

## Configuration Shape

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
      install: manual
      sessionPrefix: harness
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

## Provisioning Algorithm

1. User submits `New Workspace` in the web UI.
2. `WorkspaceService` emits provisioning events over RPC.
3. Resolve project config.
4. Normalize summary into a slug.
5. Generate VM name:
   - `<project>-<slug>`
   - append short ID on collision.
6. Create environment:
   - preferred: `ExeDevService.cloneVm(baseDevbox, vmName)`
   - fallback: `ExeDevService.createVm(vmName, image)`
7. Write initial exe.dev metadata/tags.
8. Wait for direct VM SSH readiness.
9. Clone/fetch repo.
10. Create or switch to branch.
11. Write `/work/.harness/threadvm.json`.
12. Run bootstrap commands.
13. Start dev server command when configured.
14. Probe configured ports.
15. Update exe.dev metadata with ready state and preview URLs.
16. Reconcile local cache from exe.dev/VM metadata.
17. UI auto-attaches to the VM terminal.

## VM Terminal Forwarding

The browser should not SSH directly into remote VMs. The local harness server owns the connection.

Flow:

1. Browser requests `TerminalRpc.attach(threadVmId)`.
2. Server resolves the authoritative VM host from `ExeDevService`.
3. `TerminalBridge` starts a local PTY process:
   - `ssh <vm-host>`
4. Browser receives terminal output stream.
5. Browser sends input and resize events back to the bridge.
6. Server terminates only the local bridge process on disconnect.

Future improvement:

- add optional managed Herdr install/start/layout automation for users who want persistent panes.

## Lifecycle States

- `discovering`
- `creating`
- `bootstrapping`
- `ready`
- `running`
- `blocked`
- `stopped`
- `failed`
- `destroying`

Environment health and agent status should be separate. A VM can be healthy while an agent is blocked.

## Milestones

### 1. Local Web Shell

- Scaffold Effect TypeScript app.
- Add `harness web` launcher.
- Start local server and web UI.
- Define typed `HttpApi` resources.
- Add placeholder sidebar/detail layout.

### 2. exe.dev Reflection

- Implement `ExeDevService` around raw `ssh exe.dev` commands.
- List all harness-managed `ThreadVMs`.
- Reconcile metadata into UI models.
- Add manual refresh and background polling/streaming.

### 3. Create Workspace

- Implement `POST /api/threadvms`.
- Stream provisioning events.
- Clone/create VM.
- Bootstrap repo.
- Write exe.dev and VM metadata.

### 4. VM Terminal in Browser

- Implement `TerminalBridge`.
- Render selected `ThreadVM` VM terminal in the main pane.
- Support input, output, resize, disconnect, and reconnect.

### 5. Ports and Actions

- Detect configured ports.
- Show preview links.
- Implement start, stop, destroy, and pin/TTL actions.

### 6. Review Loop

- Show branch and changed files.
- Add diff view.
- Add PR creation action.
- Add optional Herdr agent/status watch when managed Herdr support exists.

## First Implementation Slice

1. Scaffold `harness web` with an Effect server and a simple client.
2. Define `ThreadVM`, `Project`, and error schemas.
3. Implement `ExeDevService.listVms` via raw `ssh exe.dev ls`.
4. Show reflected `ThreadVMs` in the sidebar.
5. Add a detail route for a selected `ThreadVM`.
6. Implement terminal attach for an existing VM by bridging local WebSocket/RPC to `ssh <vm-host>`.
7. Add `New Workspace` after attach works.

This order proves the riskiest part first: a browser can list exe.dev VMs and attach to a remote VM terminal through the local harness server.

## Open Decisions

- Exact exe.dev metadata/tag commands and limits.
- Stable terminal transport: WebSocket first versus `@effect/rpc` immediately.
- Whether managed Herdr support should be built into ThreadVM or remain user-run inside the shell.
- Whether to use React Router, TanStack Router, or a smaller client router.
- Local cache format: JSON first or SQLite immediately.
- How to authenticate the local web UI if exposed beyond localhost.

## Risks

- exe.dev metadata may not be rich enough; fallback VM-side metadata must be reliable.
- Terminal bridging can leak processes if disconnect handling is weak.
- SSH terminal attach may need different options per host/session.
- Browser terminal latency and resize behavior need real testing.
- Local cache can drift if treated as authoritative.
- Preview URLs must default to private/authenticated access.
- Cleanup must not delete pinned or shared VMs.
