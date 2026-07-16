# ThreadVM specifications

This directory is the source of truth for ThreadVM product and engineering specifications.

## Current specifications

- [Product and architecture](./product-architecture.md) — product model, repository layout, runtime stack, and current constraints.
- [Configuration and bases](./configuration-bases.md) — project registries, `harness.yaml`, mise bootstrap, personal bases, credentials, and cloning.
- [Backend and API](./backend-api.md) — domain schemas, HTTP and streaming routes, Effect services, metadata, and provisioning.
- [Frontend and workspace views](./frontend-workspaces.md) — shadcn shell, inventory, dialogs, inspector, Terminal/Plan tabs, and client state.
- [Terminal](./terminal.md) — durable tmux ownership, WebSocket protocol boundary, PTY/SSH attachments, and reconnect behavior.
- [Operations and verification](./operations.md) — ports, environment overrides, build commands, probes, and production serving.
- [Roadmap](./roadmap.md) — remaining implementation slices and product decisions.

## Historical plans

Completed and superseded implementation plans are preserved under [history](./history/README.md). They explain how the current architecture evolved, but they are not normative when they conflict with the current specifications above.

## Documentation rules

- Update the relevant area file when behavior changes.
- Keep implemented behavior separate from planned behavior.
- Put cross-cutting decisions in the narrowest owning specification and link to it elsewhere.
- Add dated implementation audits to `history/`; do not create new numbered plan files at the repository root.
- A workspace's remote `PLAN.md` is task data displayed by ThreadVM. It is distinct from this repository's product roadmap.
