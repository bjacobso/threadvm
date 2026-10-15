# ThreadVM Plan 5: ACP Agents, Swappable Sandboxes

## Goal

A delegated bullet resolves two independent choices: an agent profile and a
sandbox profile. Every thinking agent speaks ACP; every placement implements
Sandbox. The outline consumes normalized runs/events and prompt/answer/cancel.
Shell is the explicit terminal-only exception, using the same Sandbox.

## Ownership Rules

- The Git outline store owns human intent and proposal acceptance.
- AgentRuns owns run identity, context, capability tokens and execution events.
- AgentDriver owns ACP negotiation, sessions, turns, questions and cancellation.
- SandboxProvider owns provision/attach; Sandbox owns processes, files, PTYs,
  ports and code transport. Neither knows about outline views or proposals.
- A scoped byte duplex owns each ACP transport. Interruption sends ACP cancel
  before closing it. Closing an attachment does not destroy the sandbox.
- Credentials stay in host environment/credential stores, never agents.yaml.
- Existing local tmux run workers survive a web-server restart. This useful
  property is retained; a new cross-machine agentd supervisor is v2, not this plan.

## Data Model and Schemas

Persist agentProfile, sandboxRef, ACP session ID, negotiated capabilities and
pending requests on each run. SandboxRef includes provider/id/workdir/branch,
project reference, terminal session and optional SSH host. WorkspaceSpec adds
base ref, repository source and bootstrap commands. References contain no secrets.
Pending requests retain kind/title/options/payload and response capability:
`live` for an owned transport, `message` after a resumable session loses that
transport, `expired` if no response path remains. Never replay an old approval as
permission for a new tool call. A message response is an explicit follow-up turn.

Append-only events remain authoritative. Run records are projections, repaired
on read. Old records without runtime fields remain readable. `session/load` is
attempted only after initialize advertises loadSession, using the persisted
session ID and the same MCP configuration. Failure is recorded, not hidden by
silently creating an unrelated session.

## Services and the Two Seams

`AgentDriver.open({profile, sandbox})` calls sandbox.spawn and feeds its byte
stdio to the unmodified vendored effect-acp client. It registers client fs and
terminal handlers against Sandbox, then initializes and creates/loads a session.
Profile command/args/env select the shim, not a per-vendor adapter.

`SandboxProvider.provision(spec)` and `attach(ref)` return Sandbox. Sandbox
exposes spawn (stdout bytes, stdin sink, stderr and exit), exec, read/write files,
pty descriptor, exposePort, git push/fetch, stop and destroy. Local provisions a
Git worktree and named tmux session. exe.dev uses SshService-compatible SSH
construction and the existing tmux gateway; its ACP stream is ssh -T without a
PTY. Vercel/Cloudflare providers are typed unsupported stubs until authenticated
implementations exist. Unsupported calls fail explicitly.

The repository currently has three incompatible Effect 4 releases. Keep the
stable Effect ACP runtime isolated. Resource operations invoked by the beta
control plane cross a JSON process boundary; no Effect values or Schema ASTs
cross versions. Sandbox implementations and the ACP client live together in
packages/agent. The shared AgentRuns service talks to that runtime through plain
JSON and exposes the existing normalized API to the outline, CLI and terminal.

## Configuration

Commit `.threadvm/agents.yaml` with `agents`, `sandboxes` and `defaults.sandbox`.
An agent has either kind terminal or an ACP command/args plus optional nonsecret
environment settings. Sandbox profiles select provider and placement settings.
`@claude/exe` selects a per-bullet override; `@claude` uses the default sandbox.
Explicit profile names allow multiple accounts without multiple core adapters.
Legacy acp.json remains a migration fallback. New CLI agents always use ACP;
there is no hidden terminal fallback for an unavailable coding agent.

Verified package names on 2026-10-15:

- `@agentclientprotocol/claude-agent-acp` 0.91.0, binary claude-agent-acp;
  the historical claude-code-acp package name is not used.
- `@agentclientprotocol/codex-acp` 2.2.2, binary codex-acp, over Codex app-server.
  The old zed-industries repository is archived and directs new installations
  to this package. CODEX_PATH selects an existing hot Codex binary.

Sources: [Claude shim](https://github.com/agentclientprotocol/claude-agent-acp),
[Codex shim](https://github.com/agentclientprotocol/codex-acp),
[archived adapter migration](https://github.com/zed-industries/codex-acp).
Capabilities are checked at runtime, not inferred from these package names.

## MCP, API and CLI

`threadvm mcp --run <id>` speaks stdio JSON-RPC MCP, exposing outline.read,
outline.propose and run.observe through the same capability-scoped services as
the CLI. Its session/new mcpServers entry includes the executable and scoped
environment. stdout contains protocol only; diagnostics use stderr. Agents can
read/propose/observe their own run, never accept proposals, launch runs or answer
permissions. The existing CLI verbs and HTTP/outline socket stay compatible.

Remote placement needs an outline callback reachable from the sandbox: an
explicit HTTPS endpoint/tunnel, or installed stdio bridge. Do not assume a local
filesystem path works remotely. Provisioning without this configuration fails
rather than running an agent unable to report back. The SSH provider contract and
ACP transport are verified with mocks if no real exe.dev credentials are present.

## UI

Keep the aligned PR #1 client. Mentions resolve profile × sandbox on the server;
thread metadata comes from SandboxRef. Pending requests display their response
capability honestly after recovery. Answers with message capability send a new
turn; expired requests remain visible as history and cannot grant permission.
Terminal-only shell runs use the thread terminal rather than agent prompting.

## Why Not T3 Code's Adapter per Vendor

T3 supports distinct native vendor protocols and places its whole server beside
remote agents. ThreadVM deliberately has one control plane and one ACP client;
CLI shims absorb vendor-specific SDK/app-server differences. Moving a JSON-RPC
byte stream changes placement without changing the agent or outline protocol.
This keeps the two choices independently testable and avoids a vendor × host
matrix of adapters.

ACP is sufficient for the current seam, with explicit limits. session/load
restores conversation, not pending JSON-RPC callbacks; old approvals must degrade
to message/expired. MCP delivery and tool permissions depend on shim behavior,
so live MCP tests are required (historical Claude releases had injection bugs).
Remote disk/process durability is not provided by a byte stream; persistent
sandbox storage and agentd are separate work. API loops must actually use ACP
client fs/terminal capabilities; vendor CLIs using native tools cannot be moved
outside their workspace merely by advertising those capabilities.

## Mapping and Phases

1. Introduce runtime/sandbox/profile schemas and Sandbox providers; extract local
   worktree/tmux ownership from LocalRunSubstrate into LocalSandboxProvider.
2. Rename the remaining normalized coordinator AgentRuns and adapt its callers.
   AgentDriver accepts profile + Sandbox, removing direct child-process ownership.
3. Add YAML profile resolution, mention overrides and scoped MCP. Keep legacy CLI
   write paths and exe.dev inventory intact.
4. Persist session/capability/request projections. Reattach live local workers;
   load dead sessions where supported, otherwise expose explicit degradation.
5. Exercise local and mocked SSH byte transports, both real CLI shims if usable,
   UI acceptance commits, server restart and screenshots.

## Acceptance Criteria

- Typecheck, build, lint, outline/Cloudflare tests and all existing probes pass.
- The same ACP scenario runs on local and mocked exe.dev Sandbox providers.
- Claude and, where authentication permits, Codex ask permission and propose
  through session-injected MCP; UI acceptance makes a thoughts Git commit.
- Shell uses the same local worktree/tmux provider and existing terminal gateway.
- Restart preserves pending requests/suggestions and selects live, message or
  expired response behavior correctly; loadSession false is never ignored.
- Vercel/Cloudflare are explicitly documented typed stubs. No fake live-provider
  claims. No agentd, hosted model loop, billing or secret-vault implementation.
