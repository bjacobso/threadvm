# Frontend and workspace views

## Frontend

Entry:

- `apps/web/src/client/main.tsx`
- renders `apps/web/src/app/App.tsx`

Main UI:

- full-height shadcn `SidebarProvider` shell with a project-grouped workspace sidebar
- collapsible desktop sidebar, mobile sidebar drawer, rail, and toolbar trigger
- main workspace surface for the selected ThreadVM
- workspace details in a right-side inspector sheet
- command palette opened with Cmd/Ctrl-K
- toasts for user-visible async results

Inventory:

- lists ThreadVMs in shadcn sidebar groups and menus, grouped by project
- tracks loading and reconciliation errors
- supports selection persisted in localStorage
- opens New ThreadVM and Project Registry dialogs

New ThreadVM dialog:

- selects project
- accepts summary, branch override, base VM override, image override, starting prompt, pinned flag
- calls `POST /api/threadvms`
- selects the created VM on success

Project registry dialog:

- loads projects from API
- saves and removes project entries
- writes back to YAML through the server
- versioned-config projects are read-only at the service boundary and direct the
  user back to `harness.yaml`

Terminal:

- xterm.js renderer with fit addon
- per-VM terminal session state
- disposable xterm instance and fresh local PTY for every attachment
- one ordered WebSocket for attach, reconnect, restart, input, resize, status, and heartbeat
- deterministic remote tmux session per ThreadVM
- active terminal VM persisted in localStorage for auto-attach
- OSC 52 clipboard handling with browser clipboard fallback notice
- keyboard shortcuts for attach/restart through `keyboardShortcuts.ts`

The main workspace surface provides `Terminal` and `Plan` tabs without changing
the terminal ownership or durability model.

## Workspace Views

Selecting a task workspace opens a tabbed main surface with:

```text
Terminal | Plan
```

Each tab belongs to the selected ThreadVM, not to the browser globally.
Switching workspaces restores that workspace's last selected view. Switching
between `Terminal` and `Plan` must not restart the VM, kill tmux, or create a
second remote terminal session.

### Terminal tab

- Uses the existing deterministic tmux session for the selected ThreadVM.
- Preserves terminal session state per ThreadVM while the user inspects another
  workspace or its plan.
- Re-fits xterm when the tab becomes visible again.
- Reconnect and explicit restart retain their current meanings: reconnect
  replaces only the local PTY/SSH attachment; restart explicitly replaces the
  remote tmux session.

### Plan tab

The Plan tab is a synchronized view of one canonical file inside the selected
task workspace:

```text
<workspace-root>/PLAN.md
```

For a versioned `harness.yaml` project, `<workspace-root>` is
`workspace.root`. For a legacy project it is the resolved project `workdir`.
The fixed filename is deliberate for the first version; arbitrary remote file
browsing is out of scope.

Implemented viewer behavior:

- The remote `PLAN.md` is the source of truth. ThreadVM does not maintain a
  separate plan database or copy plan contents into exe.dev tags or comments.
- Opening the tab reads UTF-8 Markdown over the server-owned SSH boundary and
  shows loading, missing-file, error, empty-file, and rendered states.
- A missing plan produces an empty state with an `Open terminal` action rather
  than silently creating a file.
- The UI renders CommonMark and GitHub-flavored tables, task lists,
  strikethrough, and links through `react-markdown` and `remark-gfm`.
- Refresh runs when the user opens the Plan tab or selects refresh explicitly.
- Reads return a SHA-256 content revision for future conditional writes.
- Markdown rendering treats file content as untrusted. Raw HTML is skipped and
  unsafe link protocols are rejected by the renderer.
- The server enforces a 256 KiB file limit and rejects non-file and binary
  targets before returning content.

Planned editing and continuous synchronization behavior:

- Add an editable source mode. Edits save back to the same remote file after an
  explicit save or a short debounce.
- Writes are atomic: upload a sibling temporary file, flush it, then rename it
  over `PLAN.md` on the VM.
- Reads return a revision derived from the file content and metadata. Writes
  include the last observed revision and fail with a conflict when the remote
  file changed after the editor loaded it.
- On conflict, preserve the user's unsaved text and offer reload, copy, or an
  explicit overwrite. Never silently discard either version.
- Refetch when the selected workspace changes, the Plan tab regains focus, or
  terminal/agent activity reports that the file changed. A low-frequency poll
  is an acceptable first implementation; filesystem watching can follow.
- Changes made by Codex, Claude, a human terminal, or another SSH client become
  visible in the Plan tab without requiring a server restart.

The Plan tab is intended for task planning, progress notes, handoff, and agent
coordination. It is not a replacement for Git history: whether `PLAN.md` is
committed remains a project decision.

### Plan API

The typed read endpoint is implemented; the write endpoint is planned:

```text
GET /api/threadvms/:id/plan  (implemented)
PUT /api/threadvms/:id/plan  (planned)
```

Read response:

```text
threadVmId
path
exists
content
revision
observedAt
```

Write request:

```text
content
expectedRevision
```

Write response returns the new revision and observation timestamp. Missing
ThreadVMs, unavailable SSH, invalid UTF-8, oversized content, and revision
conflicts should have distinct typed errors so the UI can recover without
parsing command output.

Plan content must not be added to reconciliation snapshots, provisioning
events, terminal messages, local metadata, or logs. Only the explicit plan
resource endpoints may transfer it.

Inspector:

- overview metadata table
- lifecycle stop/remove actions
- port links and remote port checks
- provisioning stream status
- provisioning steps with output excerpts
- dev log refresh and tail display

Client state:

- uses Effect `AtomRef`
- central state file: `apps/web/src/state/atoms.ts`
- API client: `apps/web/src/state/apiClient.ts`
- localStorage keys:
  - `threadvm.selectedVmId`
  - `threadvm.activeTerminalVmId`

The workspace surface stores its per-ThreadVM view preference at
`threadvm.workspaceView.<threadVmId>`. Plan content remains in memory rather
than localStorage.
