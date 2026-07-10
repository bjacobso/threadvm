import { Context, Effect, Layer, Queue, Scope, Stream } from "effect";
import * as pty from "node-pty";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";
import { TerminalAttachResponse, ThreadVm } from "../domain/schema.js";

export class TerminalBridgeError {
  readonly _tag = "TerminalBridgeError";

  constructor(readonly message: string, readonly cause?: unknown) {}
}

interface TerminalSession {
  readonly id: string;
  readonly vm: ThreadVm;
  readonly process: TerminalProcess;
  readonly createdAt: number;
  status: "running" | "exited";
  buffer: string;
  bufferStart: number;
  modeParserTail: string;
  readonly mouseModes: Set<number>;
  outputCursor: number;
  readonly listeners: Set<(data: string) => void>;
  readonly exitListeners: Set<() => void>;
}

interface TerminalProcess {
  readonly write: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly kill: () => void;
  readonly onData: (handler: (data: string) => void) => { readonly dispose: () => void };
  readonly onExit: (handler: () => void) => { readonly dispose: () => void };
}

export class TerminalBridge extends Context.Service<
  TerminalBridge,
  {
    readonly attach: (
      vm: ThreadVm,
      options?: { readonly restart?: boolean }
    ) => Effect.Effect<TerminalAttachResponse, TerminalBridgeError>;
    readonly stream: (
      sessionId: string,
      options?: { readonly replay?: boolean; readonly since?: number }
    ) => Effect.Effect<Stream.Stream<Uint8Array>, TerminalBridgeError>;
    readonly write: (
      sessionId: string,
      data: string
    ) => Effect.Effect<void, TerminalBridgeError>;
    readonly resize: (
      sessionId: string,
      cols: number,
      rows: number
    ) => Effect.Effect<void, TerminalBridgeError>;
    readonly close: (sessionId: string) => Effect.Effect<void, TerminalBridgeError>;
  }
>()("TerminalBridge") {}

const sessions = new Map<string, TerminalSession>();
const sessionsByVm = new Map<string, string>();
const maxBufferBytes = 200_000;
const mouseReportingModes = new Set([9, 1000, 1002, 1003, 1005, 1006, 1015]);

const commandForVm = (vm: ThreadVm): { file: string; args: ReadonlyArray<string> } => {
  const override = process.env.THREADVM_TERMINAL_COMMAND;
  if (override) {
    return { file: process.env.SHELL ?? "sh", args: ["-lc", override] };
  }

  if (vm.source === "mock") {
    return {
      file: process.env.SHELL ?? "sh",
      args: [
        "-lc",
        `printf 'ThreadVM diagnostic terminal\\nexe.dev listing failed or is unavailable.\\n\\n'; exec ${process.env.SHELL ?? "sh"}`
      ]
    };
  }

  return {
    file: "ssh",
    args: ["-o", "StrictHostKeyChecking=accept-new", vm.host]
  };
};

const sanitizeEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      const [, value] = entry;
      return typeof value === "string";
    })
  );

const wrapChildProcess = (
  child: ChildProcessWithoutNullStreams,
  control?: Writable
): TerminalProcess => ({
  write: (data) => {
    child.stdin.write(data);
  },
  resize: (cols, rows) => {
    control?.write(`${JSON.stringify({ type: "resize", cols, rows })}\n`);
  },
  kill: () => {
    child.kill();
  },
  onData: (handler) => {
    const stdout = (chunk: Buffer) => handler(chunk.toString("utf8"));
    const stderr = (chunk: Buffer) => handler(chunk.toString("utf8"));
    child.stdout.on("data", stdout);
    child.stderr.on("data", stderr);
    return {
      dispose: () => {
        child.stdout.off("data", stdout);
        child.stderr.off("data", stderr);
      }
    };
  },
  onExit: (handler) => {
    child.on("exit", handler);
    return {
      dispose: () => {
        child.off("exit", handler);
      }
    };
  }
});

const wrapPty = (terminal: pty.IPty): TerminalProcess => ({
  write: (data) => terminal.write(data),
  resize: (cols, rows) => terminal.resize(cols, rows),
  kill: () => terminal.kill(),
  onData: (handler) => terminal.onData(handler),
  onExit: (handler) => terminal.onExit(handler)
});

const ptyBridgeScript = (): string => {
  const script = fileURLToPath(
    new URL("../../../../scripts/pty_bridge.py", import.meta.url)
  );
  if (!existsSync(script)) {
    throw new TerminalBridgeError(`PTY bridge helper not found: ${script}`);
  }
  return script;
};

const spawnTerminalProcess = (
  vm: ThreadVm,
  command: { file: string; args: ReadonlyArray<string> }
): TerminalProcess => {
  const env = {
    ...sanitizeEnv(),
    THREADVM_COLS: "120",
    THREADVM_ROWS: "32"
  };
  try {
    return wrapPty(
      pty.spawn(command.file, [...command.args], {
        name: "xterm-256color",
        cols: 120,
        rows: 32,
        cwd: process.cwd(),
        env
      })
    );
  } catch (cause) {
    const child = spawn("python3", [ptyBridgeScript(), "--", command.file, ...command.args], {
      cwd: process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe", "pipe"]
    }) as ChildProcessWithoutNullStreams & { readonly stdio: ReadonlyArray<unknown> };
    return wrapChildProcess(child, child.stdio[3] as Writable | undefined);
  }
};

const attachResponse = (
  session: TerminalSession,
  reused: boolean
): TerminalAttachResponse =>
  new TerminalAttachResponse({
    sessionId: session.id,
    streamUrl: `/rpc/terminal/${session.id}/stream`,
    inputUrl: `/rpc/terminal/${session.id}/input`,
    resizeUrl: `/rpc/terminal/${session.id}/resize`,
    closeUrl: `/rpc/terminal/${session.id}`,
    status: session.status,
    reused,
    mouseModes: Array.from(session.mouseModes).sort((a, b) => a - b),
    createdAt: session.createdAt
  });

const rememberTerminalModes = (session: TerminalSession, data: string) => {
  const input = session.modeParserTail + data;
  const modePattern = /\x1b\[\?([0-9;]+)([hl])/g;
  let match: RegExpExecArray | null;
  while ((match = modePattern.exec(input)) !== null) {
    const [, rawModes, operation] = match;
    for (const rawMode of rawModes.split(";")) {
      const mode = Number(rawMode);
      if (!mouseReportingModes.has(mode)) {
        continue;
      }
      if (operation === "h") {
        session.mouseModes.add(mode);
      } else {
        session.mouseModes.delete(mode);
      }
    }
  }
  session.modeParserTail = input.slice(-64);
};

const rememberData = (session: TerminalSession, data: string) => {
  rememberTerminalModes(session, data);
  session.buffer += data;
  session.outputCursor += data.length;
  if (session.buffer.length > maxBufferBytes) {
    const trimmed = session.buffer.length - maxBufferBytes;
    session.bufferStart += trimmed;
    session.buffer = session.buffer.slice(trimmed);
  }
};

const closeSession = (session: TerminalSession) => {
  sessions.delete(session.id);
  sessionsByVm.delete(session.vm.id);
  session.process.kill();
};

const createSession = (vm: ThreadVm): TerminalSession => {
  const id = randomUUID();
  const command = commandForVm(vm);
  const term = spawnTerminalProcess(vm, command);
  const session: TerminalSession = {
    id,
    vm,
    process: term,
    createdAt: Date.now(),
    status: "running",
    buffer: "",
    bufferStart: 0,
    modeParserTail: "",
    mouseModes: new Set(),
    outputCursor: 0,
    listeners: new Set(),
    exitListeners: new Set()
  };

  sessions.set(id, session);
  sessionsByVm.set(vm.id, id);

  term.onData((data) => {
    rememberData(session, data);
    for (const listener of session.listeners) {
      listener(data);
    }
  });

  term.onExit(() => {
    session.status = "exited";
    for (const listener of session.exitListeners) {
      listener();
    }
    sessions.delete(id);
    sessionsByVm.delete(vm.id);
  });

  return session;
};

const getSession = (
  sessionId: string
): Effect.Effect<TerminalSession, TerminalBridgeError> => {
  const session = sessions.get(sessionId);
  if (session) {
    return Effect.succeed(session);
  }
  return Effect.fail(new TerminalBridgeError(`Terminal session not found: ${sessionId}`));
};

export const TerminalBridgeLive = Layer.succeed(TerminalBridge, {
  attach: (vm, options) =>
    Effect.try({
      try: () => {
        const existingId = sessionsByVm.get(vm.id);
        const existing = existingId ? sessions.get(existingId) : undefined;
        if (existing && options?.restart) {
          closeSession(existing);
        } else if (existing && existing.status === "running") {
          return attachResponse(existing, true);
        }

        return attachResponse(createSession(vm), false);
      },
      catch: (cause) => new TerminalBridgeError("Failed to attach terminal", cause)
    }),

  stream: (sessionId, options) =>
    getSession(sessionId).pipe(
      Effect.map((session) =>
        Stream.callback<Uint8Array>((emit) =>
          Effect.gen(function* () {
            const encoder = new TextEncoder();

            const sendData = (data: string) => {
              Queue.offerUnsafe(
                emit,
                encoder.encode(
                  `data: ${JSON.stringify({
                    cursor: session.outputCursor,
                    data
                  })}\n\n`
                )
              );
            };

            const sendExit = () => {
              Queue.offerUnsafe(
                emit,
                encoder.encode(
                  `event: exit\ndata: ${JSON.stringify({ sessionId })}\n\n`
                )
              );
            };

            if (options?.replay !== false && session.buffer.length > 0) {
              const since = options?.since;
              const replay =
                since === undefined
                  ? session.buffer
                  : session.buffer.slice(
                      Math.max(0, since - session.bufferStart)
                    );
              if (replay.length > 0) {
                sendData(replay);
              }
            }

            session.listeners.add(sendData);
            session.exitListeners.add(sendExit);

            if (session.status === "exited") {
              sendExit();
            }

            const scope = yield* Scope.Scope;
            yield* Scope.addFinalizer(
              scope,
              Effect.sync(() => {
                session.listeners.delete(sendData);
                session.exitListeners.delete(sendExit);
              })
            );
          })
        )
      )
    ),

  write: (sessionId, data) =>
    getSession(sessionId).pipe(
      Effect.flatMap((session) =>
        Effect.try({
          try: () => {
            session.process.write(data);
          },
          catch: (cause) => new TerminalBridgeError("Failed to write terminal data", cause)
        })
      )
    ),

  resize: (sessionId, cols, rows) =>
    getSession(sessionId).pipe(
      Effect.flatMap((session) =>
        Effect.try({
          try: () => {
            session.process.resize(cols, rows);
          },
          catch: (cause) => new TerminalBridgeError("Failed to resize terminal", cause)
        })
      )
    ),

  close: (sessionId) =>
    Effect.sync(() => {
      const session = sessions.get(sessionId);
      if (!session) {
        return;
      }
      closeSession(session);
    })
});
