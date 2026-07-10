# Plan 3 Audit

Audit date: 2026-07-10

## Result

The durable terminal architecture in `PLAN_3.md` is implemented. Remote
`tmux` owns terminal state, each browser attachment uses one WebSocket and one
fresh SSH PTY, and reconnecting replaces the disposable browser attachment.
The former SSE, POST input/resize, replay cursor, ANSI mouse-mode inference,
and redraw workaround paths have been removed from production code.

## Architecture Evidence

- Shared Effect schemas define the WebSocket request and all client/server
  messages in `packages/shared/src/domain/schema.ts`.
- `RemoteTerminalSession` derives deterministic session names, provisions and
  preflights `tmux`, creates or reuses detached sessions, and builds structured
  SSH commands.
- `TerminalBridge.open` is scoped, creates a fresh PTY for each attachment,
  bounds output buffering, interrupts resources on closure, and enforces one
  active local attachment per ThreadVM.
- `/rpc/terminal/:threadVmId/socket` validates origin, ThreadVM ID, dimensions,
  and messages; serializes input and resize handling; and carries output,
  status, errors, and heartbeat traffic on the same socket.
- `TerminalPane` recreates xterm and its socket on reconnect. It relies on
  xterm's native mouse protocol, sends no input before `ready`, preserves OSC
  52 handling, and retains the JetBrains Mono terminal theme.
- ThreadVM provisioning explicitly installs the remote terminal runtime.
- Vite HMR and the stable API/terminal process can run separately with
  `pnpm dev:stable`; the remote session is independent of both.

## Automated Verification

The following passed together on 2026-07-10:

```text
pnpm typecheck
pnpm probe:terminal
```

That suite covers production builds, workspace boundaries, UI styling, shared
protocol decoding, initial attach, ordered input and resize, ping/pong, invalid
messages, queue limits, explicit restart, repeated reconnects, single-client
replacement, process interruption, resource cleanup, disconnected-input
rejection, xterm recreation, pointer forwarding, and OSC 52 parsing.

The integration probe uses a real local `tmux` session and PTY. A separate
exe.dev check against `drift-snow.exe.xyz` verified that an SSH attachment can
disconnect and immediately reconnect to the same named remote session. It also
exposed and verified fixes for first-use SSH host-key handling and the detached
session creation race.

## Verification Matrix

| Scenario | Evidence |
| --- | --- |
| Initial attach and typing | Terminal integration and UI probes |
| Browser refresh / explicit reconnect | Fresh socket/xterm lifecycle probe; repeated tmux reattach probe |
| Frontend HMR / backend restart | Stable-process topology plus durable remote tmux ownership |
| Temporary network loss | Disconnected input rejection probe |
| Window and rapid resize | Ordered socket resize and remote `stty size` assertions |
| Vim/TUI keyboard and mouse | PTY byte forwarding, native xterm pointer forwarding, and mouse-mode renegotiation assertions |
| Text selection and OSC 52 | Existing xterm selection path retained; OSC 52 parser and clipboard callback probe |
| Slow client | Bounded input/output queues and overflow close behavior |
| Multiple ThreadVMs | Per-VM attachment identity and one-active-client replacement probe |
| Cleanup | Socket close and interrupted-command orphan-process assertions |

## Manual Browser Check

The in-app browser automation bridge was unavailable during the final audit,
so the last-mile checks for a real Vim/Herdr mouse target, browser clipboard
permission feedback, refresh, and HMR should still be exercised manually at
`http://127.0.0.1:5173`. The transport and lifecycle cases beneath those
interactions are covered by the automated probes above.
