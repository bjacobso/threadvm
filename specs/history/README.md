# Historical implementation plans

These documents preserve the implementation sequence that led to the current
ThreadVM architecture. They are useful design records, but the topical files in
the [specifications index](../README.md) are the normative description of the
current product.

| Document | Scope | Status |
| --- | --- | --- |
| [Initial harness plan](./plan-01-initial-harness.md) | Original web harness, exe.dev workspace lifecycle, and terminal MVP | Implemented and superseded in part |
| [UI and monorepo plan](./plan-02-ui-monorepo.md) | pnpm/Turborepo split, Effect contracts, shadcn UI, and terminal-adjacent workspace shell | Implemented |
| [Plan 2 audit](./plan-02-audit.md) | Evidence for the UI and monorepo implementation | Completed 2026-07-09 |
| [Durable terminal plan](./plan-03-durable-terminal.md) | tmux-owned persistence with disposable WebSocket/SSH attachments | Implemented |
| [Plan 3 audit](./plan-03-audit.md) | Evidence for the durable terminal implementation | Completed 2026-07-10 |

New product behavior belongs in the relevant topical specification. Remaining
work belongs in the [roadmap](../roadmap.md), not in another numbered root plan.
