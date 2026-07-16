# Roadmap

This roadmap contains current work only. Completed numbered plans are archived under [history](./history/README.md).

## Next vertical slice: reusable bases

1. Add a first-class Base domain model and lifecycle states.
2. Create a base VM from `workspace.sourceImage`.
3. copy the consumer mise config and setup scripts into `workspace.root`.
4. check out every configured repository.
5. run `mise trust` and `mise bootstrap --yes` non-interactively.
6. open an unrecorded interactive setup terminal for configured authentication tools.
7. verify authentication without printing secrets and mark the base ready.
8. clone a task workspace from the ready base, create task branches, run `tasks.afterClone`, and start the dev command.
9. expose create, setup, verify, clone, stale, repair, and delete states in the UI.

The end-to-end acceptance path is:

```text
config check
→ create base
→ mise bootstrap
→ authenticate tools
→ verify base
→ clone task
→ task becomes ready
→ attach terminal
→ view PLAN.md
→ preview port responds
→ remove task
```

## Plan editing and synchronization

The read-only `PLAN.md` viewer is implemented. Remaining work:

- add source editing and an explicit or debounced save.
- write through a sibling temporary file and atomic rename.
- send the last observed revision with writes.
- preserve unsaved text and surface reload/copy/overwrite choices on conflicts.
- detect external changes from terminals and agents through focus refresh, polling, or filesystem watching.
- add typed errors for revision conflicts and unsupported content.

## Runtime and product follow-ups

- implement the versioned multi-repository runtime and remove the current creation guard.
- replace command-output parsing with a stronger exe.dev adapter if an SDK becomes suitable.
- make reconciliation and provisioning streams event-driven instead of polling snapshots.
- finish metadata authority and recovery rules.
- remove the Python PTY fallback after equivalent coverage exists for `node-pty`.
- evaluate a terminal-renderer adapter before considering Ghostty Web.
- add diff, review, and PR creation workflows.
- add optional Herdr automation only where it improves inspectability.
- define sharing, credential revocation, and short-lived credential injection for team bases.

## Non-goals

- a general cloud IDE.
- replacing GitHub, CI, or issue trackers.
- making Herdr mandatory.
- a chat-first interface that hides the workspace runtime.
- sharing credential-bearing personal bases by default.
