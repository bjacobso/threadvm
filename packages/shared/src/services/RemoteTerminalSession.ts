import { Context, Effect, Layer } from "effect";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { ThreadVm } from "../domain/schema.js";
import type { CommandResult } from "./CommandService.js";
import { SshService } from "./SshService.js";

export interface TerminalCommand {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
}

export interface PreparedRemoteTerminalSession {
  readonly sessionName: string;
  readonly reused: boolean;
  readonly command: TerminalCommand;
}

export class RemoteTerminalSessionError {
  readonly _tag = "RemoteTerminalSessionError";

  constructor(readonly message: string, readonly cause?: unknown) {}
}

export class RemoteTerminalSession extends Context.Service<
  RemoteTerminalSession,
  {
    readonly ensureInstalled: (
      vm: ThreadVm
    ) => Effect.Effect<CommandResult, RemoteTerminalSessionError>;
    readonly prepare: (
      vm: ThreadVm,
      options?: { readonly restart?: boolean }
    ) => Effect.Effect<PreparedRemoteTerminalSession, RemoteTerminalSessionError>;
    readonly terminate: (
      vm: ThreadVm
    ) => Effect.Effect<void, RemoteTerminalSessionError>;
  }
>()("RemoteTerminalSession") {}

const shellQuote = (input: string) => `'${input.replace(/'/g, `'\\''`)}'`;

export const terminalSessionName = (threadVmId: string) => {
  const slug = threadVmId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "vm";
  const hash = createHash("sha256").update(threadVmId).digest("hex").slice(0, 10);
  return `threadvm-${slug}-${hash}`;
};

const installTmuxScript = [
  "set -euo pipefail",
  "if command -v tmux >/dev/null 2>&1; then tmux -V; exit 0; fi",
  "run_root() { if command -v sudo >/dev/null 2>&1; then sudo -n \"$@\"; else \"$@\"; fi; }",
  "if command -v apt-get >/dev/null 2>&1; then",
  "  run_root apt-get update",
  "  run_root apt-get install -y tmux",
  "elif command -v apk >/dev/null 2>&1; then",
  "  run_root apk add tmux",
  "elif command -v dnf >/dev/null 2>&1; then",
  "  run_root dnf install -y tmux",
  "elif command -v yum >/dev/null 2>&1; then",
  "  run_root yum install -y tmux",
  "elif command -v brew >/dev/null 2>&1; then",
  "  brew install tmux",
  "else",
  "  echo 'tmux is required, and no supported package manager was found' >&2",
  "  exit 127",
  "fi",
  "command -v tmux >/dev/null 2>&1",
  "tmux -V"
].join("\n");

const overrideCommand = (
  sessionName: string,
  restart: boolean
): PreparedRemoteTerminalSession | undefined => {
  const override = process.env.THREADVM_TERMINAL_COMMAND;
  if (!override) {
    return undefined;
  }
  let reused = false;
  if (process.env.THREADVM_TERMINAL_LOCAL_TMUX === "1") {
    reused = spawnSync("tmux", ["has-session", "-t", sessionName], {
      stdio: "ignore"
    }).status === 0;
    if (restart && reused) {
      spawnSync("tmux", ["kill-session", "-t", sessionName], {
        stdio: "ignore"
      });
      reused = false;
    }
  }
  return {
    sessionName,
    reused,
    command: {
      file: process.env.SHELL ?? "sh",
      args: ["-lc", override],
      env: { THREADVM_SESSION_NAME: sessionName }
    }
  };
};

export const RemoteTerminalSessionLive = Layer.effect(
  RemoteTerminalSession,
  Effect.gen(function* () {
    const ssh = yield* SshService;

    const ensureInstalled = (vm: ThreadVm) => {
      if (
        process.env.THREADVM_TERMINAL_COMMAND ||
        vm.source === "mock"
      ) {
        return Effect.succeed({
          stdout: "tmux preflight skipped for local terminal command\n",
          stderr: "",
          exitCode: 0
        });
      }
      return ssh.exec(vm.host, installTmuxScript, { timeoutMs: 180_000 }).pipe(
        Effect.mapError(
          (cause) =>
            new RemoteTerminalSessionError(
              `Failed to provision tmux on ${vm.name}`,
              cause
            )
        )
      );
    };

    const prepare = (
      vm: ThreadVm,
      options?: { readonly restart?: boolean }
    ) => {
      const sessionName = terminalSessionName(vm.id);
      const override = overrideCommand(sessionName, options?.restart === true);
      if (override) {
        return Effect.succeed(override);
      }

      if (vm.source === "mock") {
        return Effect.succeed({
          sessionName,
          reused: false,
          command: {
            file: process.env.SHELL ?? "sh",
            args: [
              "-lc",
              `printf 'ThreadVM diagnostic terminal\\nexe.dev listing failed or is unavailable.\\n\\n'; exec ${process.env.SHELL ?? "sh"}`
            ]
          }
        });
      }

      const quotedName = shellQuote(sessionName);
      const inspectScript = [
        "set -euo pipefail",
        "command -v tmux >/dev/null 2>&1 || { echo 'tmux is not installed; reprovision this ThreadVM' >&2; exit 127; }",
        `if tmux has-session -t ${quotedName} 2>/dev/null; then echo reused; else echo new; fi`,
        ...(options?.restart
          ? [`tmux kill-session -t ${quotedName} 2>/dev/null || true`]
          : []),
        `if ! tmux has-session -t ${quotedName} 2>/dev/null; then tmux new-session -d -s ${quotedName} 2>/dev/null || tmux has-session -t ${quotedName}; fi`
      ].join("\n");

      return ssh.exec(vm.host, inspectScript, { timeoutMs: 30_000 }).pipe(
        Effect.map((result) => ({
          sessionName,
          reused: !options?.restart && result.stdout.trim().endsWith("reused"),
          command: {
            file: "ssh",
            args: [
              "-o",
              "StrictHostKeyChecking=accept-new",
              "-tt",
              vm.host,
              `exec tmux attach-session -t ${quotedName}`
            ]
          }
        })),
        Effect.mapError(
          (cause) =>
            new RemoteTerminalSessionError(
              `Failed to prepare terminal session for ${vm.name}`,
              cause
            )
        )
      );
    };

    const terminate = (vm: ThreadVm) => {
      if (process.env.THREADVM_TERMINAL_COMMAND || vm.source === "mock") {
        return Effect.void;
      }
      const sessionName = terminalSessionName(vm.id);
      return ssh
        .exec(
          vm.host,
          `tmux kill-session -t ${shellQuote(sessionName)} 2>/dev/null || true`,
          { timeoutMs: 30_000 }
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError(
            (cause) =>
              new RemoteTerminalSessionError(
                `Failed to terminate terminal session for ${vm.name}`,
                cause
              )
          )
        );
    };

    return { ensureInstalled, prepare, terminate } as const;
  })
);
