# Agent runtime

The outline delegates intent to an agent profile and a sandbox profile. Coding
agents use ACP through the vendored effect-acp client; a plain shell only uses the
sandbox terminal. The same Foldkit client serves local and Cloudflare demo modes.

Install the current adapters alongside authenticated CLIs:

```sh
npm install -g @agentclientprotocol/claude-agent-acp@0.91.0
npm install -g @agentclientprotocol/codex-acp@2.2.2
threadvm init /path/to/project
threadvm open /path/to/project
```

The adapters use their existing local authentication. Installation alone does not
log an agent in. This workspace verified Claude live. Codex's adapter initializes,
but session/new reports Authentication required with both its bundled Codex and
the installed hot CLI selected using CODEX_PATH: `codex login status` says Not
logged in and no CODEX_API_KEY/OPENAI_API_KEY is present.

`threadvm init` commits `.threadvm/agents.yaml` in the thoughts repository. For
example:

```yaml
agents:
  claude:
    acp: {command: claude-agent-acp}
  codex:
    acp: {command: codex-acp}
  claude-review:
    acp: {command: claude-agent-acp, args: []}
  conductor:
    acp: {command: claude-agent-acp}
  shell: {kind: terminal}
sandboxes:
  local: {provider: local}
  exe:
    provider: exe
    baseDevbox: my-agent-base
    repository: git@github.com:owner/project.git
    callbackUrl: https://my-threadvm-control-plane.example
    workdir: /home/exedev/threadvm
    bootstrap: ["command -v tmux", "command -v claude-agent-acp"]
  vercel: {provider: vercel}
  cloudflare: {provider: cloudflare}
defaults: {sandbox: local}
```

Mention `@claude`, `@claude-review`, or `@claude/exe` in a bullet, then leave it.
Use the countdown's send-now chip or keep it as a note. The sandbox suffix is a
per-bullet override. Custom profiles can be typed directly; the toolbar and
completion menu retain the familiar built-in profiles. Conductor uses Claude to
propose delegated sub-bullets; accepting them permits fan-out, at most two levels.
Cursor is displayed but unavailable unless explicitly configured as an ACP profile.
Never commit credentials in agents.yaml. Local agents inherit host credentials;
remote machines need their own authenticated agent installation and Git access.
`acp.json` and `acp-<profile>.json` continue to override a shim during migration.

```sh
threadvm run node-id --agent claude --sandbox local
threadvm run node-id --agent claude --persistent
threadvm outline show
threadvm propose batch.json
threadvm observe run-id 'progress'
threadvm permission run-id request-id option-id
threadvm cancel run-id
```

Startup errors retain their cause in thread Activity.
CLI runs finish after one turn by default; --persistent keeps the ACP session hot
for subsequent turns. UI runs are persistent. All coding profiles use ACP. The
old direct Codex/Claude terminal executor is removed; @shell remains terminal-only.
The inventory, old exe.dev VM controls and terminal gateway remain available.

## Placement

LocalSandboxProvider provisions a Git worktree and tmux session. AgentRuns uses a
per-run tmux worker to own the ACP runtime, so web-server restarts preserve live
callbacks. The stable Effect runtime and beta control plane exchange JSON; their
Effect values and schemas are isolated. Terminal attachments remain disposable.

ExeSandboxProvider can clone baseDevbox through ExeDevService for a new VM per
run, or use an explicit host for an already provisioned machine. It clones the
code repository, checks out the base SHA and run branch, bootstraps, and creates
a tmux session. Spawn uses SSH without a PTY; terminal attach uses the existing
SSH/tmux gateway. Finite commands reuse SshService through a plain Promise bridge.
The scoped outline MCP server is injected over HTTP at callbackUrl; that URL must
be reachable from the sandbox and the agent must advertise HTTP MCP support.
No reverse tunnel or credential provisioning is inferred. A real exe.dev read-only
connection failed here with Permission denied, so the full ACP scenario uses an
explicit SSH mock with a separate tmux server and actual cloned repository.

VercelSandboxProvider and CloudflareSandboxProvider are typed stubs. They fail
explicitly at provision/attach. No credentials were available in this workspace.
A future implementation must supply the same byte duplex, exec/fs/pty/port/git
operations and resource lifecycle. An API model loop can implement the ACP agent
side in process, using the already implemented client fs and terminal capabilities
to operate on its Sandbox. No hosted model loop is included in this slice.

## MCP and persistence

`threadvm mcp --run <id>` exposes outline.read, outline.propose and run.observe.
It requires the run capability supplied by session/new, cannot review proposals,
launch runs, change remotes, or answer permissions, and only observes its own run.
The HTTP equivalent is POST /api/runs/:id/mcp with its bearer capability. A host
should expose it over HTTPS when agents run remotely. CLI writes remain available.

Runs persist agentProfile, sandboxRef, acpSessionId, agentCapabilities and
pendingRequests. events.jsonl is authoritative; runs/<id>/state.json is an atomic
checkpoint. No credential token appears in that projection. Private launch config
and control files stay inside ignored runs/, protected by local file permissions.

A live worker keeps a pending request live through a server restart. If the worker
is lost, requests become message when loadSession is supported, otherwise expired.
Answering a message request loads the original ACP session and sends a follow-up;
it does not grant a new tool call. The loaded agent may ask again. An expired
request remains visible with disabled answer chips. A failed session/load reports
failure rather than silently creating a new conversation. No agentd, journaled
remote reconnect, laptop-sleep guarantee, or automatic secret distribution is added.

Run `pnpm probe:acp` for the same local and mocked SSH scenario, including stdio /
HTTP MCP, permission validation, partial acceptance, restart projections, process
interruption, session/load and fresh approval. `pnpm probe:local-ui` exercises the
real shared client against the git store and local terminal.

If a concurrent edit rejects a local save, the draft stays in the editor. Retry
my edit applies that intent against the latest revision and keeps unrelated
changes; Use latest explicitly discards the draft. Deleted anchors or a now
invalid move remain blocked, with the draft preserved for copying or reworking.
The remote repository must already contain the selected base SHA. Sandbox git
push/fetch are explicit operations; delegation does not push unpublished code.
