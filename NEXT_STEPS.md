# Next Steps

## Goal

Make the terminal path simpler and more faithful:

- Remove the Python PTY fallback and rely on `node-pty` for server-side terminal sessions.
- Keep the existing xterm.js renderer as the default while introducing a browser terminal adapter.
- Add Ghostty Web as an experimental renderer behind a feature flag, focused on terminal semantics correctness rather than assumed performance wins.

The target architecture is:

```text
Browser terminal engine adapter
  | xterm.js default
  | Ghostty Web experiment
  v
Terminal transport
  | current SSE output + POST input/resize first
  | WebSocket or Effect RPC later if needed
  v
Server TerminalBridge
  | node-pty only
  v
ssh <vm-host>
```

## Current State

- Server terminal attach lives in `packages/shared/src/services/TerminalBridge.ts`.
- The server already imports `node-pty` and tries `pty.spawn(...)` first.
- If `node-pty` throws, the bridge falls back to `python3 scripts/pty_bridge.py`.
- Browser terminal lifecycle is embedded in `apps/web/src/client/main.tsx`.
- The web UI directly depends on `@xterm/xterm` and `@xterm/addon-fit`.
- Transport is currently SSE for output plus POST endpoints for input, resize, and close.
- OSC 52 clipboard forwarding is implemented through xterm parser hooks.

## Principles

- Prefer one PTY implementation on the server. A hidden Python fallback makes failures harder to diagnose and doubles the process model.
- Treat Ghostty Web as a compatibility-engine experiment, not a blanket xterm replacement.
- Keep xterm.js available until Ghostty Web passes real ThreadVM workloads.
- Avoid rewiring transport and renderer at the same time unless a renderer requirement forces it.
- Keep terminal semantics and lifecycle testable outside the full UI.

## Phase 1: Remove Python From The Server PTY Path

1. Move server-only terminal bridge code out of `packages/shared` if shared package boundaries start leaking server dependencies into the web build.
   - Preferred short-term destination: `apps/server/src/services/TerminalBridge.ts`.
   - Acceptable interim state: leave the service in `packages/shared` if the web package never imports that subpath.
2. Delete the child-process fallback path from `TerminalBridge`.
   - Remove `spawn` and `ChildProcessWithoutNullStreams` usage.
   - Remove `wrapChildProcess`.
   - Remove `ptyBridgeScript`.
   - Remove `fileURLToPath`, `existsSync`, and `Writable` imports.
3. Make `node-pty` failure explicit.
   - If `pty.spawn(...)` fails, surface a typed `TerminalBridgeError` with the command, cwd, platform, and the original cause.
   - Do not silently fall back to a non-PTY `ssh` process.
4. Remove `scripts/pty_bridge.py`.
5. Remove any README or plan references that describe Python or child-process fallback as current behavior.
6. Verify `node-pty` install/build behavior on the local platform.
   - `pnpm install`
   - `pnpm typecheck`
   - `pnpm build`
   - Attach to a mock terminal.
   - Attach to a real exe.dev VM.
   - Resize the terminal.
   - Close/restart a session and confirm the PTY process exits.

Acceptance criteria:

- `rg "pty_bridge|python3|wrapChildProcess|ChildProcessWithoutNullStreams" .` returns no active implementation references.
- Terminal attach fails loudly if `node-pty` cannot spawn.
- Resize uses native `IPty.resize(cols, rows)`.
- No Python script is required to run ThreadVM.

## Phase 2: Stabilize The Terminal Contract

Before swapping renderers, extract the browser terminal contract from `main.tsx`.

Create a small adapter interface under `apps/web/src/client/terminal/`:

```ts
export interface TerminalEngine {
  open(element: HTMLElement): void;
  write(data: string): void;
  reset(): void;
  focus(): void;
  dispose(): void;
  getSize(): { cols: number; rows: number };
  fit(): void;
  onData(handler: (data: string) => void): Disposable;
  onOsc52(handler: (payload: string) => boolean): Disposable;
}
```

Implementation steps:

1. Extract current xterm setup into `xtermEngine.ts`.
2. Keep `FitAddon` inside the xterm adapter.
3. Move OSC 52 parser registration behind `onOsc52`.
4. Keep `TerminalPane` responsible for attach state, EventSource lifecycle, resize debounce, and remote cleanup.
5. Add a renderer selection point:
   - `localStorage.threadvm.terminalEngine`
   - optional env default such as `VITE_TERMINAL_ENGINE`
   - valid values: `xterm`, `ghostty`
6. Default to `xterm`.

Acceptance criteria:

- `TerminalPane` no longer imports `@xterm/xterm` directly.
- Switching the engine flag with `xterm` preserves existing behavior.
- Attach, reconnect, restart, resize, close, and OSC 52 still work.

## Phase 3: Add Ghostty Web Behind A Feature Flag

Ghostty Web should enter as an experiment with a clear fallback.

Implementation steps:

1. Verify the current Ghostty Web package name, version, initialization API, and bundler requirements before coding.
2. Add the dependency only to `apps/web`.
3. Create `ghosttyEngine.ts`.
4. Initialize WASM asynchronously before opening the terminal.
5. Teach the adapter to report loading and initialization failures.
6. Configure Vite to serve the WASM asset correctly.
7. Document any CSP requirements for local and packaged builds.
8. If Ghostty Web lacks an equivalent for an xterm feature, mark that feature unsupported in the adapter instead of spreading conditionals through `TerminalPane`.
9. Fall back to xterm if Ghostty initialization fails.

Known risks to validate:

- WASM initialization latency.
- Additional WASM asset deployment and cache behavior.
- Canvas 2D renderer performance under heavy output.
- Selection, copy/paste, IME, mobile input, and accessibility maturity.
- xterm addon parity, especially fit behavior, OSC handlers, web links, search, and serialization.
- API compatibility gaps despite xterm-compatible goals.

Acceptance criteria:

- `xterm` remains the default engine.
- `ghostty` can be enabled without changing server code.
- Initialization failure leaves the user with a working xterm terminal.
- Bundle output includes the WASM asset intentionally, not accidentally.

## Phase 4: Workload Test Matrix

Run both engines through the same scenarios and record results in this file or a follow-up note.

Required scenarios:

- Large streaming logs.
- `vim` and `nvim`.
- `tmux`.
- Mouse-heavy TUIs.
- Resize storms.
- OSC 52 clipboard.
- Copy/paste from selection.
- Shell prompt redraws and alternate screen transitions.
- Unicode and grapheme-heavy text:
  - Arabic.
  - Devanagari.
  - combining marks.
  - emoji sequences.
  - zero-width joiners.
  - characters with visual overhang.
- Agent CLIs and Effect tooling.
- Mobile input, if mobile support matters.
- Screen-reader behavior, if accessibility support matters.

Record for each:

- xterm result.
- Ghostty Web result.
- visible rendering differences.
- input or clipboard differences.
- performance observations.
- blocker severity.

## Phase 5: Rollout Decision

Make Ghostty Web the default only if it is materially better on the workloads ThreadVM cares about.

Default-switch requirements:

- No critical regressions in attach, input, resize, reconnect, close, or clipboard.
- Real improvement on Unicode, modern TUI, or escape-sequence correctness.
- Acceptable bundle and initialization cost.
- Clear fallback path remains available.
- The adapter interface does not need renderer-specific branches in core terminal UI code.

Do not switch defaults solely because Ghostty Web has a native Ghostty parser. The value must show up in ThreadVM's actual terminal workloads.

## Later Transport Work

The renderer migration does not require changing transport immediately. Keep SSE plus POST until it becomes a measurable problem.

Consider WebSocket or Effect RPC later if:

- POST-per-input becomes too chatty for real workloads.
- bidirectional lifecycle is awkward to reason about.
- backpressure becomes visible.
- terminal session cleanup remains fragile.
- provisioning and terminal streams should share one RPC substrate.

When changing transport, preserve the same browser terminal adapter contract so renderer work and transport work remain separate.

## First Implementation Slice

1. Remove Python fallback from `TerminalBridge`.
2. Delete `scripts/pty_bridge.py`.
3. Typecheck and smoke-test attach/resize/close.
4. Extract `xtermEngine.ts` behind a minimal adapter.
5. Add the engine flag with only `xterm` implemented.
6. Add Ghostty Web as an opt-in adapter.
7. Run the workload matrix before changing defaults.
