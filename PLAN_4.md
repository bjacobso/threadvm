# ThreadVM Plan 4: Outline Meta-Harness

## Goal

Make a project directory a durable, filesystem-native workspace for human intent
and agent execution. Humans author intent. Agents execute and propose changes.
The outline is where both meet. Every bullet has a stable identity; a thread is
any node that has been delegated, rather than another domain type.

The first slice supports local worktree/tmux runs and inline proposal review,
while retaining the exe.dev inventory and durable terminal gateway from Plan 3.
The agreed design is `.context/plan4-brief.md`; background notes are explanatory.

## Ownership Rules

- The outline store owns accepted nodes, revisions, operation batches and proposals.
- Humans apply batches immediately; agents can only propose outline mutations.
- Accepting a proposal applies all or selected node operations as a human decision.
- Observations can update a run's execution history, never the outline.
- Starting a run requires an explicit human UI or CLI action. Agents receive a
  restricted run capability for observations and proposals, not delegation.
- The thoughts repository owns thought history. Each applied batch is one commit.
- The append-only event log owns execution history; Git is not a runtime machine.
- The project Git repository owns code and per-run worktree branches.
- tmux owns durable processes/screens; TerminalBridge owns disposable PTYs and
  the existing WebSocket owns ordered browser transport.

## Data Model

`.threadvm/` is a nested Git repository excluded using the outer repository's
Git info/exclude (including when the project is itself a worktree).

```text
.threadvm/
  snapshot.json        accepted outline, revision, tombstones, proposals
  ops.jsonl            applied operation batches, including proposal/run links
  outline.md           read-only Markdown projection with stable ID anchors
  summaries/           committed run context and links
  events.jsonl         ignored append-only execution history
  runs/                ignored capabilities, context and process artifacts
  worktrees/           ignored project Git worktrees
  .gitignore           excludes runtime files, transcripts and writer locks
```

Three histories link by node IDs, run IDs and code SHAs. Raw terminal output is
not committed. Local events remain available after server/browser restarts.

## Schemas

Use Effect 4 Schema classes for Node, insert/update/move/delete variants,
OperationBatch, AppliedBatch, Proposal, OutlineSnapshot, Run, RunEvent and API
requests/responses. Root parent and first-position anchor use null. IDs are
validated and immutable. Node patches contain text/done only; execution status
comes from events. Ordered siblings are represented by the snapshot node order.

Batches target a numeric baseRevision. Different node IDs commute; stale writes
to a changed node, reused/deleted IDs, or missing parent/anchor conflict. Reject
cycles, invalid sibling anchors and future revisions. Deletes cover subtrees
and check descendants for concurrent edits. Proposal review is atomic and can
select node IDs; dependencies must be accepted together or in parent-first order.

## Services

- ThoughtsRepo: init, outer exclusion, serialized cross-process writers, Git
  commits, remote configuration and push. Recover abandoned locks by owner PID.
- OutlineStore: schema validation, graph invariants, conflict/rebase checks,
  operation application, proposal submission/review, Markdown projection.
  Read committed snapshots, so interrupted pre-commit writes cannot become
  accepted state. All writers share the repository lock.
- RunEventLog: serialize appends, validate events, recover run projections.
- LocalRunSubstrate: worktree and branch per run, persistent local tmux,
  ancestor/subtree context, agent environment, start/finish reconciliation.
  Record intent before starting external resources and retain failed runs.
- TerminalBridge: reuse its existing transport with an explicit prepared local
  terminal command, alongside the existing remote terminal service.

Services use Context.Service, Layers, typed errors and Effect composition.
Filesystem/process access remains inside services.

## API

Extend the typed HttpApi with outline read, human batch apply, propose,
accept/reject selection, run start and observe endpoints. Return schema classes.
Poll the outline/run projection so CLI writes appear in the UI without a daemon
or per-agent adapter. Local run terminal IDs resolve through the same terminal
WebSocket; local attach cannot create or restart another executor.

The CLI and HTTP agent paths enforce run capability scoping and keep proposal,
observation and human mutation verbs distinct. MCP equivalents are optional in
this slice and can follow using the same services.

## CLI

```text
threadvm init [dir]
threadvm open [dir]
threadvm web
threadvm outline show [--markdown]
threadvm outline apply <batch.json|->
threadvm propose <batch.json|->
threadvm proposal accept|reject <id> [nodeId ...]
threadvm observe <runId> <message> [--kind observation|output|commit|pr|finished]
threadvm run <nodeId> [--agent codex|claude|shell]
threadvm remote add <name> <url>
threadvm push [remote] [branch]
```

`--dir` selects a project for non-launch commands. `open` selects the project,
starts the server and opens the browser; `web` retains the existing launch path.
Run context includes exact CLI commands and the restricted capability environment.

## UI

The outline is the primary pane. Keep VM inventory behind an explicit tab.
Typing bullets, Enter, Tab/Shift-Tab, reorder controls and done toggles produce
human operation batches. `/run` and a visible run action require human intent.
Render proposed inserts at their intended parent/anchor and proposed edits/moves/
deletes beside their affected nodes. Offer node and batch accept/reject, show
conflicts, and retain unreviewed operations after partial acceptance.

Render run state and observations beneath the delegated node, with the existing
TerminalPane/TerminalBridge attach experience. Reuse shadcn controls and semantic
Tailwind tokens. Errors remain visible and do not discard pending input.

## Phases

1. Document the framing and ownership contracts.
2. Implement schemas, thoughts Git transactions, outline store and review.
3. Add event log, local substrate, CLI and typed HTTP API.
4. Make the outline primary and integrate inline proposals and run terminals.
5. Exercise real CLI/Git/tmux recovery and real headless Chrome UI; fix failures.

## Acceptance Criteria

- Init creates an independent thoughts Git repo and excludes it from code Git.
- Human edits and accepted proposal subsets each produce one thoughts commit.
- Concurrent disjoint edits rebase; conflicting edits fail without partial writes.
- Agents can observe/propose but cannot directly rewrite intent or launch runs.
- Local runs have a branch, worktree, context and durable attachable tmux session.
- Browser and server restarts recover accepted outline, pending proposal choices,
  events and live run status. Finished/missing sessions are reconciled.
- exe.dev inventory, provisioning and remote terminal behavior remain available.
- typecheck, build, lint, boundary/style probes and a new temp-repo outline probe
  pass; Chrome screenshots show inline proposals and a running delegated node.

## Non-Goals

SQLite indexing, exe.dev as a run substrate, nested delegation orchestration,
multiplayer, Markdown round-trip editing and automatic code merging are deferred.
MCP is optional; CLI is the first complete agent protocol.

## Foldkit + ACP Integration (October 15)

The user's follow-up replaces the primary React outline pane with Foldkit,
Foldworks and StyleX. `origin/main` already added a Cloudflare experience
prototype. The local application now uses the same upstream outliner and UI
primitives, with a separate local update model. The Cloudflare demo retains its
scripted agents; it does not provide local execution or authorize delegation.

### Ownership and Runtime Boundaries

- Foldworks owns editing, nesting, drag/reorder, selection, folding and history.
  Local Foldkit commands translate document changes into canonical operation
  batches. Serialize saves; preserve keystrokes during requests and disjoint
  concurrent changes. Conflicts retain the draft and require deliberate recovery.
- Local server `/` serves the Foldkit application. `/inventory` keeps the existing
  exe.dev React surface. `/terminal/:runId` embeds the existing TerminalPane
  below the delegated node, preserving its WebSocket/TerminalBridge behavior.
- Explicit Run buttons are the only local UI delegation path. Mentioning an
  agent or accepting proposed text never starts another agent.
- `AgentDriver` owns protocol sessions, typed events, prompting, permission
  continuations and cancellation. `Scope` owns subprocess cleanup, `Stream`
  carries events, and `Deferred` waits for a permission decision.
- T3 Code's MIT `effect-acp` source is pinned and attributed in `packages/agent`.
  It uses Effect 4.0.4, isolated in the tmux-owned runner process. The server
  remains on beta.94 and Foldkit on rc.112. Only schema-validated JSON crosses
  those runtime boundaries. No blanket dependency upgrade is required.
- ACP is the editor/agent control protocol. The existing CLI remains the
  agent/outline write protocol. ACP updates cannot directly edit accepted intent.

### Data, Services, API and CLI

Add `AgentSignal`, `AcpConfiguration`, `RunControlRequest` and the `acp` executor.
Persist initialization/capabilities, session IDs, updates, permission requests,
answers and turn completion in ignored `events.jsonl`. The run's `acp.json`
snapshots the project configuration. Control files are atomic and local to a run;
HTTP server restarts leave the ACP process and its permission continuations alive.

`threadvm run <nodeId> --agent acp` reads `.threadvm/acp.json`:

```json
{ "command": "/absolute/path/to/acp-agent", "args": [] }
```

The program must speak ACP on stdio. The initial adapter negotiates v1 and
advertises no client filesystem/terminal capabilities; agents use their own
worktree tools. Preserve initialization metadata and raw update payloads so
additional capabilities can be added deliberately. Existing terminal-based
shell, Codex and Claude executors continue to work.

`POST /api/outline/control` and human-only `threadvm permission <runId>
<requestId> <optionId>` / `threadvm cancel <runId>` enqueue decisions. Validate
permission IDs/options against this run's events. Agent capabilities cannot
answer their own permission requests. Interruption sends ACP `session/cancel`
before scoped child cleanup. Finishing a prompt ends this run; session
resumption and multi-turn steering are deferred.

### Verification and Remaining Work

- The deterministic ACP probe exercises the real stdio protocol, local worktree,
  tmux, CLI proposals, permission continuation, partial acceptance, thought
  commits, cancellation and restart recovery. Its peer is explicitly a test agent.
- The Chrome local-harness probe edits the real Foldworks outliner, delegates a
  real shell, sends xterm keyboard input into tmux, approves an ACP permission,
  reviews a CLI proposal, restarts browser/server, and visits the VM inventory.
- Keep the existing outline, terminal, boundaries and style checks passing.
- Defer MCP, reconnecting a terminated ACP subprocess, client-mediated ACP
  filesystem/terminal tools, model selection, multi-turn steering, nested
  delegation and the prototype's richer mention/inbox interactions in local mode.

The live integration was additionally checked with the installed
`@agentclientprotocol/claude-agent-acp` 0.91.0 and the workspace's existing Claude
authentication. Through ACP it requested permission, wrote and committed a proof
file, submitted an actual CLI proposal and recorded observations plus the code
SHA. This is separate from the deterministic regression fixture.

Undo restores the content of committed deletions with fresh IDs. Rewrite the
Foldworks history when tombstones arrive, preserving the store's no-ID-reuse
invariant. Local collapse preferences do not become shared operations.

## Design Alignment: One Outline Client

Local and Cloudflare modes use the same PR #1 Foldkit client, projections,
attention queue, views and CSS. `@threadvm/outline-protocol` owns their additive
wire contract. Its synchronous JSON codecs isolate the client’s Effect release
from the server’s Effect release; Effect values do not cross that boundary.

The local `OutlineRoom` serializes socket mutations, broadcasts canonical changes
to every window, and polls the Git store and run event log for CLI/ACP writes.
Human saves carry a base document, base revision and idempotency key. A tab has
one save in flight; acknowledgement rebases later keystrokes onto the canonical
result. Git remains the authority for conflicts, immutable IDs and partial review.
Accepted operations are never copied back as a second human batch.

Mentions use the existing countdown, send-now and keep-as-note interactions.
Claude and configured Codex profiles use persistent ACP sessions; unconfigured
Codex retains its terminal fallback. Shell uses a worktree/tmux run. Conductor
uses Claude to propose a delegated plan; Cursor is explicitly unavailable.
Accepting a proposed mentioned bullet authorizes fan-out, bounded at two levels.
This supersedes the earlier first-slice deferral of nested delegation.

ACP permission requests and form elicitations become inline questions, inbox
cards and thread questions. Responses go through the scoped control path.
Queued answers are remembered so polling cannot reopen an already answered
request. Unanswered questions and pending proposals recover after server restart.
Persistent sessions support subsequent prompts and cancellation. Terminal attach
uses the existing gateway inside a collapsible thread-panel section. VM inventory
and thoughts Git push are accessible from the quiet header menu.

The separate `src/local` client is removed. The Cloudflare simulator and tests
remain available. MCP and sandbox placement are addressed in PLAN_5 rather than
mixed into this UI alignment.
