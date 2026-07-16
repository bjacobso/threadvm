# Vision

ThreadVM is the development-environment control plane for agentic software work.

It should feel less like a VM launcher and more like the `pi`, `opencode`, or `codex` of development environments: a focused agent UX where every task gets a live, inspectable, disposable workspace with terminals, ports, metadata, logs, and lifecycle controls.

The larger idea is a meta-framework for software factories.

## Thesis

Modern software work is becoming parallel, agent-assisted, and environment-heavy.

A single laptop checkout is the wrong primitive for that world. It mixes unrelated branches, dependencies, server state, agent sessions, logs, ports, credentials, and half-finished experiments. The natural unit is no longer "the repo on my machine." It is "the active work cell for this task."

ThreadVM should make that work cell first class.

Each idea, bug, draft, review, migration, or production investigation should have:

- an isolated machine or devbox.
- the required repositories and task branches.
- bootstrapped dependencies.
- running dev servers and exposed ports.
- one or more agent terminals.
- durable logs and metadata.
- a clear lifecycle: create, attach, pause, resume, inspect, archive, destroy.

The user should not have to remember which terminal tab, port, branch, or VM belongs to which piece of work. The system should make that relationship visible and operable.

## Product Shape

ThreadVM is an operations console for development workspaces.

The primary screen should answer:

- What work cells exist?
- What state is each one in?
- Which agent or human process is active inside it?
- What ports and previews are available?
- What changed?
- What is blocked?
- What should I inspect, resume, merge, or delete?

The terminal remains central, but the product is not just a terminal. The terminal is one tool inside a broader workspace runtime.

ThreadVM should coordinate:

- environment provisioning.
- terminal sessions.
- agent sessions.
- dev servers.
- port discovery.
- metadata reconciliation.
- status and logs.
- eventual diff, review, and merge workflows.

## Mental Model

ThreadVM is a factory floor.

- A `Project` is a product line: repositories, bootstrap rules, default commands, ports, branch conventions, and agent defaults.
- A `Base` is a prepared personal work-cell template: an exe.dev VM created from a source image, bootstrapped once, optionally authenticated, and cloned for tasks.
- A `ThreadVM` is a work cell: one isolated environment for one task.
- A `TerminalSession` is an operator console inside the work cell.
- An `AgentSession` is an autonomous worker assigned to the work cell.
- A `Runbook` is the consumer-owned `harness.yaml`, mise configuration, and scripts that define the repeatable setup and operating procedure.
- A `Port` is an observable output from the cell.
- Metadata is the factory ledger: what exists, why it exists, who created it, what it is doing, and when it can be cleaned up.

This model should stay understandable to a person using it locally, but it should scale toward many parallel environments and many agents.

## Agent UX

Agent UX is not chat alone. For development work, agent UX includes the whole environment around the agent:

- shell state.
- filesystem state.
- branch state.
- logs.
- previews.
- test output.
- running processes.
- secrets and credentials.
- handoff notes.
- recovery after reconnects.

ThreadVM should make agent work inspectable. A user should be able to enter any work cell, see what the agent sees, understand what happened, and take over without guessing.

Good agent UX here means:

- every task has a named place to run.
- terminals are durable and reconnectable.
- logs are streamed and retained.
- previews are one click away.
- background provisioning is visible.
- failures have typed state, not just buried stdout.
- agents can be launched with project-aware defaults.
- humans can interrupt, steer, or resume work without losing context.

## Consumer-Owned Runbooks

ThreadVM should be usable by many unrelated projects without copying ThreadVM
into those projects or registering everything in a central installation.

A user should be able to enter a project configuration directory and run:

```sh
threadvm config check
threadvm web
```

ThreadVM should discover a versioned `harness.yaml` from that directory. The
runbook should be checked into a team-owned repository and declare:

- the project identity and remote workspace root.
- the source OCI image and reusable base VM.
- every repository to check out and where it belongs in the workspace.
- which repositories receive per-task branches.
- the mise configuration and deterministic bootstrap command.
- the interactive base-personalization command and required authentication tools.
- post-clone reconciliation, dev commands, ports, terminals, and agent panes.

Relative paths belong to the runbook directory. The ThreadVM package location
must not affect their meaning. A config-check command should catch invalid or
overlapping repository paths, missing mise files, duplicate ports, and unsafe
path escapes before any VM is created.

## Personal Bases and Credentials

The fastest task workflow is to prepare a base once and clone it many times.
The base lifecycle has two deliberately separate phases:

1. **Bootstrap:** deterministic, non-interactive machine and repository setup
   driven by `mise bootstrap --yes`.
2. **Personalize:** an interactive terminal that walks through selected tools
   such as GitHub CLI, Codex, and Claude Code, then verifies their login state.

A personalized base is a credential-bearing personal artifact, not a generic
container image. Cloning it may intentionally copy authenticated CLI state so a
new task can start immediately. That convenience creates a clear trust boundary:

- personal bases and their clones should be private and unshared by default.
- ThreadVM must never copy token values into its metadata, logs, or event streams.
- authentication terminal output should not be retained as provisioning excerpts.
- transient shell history and agent transcripts should be sanitized before a
  base is marked cloneable.
- every clone should verify authentication without printing secrets and offer a
  targeted re-login when a copied session is stale or rejected.
- team workflows should eventually support injected, scoped, or short-lived
  credentials instead of copying one person's long-lived sessions.

The UI should make this boundary obvious. "Ready to clone" means bootstrap and
required auth checks passed; it does not mean the base is safe to share.

## Software Factory Meta-Framework

ThreadVM should become a framework for declaring and operating repeatable software work cells.

A project should be able to define:

- how to create or clone an environment.
- which repositories belong in the environment and where they live.
- how dependencies are installed.
- how a reusable base is bootstrapped and personalized.
- how dev servers start.
- which ports matter.
- which agent command is preferred.
- which panes or terminals should exist.
- how health is checked.
- how metadata is written and recovered.
- how work is reviewed and retired.

The first implementation can be a local web app over exe.dev and SSH. The design should leave room for other backends later:

- local containers.
- remote VMs.
- devcontainers.
- Kubernetes namespaces.
- CI-like ephemeral runners.
- hosted browser workspaces.

The important abstraction is the work cell, not the provider.

## Strategic Direction

ThreadVM should optimize for:

- fast creation of isolated task environments.
- reliable attach and reconnect.
- faithful terminal behavior for modern TUIs and agent CLIs.
- observable provisioning and runtime state.
- project-specific automation without hiding the underlying shell.
- explicit metadata and cleanup.
- compatibility with existing tools instead of replacing them prematurely.

It should not try to become:

- a general cloud IDE.
- a replacement for GitHub, CI, or issue trackers.
- a heavyweight platform before the local workflow is excellent.
- a chat app with hidden infrastructure.
- a VM inventory dashboard with no opinion about software work.

## Near-Term Product Bets

1. Make terminal attach boringly reliable.
2. Treat `node-pty` as the server PTY path and remove Python fallback complexity.
3. Introduce a terminal-engine adapter so xterm.js and Ghostty Web can be evaluated by real workloads.
4. Keep xterm.js as default until Ghostty Web proves better on Unicode, modern TUIs, and agent CLI behavior.
5. Make provisioning streams and lifecycle state first-class in the UI.
6. Make current-directory, versioned project runbooks the primary configuration path.
7. Add a visible base lifecycle: create, bootstrap, personalize, verify, clone, revoke, and delete.
8. Add agent session affordances only where they make the environment easier to inspect and operate.

## Long-Term Picture

A user should be able to say:

```text
Create a workspace for this bug, use the normal project runbook, start the agent, show me the preview, and keep the terminal available.
```

ThreadVM should turn that into a named, running, inspectable work cell.

When no ready base exists, ThreadVM should first offer to build one from the
runbook, open the setup terminal for the required logins, verify it, and then
clone the task workspace. Later tasks should usually skip directly to the clone.

Later, a team should be able to run many such cells in parallel, with clear ownership, state, logs, previews, diffs, and cleanup. That is the software factory: not a vague automation platform, but a set of concrete development environments where humans and agents can reliably produce, inspect, and retire work.
