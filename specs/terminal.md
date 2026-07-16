# Terminal

The terminal architecture follows one ownership rule:

- remote tmux owns durable terminal and screen state.
- one WebSocket owns each ordered browser transport.
- one fresh local PTY-backed SSH process owns each browser attachment.
- xterm.js owns only the current browser rendering and is disposable.

## Components

`RemoteTerminalSession`

- derives a deterministic, collision-resistant tmux session name from the ThreadVM id.
- provisions tmux during ThreadVM bootstrap using a supported remote package manager.
- checks whether a session exists before attachment.
- kills an existing session only for an explicit restart.
- creates a detached session before reporting readiness.
- constructs the structured `ssh -tt` tmux attach command.

`TerminalBridge`

- creates one fresh local PTY per browser WebSocket attachment.
- replaces the previous local attachment for the same VM without terminating tmux.
- starts `ssh -tt <vm.host> 'tmux attach-session ...'` for real VMs.
- uses the browser's measured rows and columns as the initial PTY size.
- uses `node-pty` first with `xterm-256color` and truecolor hints.
- falls back to `scripts/pty_bridge.py` if `node-pty` spawn fails.
- bounds PTY output buffering and terminates overflowing local attachments.
- has no replay buffer, output cursor, or ANSI mouse-mode parser.

`TerminalPane`

- owns the disposable xterm instance and fit addon.
- maintains per-VM attachment state through Effect Atom.
- sends attach, reconnect, restart, input, resize, status, and heartbeat traffic on one WebSocket.
- keeps the remote tmux session alive when the browser attachment disconnects.
- handles OSC 52 clipboard requests with a browser clipboard fallback.
- remains mounted when the user switches between the Terminal and Plan workspace tabs.

## Terminal Flow

1. Browser fits a clean xterm instance and opens the terminal WebSocket with
   its initial dimensions.
2. Server validates the request and resolves the VM through
   `WorkspaceService`.
3. `RemoteTerminalSession` checks or restarts the deterministic remote tmux
   session.
4. `TerminalBridge` creates a fresh scoped local PTY running `ssh -tt` and
   attaches it to tmux.
5. Server emits `ready` and `attached`, then forwards PTY output.
6. Browser sends input, resize, and ping messages on the same socket.
7. Server processes client messages through one bounded queue in arrival order.
8. Disconnect closes the local SSH PTY but leaves remote tmux running.
9. Reconnect creates a fresh xterm and PTY; tmux redraws the durable screen and
   terminal modes.

## Constraints and future work

- xterm.js is the only renderer; a Ghostty Web adapter has not been implemented.
- terminal transport uses shared Effect schemas over WebSocket, not Effect RPC.
- `TerminalBridge` remains in `packages/shared` even though it is server-only.
- the Python PTY fallback remains until `node-pty` is sufficiently reliable everywhere.
- managed Herdr sessions are optional future work and must not replace the plain shell path.

See [Plan 3](./history/plan-03-durable-terminal.md) and its [audit](./history/plan-03-audit.md) for the completed migration rationale and verification record.
