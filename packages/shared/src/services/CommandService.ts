import { Context, Effect, Layer } from "effect";
import { execFile } from "node:child_process";

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export class CommandError {
  readonly _tag = "CommandError";

  constructor(
    readonly command: string,
    readonly args: ReadonlyArray<string>,
    readonly message: string,
    readonly stdout = "",
    readonly stderr = "",
    readonly exitCode?: number
  ) {}
}

export class CommandService extends Context.Service<
  CommandService,
  {
    readonly execFile: (
      command: string,
      args: ReadonlyArray<string>,
      options?: { readonly cwd?: string; readonly timeoutMs?: number }
    ) => Effect.Effect<CommandResult, CommandError>;
  }
>()("CommandService") {}

export const CommandServiceLive = Layer.succeed(CommandService, {
  execFile: (command, args, options) =>
    Effect.callback<CommandResult, CommandError>((resume) => {
      const child = execFile(
        command,
        [...args],
        {
          cwd: options?.cwd,
          timeout: options?.timeoutMs ?? 30_000,
          maxBuffer: 1024 * 1024 * 8
        },
        (error, stdout, stderr) => {
          if (error) {
            const nodeError = error as NodeJS.ErrnoException & {
              code?: number | string;
            };
            resume(
              Effect.fail(
                new CommandError(
                  command,
                  args,
                  nodeError.message,
                  stdout,
                  stderr,
                  typeof nodeError.code === "number" ? nodeError.code : undefined
                )
              )
            );
            return;
          }

          resume(
            Effect.succeed({
              stdout,
              stderr,
              exitCode: 0
            })
          );
        }
      );
      return Effect.sync(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
        }
      });
    })
});
