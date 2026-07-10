# ThreadVM

ThreadVM is a local web app for spinning up one isolated development VM per coding thread.

Use it when an idea, bug, RFC, or experiment deserves its own clean environment, running dev server, and agent terminal. ThreadVM uses exe.dev for the actual VMs, a browser-attached SSH terminal for direct access, and Effect for the local control plane. Herdr can still be started manually inside a VM when you want persistent panes or agent sessions.

Status: early MVP scaffold. The local Effect Platform server, typed `HttpApi`, exe.dev reflection, Vite/React UI, shadcn/Tailwind app shell, Effect Atom client state, and browser terminal bridge are implemented. Workspace creation currently requests the VM create/clone operation; full repo bootstrap and dev-server automation are next.

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

The Vite client runs at:

```text
http://127.0.0.1:5173
```

The Effect Platform API server runs at:

```text
http://127.0.0.1:3333
```

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
curl http://127.0.0.1:3333/api/threadvms
curl http://127.0.0.1:3333/docs/openapi.json
```

## Architecture

ThreadVM is web-first. The CLI exists to launch the local web server and provide automation hooks.

```text
Browser UI
  |
  | HttpApi + RPC/streaming
  v
Local ThreadVM server
  |
  | Effect services
  v
exe.dev + SSH + remote VM shell
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
- `SshService`: runs commands on a specific VM host.
- `TerminalBridge`: forwards browser terminal IO to the remote VM shell.
- `HerdrService`: deferred optional integration for users who want managed Herdr sessions later.
- `WorkspaceService`: coordinates creation, bootstrap, metadata, ports, and lifecycle actions.
- `LocalStore`: stores cache, UI preferences, provisioning logs, and annotations.

The public server API should be typed through Effect `HttpApi` for request/response resources and RPC-style streaming for terminal IO and long-running workflows.

## Terminal Bridge

The browser does not SSH directly into a VM. The local server owns the connection.

Initial flow:

1. Browser requests terminal attach for a `ThreadVM`.
2. Server resolves the VM from exe.dev metadata.
3. Server starts a local PTY-backed bridge, such as:

   ```sh
   ssh <vm-host>
   ```

4. Server streams terminal output to the browser.
5. Browser sends input and resize events back to the server.
6. Disconnecting the browser closes only the local bridge.

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
ThreadVmRpc.createAndBootstrap
ThreadVmRpc.reconcile
TerminalRpc.attach
TerminalRpc.resize
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
- Typed `HttpApi` for projects, ThreadVMs, and terminal attach.
- Generated OpenAPI JSON at `/docs/openapi.json`.
- exe.dev VM reflection through raw `ssh exe.dev ls`.
- Vite/React/xterm web UI with ThreadVM sidebar, inspector, quick switcher, and attach button.
- shadcn/Tailwind 4 UI tokens with JetBrains Mono across app chrome and terminal.
- Effect Atom client state for inventory, project config, reconciliation, selection, terminal status, and clipboard notices.
- Terminal bridge with native `node-pty` first and child-process `ssh -tt` fallback.
- Example project config in `examples/projects.yaml`.

Next:

- Write exe.dev metadata/tags for created ThreadVMs.
- Recover richer metadata from `/work/.harness/threadvm.json`.
- Bootstrap repo, branch, dependencies, dev server, and ports after VM create/clone.
- Add provisioning progress streams and a proper New ThreadVM form.
- Add optional Herdr install/start/layout automation after the plain VM terminal path is solid.

See [PLAN.md](./PLAN.md) for the broader product and architecture plan.

## License

License TBD.
