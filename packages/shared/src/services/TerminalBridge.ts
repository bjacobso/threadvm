import {
  Context,
  Deferred,
  Effect,
  Layer,
  Queue,
  Scope,
  Stream
} from "effect";
import * as pty from "node-pty";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";
import type { ThreadVm } from "../domain/schema.js";
import {
  RemoteTerminalSession,
  type TerminalCommand
} from "./RemoteTerminalSession.js";

export class TerminalBridgeError {
  readonly _tag = "TerminalBridgeError";

  constructor(readonly message: string, readonly cause?: unknown) {}
}

interface TerminalProcess {
  readonly write: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly kill: () => void;
  readonly onData: (
    handler: (data: string) => void
  ) => { readonly dispose: () => void };
  readonly onExit: (
    handler: () => void
  ) => { readonly dispose: () => void };
}

export interface TerminalAttachment {
  readonly id: string;
  readonly threadVmId: string;
  readonly sessionName: string;
  readonly reused: boolean;
  readonly createdAt: number;
  readonly output: Stream.Stream<string>;
  readonly exited: Effect.Effect<"process-exited" | "replaced", TerminalBridgeError>;
  readonly write: (data: string) => Effect.Effect<void, TerminalBridgeError>;
  readonly resize: (
    cols: number,
    rows: number
  ) => Effect.Effect<void, TerminalBridgeError>;
}

export class TerminalBridge extends Context.Service<
  TerminalBridge,
  {
    readonly open: (
      vm: ThreadVm,
      options: {
        readonly cols: number;
        readonly rows: number;
        readonly restart?: boolean;
      }
    ) => Effect.Effect<
      TerminalAttachment,
      TerminalBridgeError,
      Scope.Scope
    >;
  }
>()("TerminalBridge") {}

interface ActiveAttachment {
  readonly id: string;
  readonly close: (reason: "replaced" | "detached") => void;
}

const activeAttachments = new Map<string, ActiveAttachment>();
const outputQueueCapacity = 256;

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
  command: TerminalCommand,
  cols: number,
  rows: number
): TerminalProcess => {
  const env = {
    ...sanitizeEnv(),
    ...command.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    THREADVM_COLS: String(cols),
    THREADVM_ROWS: String(rows)
  };
  try {
    return wrapPty(
      pty.spawn(command.file, [...command.args], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: process.cwd(),
        env
      })
    );
  } catch {
    const child = spawn(
      "python3",
      [ptyBridgeScript(), "--", command.file, ...command.args],
      {
        cwd: process.cwd(),
        env,
        stdio: ["pipe", "pipe", "pipe", "pipe"]
      }
    ) as ChildProcessWithoutNullStreams & {
      readonly stdio: ReadonlyArray<unknown>;
    };
    return wrapChildProcess(child, child.stdio[3] as Writable | undefined);
  }
};

const processOperation = (
  message: string,
  operation: () => void
): Effect.Effect<void, TerminalBridgeError> =>
  Effect.try({
    try: operation,
    catch: (cause) => new TerminalBridgeError(message, cause)
  });

export const TerminalBridgeLive = Layer.effect(
  TerminalBridge,
  Effect.gen(function* () {
    const remoteSessions = yield* RemoteTerminalSession;

    const open: TerminalBridge["Service"]["open"] = (vm, options) =>
      Effect.gen(function* () {
        const prepared = yield* remoteSessions
          .prepare(vm, { restart: options.restart })
          .pipe(
            Effect.mapError(
              (cause) =>
                new TerminalBridgeError(
                  `Failed to prepare terminal for ${vm.name}`,
                  cause
                )
            )
          );
        const outputQueue = yield* Queue.bounded<string>(outputQueueCapacity);
        const exited = yield* Deferred.make<
          "process-exited" | "replaced",
          TerminalBridgeError
        >();
        const id = randomUUID();

        const resource = yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              activeAttachments.get(vm.id)?.close("replaced");
              const process = spawnTerminalProcess(
                prepared.command,
                options.cols,
                options.rows
              );
              let closed = false;
              const close = (reason: "replaced" | "detached") => {
                if (closed) {
                  return;
                }
                closed = true;
                process.kill();
                Deferred.doneUnsafe(
                  exited,
                  Effect.succeed(
                    reason === "replaced" ? "replaced" : "process-exited"
                  )
                );
              };
              const dataSubscription = process.onData((data) => {
                if (!Queue.offerUnsafe(outputQueue, data)) {
                  Deferred.doneUnsafe(
                    exited,
                    Effect.fail(
                      new TerminalBridgeError(
                        `Terminal output queue overflowed for ${vm.name}`
                      )
                    )
                  );
                  close("detached");
                }
              });
              const exitSubscription = process.onExit(() => {
                Deferred.doneUnsafe(exited, Effect.succeed("process-exited"));
              });
              const active = { id, close };
              activeAttachments.set(vm.id, active);
              return {
                process,
                active,
                dataSubscription,
                exitSubscription,
                close
              };
            },
            catch: (cause) =>
              new TerminalBridgeError(
                `Failed to spawn terminal for ${vm.name}`,
                cause
              )
          }),
          ({ active, close, dataSubscription, exitSubscription }) =>
            Effect.sync(() => {
              dataSubscription.dispose();
              exitSubscription.dispose();
              close("detached");
              if (activeAttachments.get(vm.id)?.id === active.id) {
                activeAttachments.delete(vm.id);
              }
            }).pipe(Effect.andThen(Queue.shutdown(outputQueue)), Effect.asVoid)
        );

        const attachment: TerminalAttachment = {
          id,
          threadVmId: vm.id,
          sessionName: prepared.sessionName,
          reused: prepared.reused,
          createdAt: Date.now(),
          output: Stream.fromQueue(outputQueue),
          exited: Deferred.await(exited),
          write: (data) =>
            processOperation("Failed to write terminal data", () => {
              resource.process.write(data);
            }),
          resize: (cols, rows) =>
            processOperation("Failed to resize terminal", () => {
              resource.process.resize(cols, rows);
            })
        };

        yield* Effect.log("Terminal attachment opened").pipe(
          Effect.annotateLogs({
            threadVmId: vm.id,
            attachmentId: id,
            sessionName: prepared.sessionName,
            reused: prepared.reused,
            cols: options.cols,
            rows: options.rows
          })
        );

        return attachment;
      });

    return { open } as const;
  })
);
