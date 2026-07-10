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
- a checked-out repo and branch.
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

- A `Project` is a product line: repo, bootstrap rules, default commands, ports, branch conventions, and agent defaults.
- A `ThreadVM` is a work cell: one isolated environment for one task.
- A `TerminalSession` is an operator console inside the work cell.
- An `AgentSession` is an autonomous worker assigned to the work cell.
- A `Runbook` is the repeatable setup and operating procedure.
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

## Software Factory Meta-Framework

ThreadVM should become a framework for declaring and operating repeatable software work cells.

A project should be able to define:

- how to create or clone an environment.
- where the repo lives.
- how dependencies are installed.
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
6. Move toward project runbooks that can describe the factory cell declaratively.
7. Add agent session affordances only where they make the environment easier to inspect and operate.

## Long-Term Picture

A user should be able to say:

```text
Create a workspace for this bug, use the normal project runbook, start the agent, show me the preview, and keep the terminal available.
```

ThreadVM should turn that into a named, running, inspectable work cell.

Later, a team should be able to run many such cells in parallel, with clear ownership, state, logs, previews, diffs, and cleanup. That is the software factory: not a vague automation platform, but a set of concrete development environments where humans and agents can reliably produce, inspect, and retire work.
