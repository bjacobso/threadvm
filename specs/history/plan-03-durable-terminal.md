# ThreadVM Plan 3: Durable Terminal Architecture

## Goal

Replace the current replay-based browser terminal bridge with a simpler,
durable terminal architecture that remains correct across browser refreshes,
reconnects, resizes, frontend hot reloads, and transient network failures.

The central ownership rule is:

- Remote `tmux` owns the durable terminal session and screen state.
- One WebSocket owns the ordered, bidirectional browser transport.
- A fresh SSH PTY owns each browser attachment.
- xterm owns only the current browser rendering and is disposable.

ThreadVM inventory, provisioning, metadata, ports, lifecycle actions, Effect
services, the React UI, and the existing visual design remain unchanged.

## Why This Change

A terminal is not only a byte stream. Its visible behavior depends on state
accumulated by the terminal emulator, including:

- alternate-screen activation,
- cursor position and visibility,
- mouse reporting modes,
- bracketed paste mode,
- application cursor and keypad modes,
- terminal dimensions,
- scrollback and partially received escape sequences.

The current bridge attempts to preserve that state across independent SSE and
HTTP requests using output replay, cursors, redraw requests, and inferred mode
tracking. This creates several related failure modes:

- A replay can begin in the middle of an ANSI escape sequence.
- A new browser xterm does not know which modes the remote TUI enabled earlier.
- Input can race ahead of output-stream attachment.
- SSE output and POST input do not share one ordered connection lifecycle.
- Browser refresh and frontend hot reload can leave the remote PTY alive while
  replacing the local terminal emulator that understood its state.
- Reconnect behavior differs depending on whether browser memory survived.

These are architectural symptoms, not isolated input or mouse bugs. Continuing
to add replay and mode reconstruction would amount to implementing a partial
terminal multiplexer in ThreadVM.

## Target Architecture

```text
Browser
  React + xterm.js
          |
          | one WebSocket per attachment
          v
Local ThreadVM terminal gateway
  Effect-scoped connection supervisor
  fresh local SSH PTY per WebSocket
          |
          | SSH
          v
exe.dev ThreadVM
  persistent named tmux session
          |
          v
shell / vim / agents / herdr / other TUIs
```

### Durable State

Each ThreadVM has a named remote `tmux` session. The session persists when the
browser closes, reloads, or loses its network connection.

Each browser attachment creates a new SSH PTY and runs a command equivalent to:

```sh
tmux new-session -A -s threadvm
```

The exact session name should be deterministic and safely derived from the
ThreadVM identifier. It must be passed through structured command construction
or strict shell escaping rather than concatenated from unchecked user input.

When a browser reconnects, `tmux` attaches the fresh PTY to the existing remote
session and redraws the current screen. ThreadVM does not replay historical raw
PTY output into a new xterm instance.

### Disposable Browser State

The browser creates a clean xterm instance for a new attachment. On reconnect:

1. Dispose the previous WebSocket and xterm attachment resources.
2. Measure the terminal container.
3. Open a new WebSocket with the initial rows and columns.
4. Let the server create a fresh SSH PTY at those dimensions.
5. Attach that PTY to the persistent remote `tmux` session.
6. Render the complete redraw emitted by `tmux`.

No local output cursor or browser-persisted terminal mode state is required.

## WebSocket Protocol

Use one ordered, bidirectional WebSocket connection per active terminal.
Control messages are JSON. Terminal input and output may initially also use
JSON for simplicity; binary frames can be introduced later only if profiling
shows a real need.

### Browser to Server

```ts
type TerminalClientMessage =
  | { readonly type: "input"; readonly data: string }
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  | { readonly type: "ping"; readonly timestamp: number }
```

The WebSocket URL identifies the ThreadVM and includes the initial dimensions:

```text
/rpc/terminal/:threadVmId/socket?cols=120&rows=40
```

All URL parameters and messages must be decoded with shared Effect schemas.

### Server to Browser

```ts
type TerminalServerMessage =
  | { readonly type: "ready"; readonly attachmentId: string }
  | { readonly type: "output"; readonly data: string }
  | {
      readonly type: "status"
      readonly status: "connecting" | "attached" | "disconnected"
    }
  | { readonly type: "pong"; readonly timestamp: number }
  | { readonly type: "error"; readonly message: string }
```

The browser must not send input until it receives `ready`. Input is disabled as
soon as the socket is no longer open. This prevents invisible buffered typing.

### Ordering and Backpressure

- Input, resize, status, and output share one connection lifecycle.
- The server processes client messages in arrival order.
- Output writes are serialized so terminal chunks cannot interleave.
- Slow or unresponsive clients are disconnected rather than allowed to grow an
  unbounded output queue.
- Resize events may be coalesced, but the latest size must always be applied.
- WebSocket close interrupts the SSH PTY scope promptly.

## Terminal Gateway Responsibilities

Introduce a focused Effect service for browser attachments. It should not own
durable terminal screen state.

```ts
interface TerminalGateway {
  readonly attach: (
    request: TerminalAttachmentRequest
  ) => Effect.Effect<TerminalAttachment, TerminalGatewayError, Scope.Scope>
}
```

An attachment owns:

- one WebSocket,
- one fresh local PTY process,
- one SSH connection,
- input and output fibers,
- resize handling,
- connection health and cleanup.

The existing SSH and process execution services should remain behind Effect
service boundaries. All resources must be scoped and interrupted together when
the WebSocket closes.

### Remote Session Service

Add a small `RemoteTerminalSession` service responsible for remote `tmux`
commands:

- check whether `tmux` is available,
- install or provision it when creating a ThreadVM,
- derive the session name,
- build the attach command,
- optionally inspect or terminate a session,
- classify missing-tool, SSH, and attach failures.

ThreadVM provisioning should make `tmux` availability explicit. Attachment may
perform a lightweight preflight, but it should not silently run an expensive
package installation in the interactive connection path.

## Development Process Isolation

The terminal gateway must not restart with Vite hot module replacement.

Development topology:

```text
Vite frontend dev server       reloadable
ThreadVM API/terminal server   stable process
Remote tmux session            persistent on the VM
```

Frontend HMR may replace React components and xterm. The browser should close
the old WebSocket and establish a fresh attachment without affecting the remote
`tmux` session.

If server-side API development needs watch mode, terminal transport should
either run in a separate stable process or the watch command should explicitly
exclude the terminal gateway. A backend restart may disconnect clients, but a
subsequent connection must recover through the remote `tmux` session.

## Browser Integration

Keep xterm.js and the existing terminal appearance.

The terminal feature should:

- create and dispose xterm through one lifecycle owner,
- fit before opening the socket,
- send initial dimensions during connection setup,
- forward later dimensions through `resize` messages,
- call `focus()` after pointer interaction without replacing xterm's native
  mouse event handling,
- accept keyboard input only while the connection is ready,
- show clear connecting, attached, disconnected, and failed states,
- reconnect by replacing the attachment rather than mutating a stale one,
- continue intercepting OSC 52 clipboard requests and writing through the
  browser Clipboard API,
- preserve the current JetBrains Mono theme and minimal chrome.

Do not synthesize terminal mouse escape sequences in application code. Browser
pointer events should reach xterm, and xterm should encode them according to the
modes negotiated during the fresh `tmux` attachment.

## Effect and Shared Contracts

Continue using Effect v4 end to end:

- shared schemas for WebSocket messages,
- typed errors for SSH, PTY, protocol, and remote-session failures,
- scoped resource acquisition and finalization,
- supervised input/output fibers,
- structured logs annotated with ThreadVM and attachment IDs,
- bounded queues and explicit backpressure,
- interruption on socket closure,
- test layers for SSH, PTY, and WebSocket behavior.

Use the checked-out Effect v4 source under `.context/effect-v4` to verify the
current WebSocket, socket, stream, scope, and platform APIs during
implementation. Do not carry Effect v3 API assumptions into this rewrite.

## Observability

Terminal failures have been difficult to distinguish from rendering failures.
Add structured events for:

- attachment requested,
- WebSocket opened and closed,
- SSH PTY spawned and exited,
- remote `tmux` session created or reused,
- initial and updated terminal dimensions,
- client ready state,
- input rejected because the attachment is not ready,
- queue overflow or slow-client disconnection,
- cleanup completion.

Each event should include `threadVmId` and `attachmentId`. Do not log terminal
input or output contents by default because they may contain secrets.

The UI may expose a small development-only connection diagnostic containing:

- attachment ID,
- WebSocket state,
- current rows and columns,
- last output timestamp,
- last input timestamp,
- reconnect count.

## Migration Strategy

### Phase 1: Establish the Remote Session

- Add deterministic remote `tmux` session naming.
- Add provisioning/preflight support for `tmux`.
- Prove SSH can create, detach, and reattach to a session.
- Confirm shell, vim, and a mouse-aware TUI redraw correctly after reattach.

Exit criteria: a local terminal command can disconnect and reconnect to the
same remote session without losing its application state.

### Phase 2: Add the WebSocket Gateway

- Define shared client/server protocol schemas.
- Add the Effect WebSocket route.
- Spawn a fresh SSH PTY for each socket.
- Forward input, output, resize, status, and close events.
- Add bounded buffering and scoped cleanup.

Keep the current SSE/POST implementation available behind a temporary feature
flag until the new gateway passes the integration probes.

Exit criteria: a standalone browser probe can type, resize, receive output,
disconnect, and reconnect through one socket.

### Phase 3: Replace the Browser Terminal Lifecycle

- Connect `TerminalPane` to the WebSocket protocol.
- Recreate xterm and the attachment cleanly on reconnect.
- Remove browser output cursors, replay flags, redraw requests, and restored
  mouse-mode injection from the active path.
- Preserve resize, focus, clipboard, theme, and status UI behavior.

Exit criteria: the full UI passes the interaction matrix below.

### Phase 4: Remove the Old Bridge

- Remove SSE terminal output routes.
- Remove POST input and resize routes.
- Remove raw output replay buffers and cursor tracking.
- Remove ANSI mouse-mode inference and restoration.
- Remove Ctrl-L reconnect redraw workarounds.
- Remove the feature flag and obsolete tests.
- Update `README.md`, `PLAN_2_AUDIT.md`, and architecture documentation.

Exit criteria: no production code depends on the old terminal session model.

## Verification Matrix

Automated integration coverage should exercise real xterm/browser behavior
where practical, not only mocked action functions.

| Scenario | Expected result |
| --- | --- |
| Initial attach | Prompt appears, typing is visible, commands execute |
| Browser refresh | Existing remote TUI redraws and accepts input |
| Explicit reconnect | Fresh attachment reaches the same remote session |
| Frontend HMR | Terminal reconnects; remote process survives |
| Backend restart | Connection drops clearly; reconnect restores remote session |
| Temporary network loss | No hidden input is accepted while disconnected |
| Window resize | Remote `stty size` and full-screen TUI match the browser |
| Rapid resize | Final rows and columns are correct without layout drift |
| Vim/TUI keyboard | Normal, control, escape, and modifier keys work |
| TUI mouse | Clicking the intended pane, row, or control works |
| Mouse after refresh | Mouse behavior remains correct after reattachment |
| Text selection | Browser selection and copy behavior remain intentional |
| OSC 52 copy | Remote copy reaches the browser clipboard with user feedback |
| Slow client | Output memory remains bounded and failure is visible |
| Multiple ThreadVMs | Attachments and input cannot cross VM boundaries |
| Cleanup | Closed sockets leave no local SSH or PTY process behind |

Add a repeated stability probe that performs attach, type, resize, disconnect,
and reconnect cycles many times. The test should fail on leaked processes,
cross-session output, stale input, or mismatched dimensions.

## Security and Safety

- Validate ThreadVM IDs and dimensions with shared schemas.
- Constrain dimensions to reasonable minimums and maximums.
- Never place raw user input in the remote shell command.
- Keep the WebSocket bound to the local ThreadVM server's existing trust model.
- Check WebSocket origin where appropriate.
- Do not log terminal contents or clipboard payloads.
- Interrupt SSH promptly when its browser connection closes.
- Make terminating the remote `tmux` session an explicit destructive action;
  ordinary disconnect and reconnect must never terminate it.

## Non-Goals

Plan 3 does not:

- make Herdr mandatory,
- synchronize one interactive terminal across multiple simultaneous browsers,
- implement collaborative terminal input,
- persist terminal history in ThreadVM's local store,
- build a custom terminal emulator or multiplexer,
- replace xterm.js,
- redesign the ThreadVM inventory or inspector UI.

For the first implementation, allow one active browser attachment per remote
session. A new attachment may replace the previous one or fail with a clear
conflict. Multi-client semantics should be an explicit later decision.

## Success Criteria

Plan 3 is complete when:

- a remote shell or TUI survives browser refresh and local server reconnect,
- keyboard, mouse, resize, and clipboard behavior work after every reconnect,
- input cannot be silently accepted while output is disconnected,
- no raw PTY replay or terminal-mode reconstruction is used,
- terminal transport uses one WebSocket per attachment,
- frontend hot reload cannot destroy the remote session,
- local SSH/PTTY resources are cleaned up deterministically,
- the verification matrix passes repeatedly,
- the old SSE/POST terminal bridge has been removed.

## Fallback

If remote `tmux` proves incompatible with a required application, the fallback
is a server-owned headless terminal emulator capable of producing complete,
serialized screen snapshots for cold clients. That approach should only be
chosen after documenting the concrete incompatibility because it requires
ThreadVM to own substantially more terminal state and recovery logic.
