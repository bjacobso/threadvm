# Product and architecture

## Product

ThreadVM is a local web control plane for exe.dev-backed development workspaces.

Current implementation supports:

- reflecting exe.dev VMs into a browser UI.
- navigating project-grouped workspaces through a responsive shadcn sidebar.
- maintaining project registry config.
- discovering and validating a versioned current-directory `harness.yaml`.
- projecting a versioned config into the UI as a read-only project while its
  multi-repository runtime remains guarded.
- creating a ThreadVM from a legacy project-registry entry.
- provisioning its repo, branch, bootstrap commands, dev command, ports, and metadata.
- attaching a browser terminal to a VM over a local server-owned PTY/SSH bridge.
- preserving one deterministic remote tmux terminal session per workspace.
- viewing each workspace's remote `PLAN.md` through a React Markdown tab.
- streaming inventory and provisioning snapshots.
- inspecting metadata, ports, dev logs, and lifecycle actions.
- providing a mise-based example runbook and an interactive base setup script
  for GitHub CLI, Codex, and Claude authentication.

The reusable base lifecycle, multi-repository clone orchestrator, and editable
`PLAN.md` synchronization are specified below but are not yet implemented end
to end.

## Workspace Layout

```text
apps/web        Vite React UI
apps/server     Effect Platform HTTP server
apps/cli        CLI launcher and config validation entrypoint
packages/shared domain schemas, typed API, services
examples        legacy registry and versioned multi-repository examples
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

## Known Current Constraints

- Terminal renderer is directly xterm.js; Ghostty Web is not implemented yet.
- Terminal transport is a schema-validated WebSocket; it is not Effect RPC.
- `TerminalBridge` is in `packages/shared` even though it is server-only and depends on `node-pty`.
- Python PTY fallback still exists.
- exe.dev integration is command-output parsing, not an SDK.
- Reconciliation/provisioning streams poll snapshots on intervals.
- Metadata writes to exe.dev and remote VM are partly best-effort during provisioning.
- Local store is a cache/recovery aid, not authoritative source of truth.
- Versioned config discovery and validation are implemented, but base creation,
  interactive setup orchestration, and multi-repository task cloning are not.
- Credential-bearing bases currently have no UI lifecycle, sharing guard, or
  provider-side revocation workflow.
- The `Terminal | Plan` tabs, remote read API, and Markdown renderer are
  implemented. Plan editing, atomic writes, revision conflict handling, and
  continuous external-change detection are not.
