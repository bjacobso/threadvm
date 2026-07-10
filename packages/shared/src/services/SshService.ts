import { Context, Effect, Layer } from "effect";
import { CommandError, CommandService, type CommandResult } from "./CommandService.js";

export class SshError {
  readonly _tag = "SshError";

  constructor(
    readonly host: string,
    readonly message: string,
    readonly cause?: unknown
  ) {}
}

export class SshService extends Context.Service<
  SshService,
  {
    readonly exec: (
      host: string,
      script: string,
      options?: { readonly timeoutMs?: number }
    ) => Effect.Effect<CommandResult, SshError>;
  }
>()("SshService") {}

const shellQuote = (input: string) => `'${input.replace(/'/g, `'\\''`)}'`;

const toSshError = (host: string, command: string) => (cause: CommandError) =>
  new SshError(
    host,
    `ssh ${host} failed while running ${command}`,
    cause
  );

export const SshServiceLive = Layer.effect(
  SshService,
  Effect.gen(function* () {
    const command = yield* CommandService;

    const exec = (
      host: string,
      script: string,
      options?: { readonly timeoutMs?: number }
    ) => {
      if (process.env.THREADVM_SSH_MOCK === "1") {
        return Effect.succeed({
          stdout:
            process.env.THREADVM_SSH_MOCK_STDOUT ??
            "THREADVM_LOG_FULL\nmock dev log\n",
          stderr: process.env.THREADVM_SSH_MOCK_STDERR ?? "",
          exitCode: Number(process.env.THREADVM_SSH_MOCK_EXIT_CODE ?? "0")
        });
      }

      const remoteCommand = `bash -lc ${shellQuote(script)}`;
      return command
        .execFile("ssh", [host, remoteCommand], {
          timeoutMs: options?.timeoutMs ?? 120_000
        })
        .pipe(Effect.mapError(toSshError(host, remoteCommand)));
    };

    return { exec } as const;
  })
);
