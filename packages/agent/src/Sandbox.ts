import type { PlatformError } from "effect/PlatformError";
import { Context, Effect, Layer, Scope, Stream, Sink } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import type { SandboxRef } from "@threadvm/shared/domain";
import {
  executeSsh,
  cloneExeSandbox,
  stopExeSandbox,
  destroyExeSandbox,
} from "@threadvm/shared/services/SshBridge";
import { sshCommand } from "@threadvm/shared/services/SshTransport";

export type { SandboxRef };
export class SandboxError extends Error {
  readonly _tag = "SandboxError";
}
const io = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: (e) => new SandboxError(String(e)) });
const execute = promisify(execFile);
export const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}
/** JSON-RPC does not require a process handle: these bytes may come from SSH or a websocket. */
export interface ByteDuplex {
  readonly stdout: Stream.Stream<Uint8Array, PlatformError>;
  readonly stderr: Stream.Stream<Uint8Array, PlatformError>;
  readonly stdin: Sink.Sink<void, Uint8Array, never, PlatformError>;
  readonly exitCode: Effect.Effect<number, PlatformError>;
  readonly kill: () => Effect.Effect<void, PlatformError>;
}
export interface SpawnOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}
export interface WorkspaceSpec {
  readonly ref: SandboxRef;
  readonly baseRef: string;
  readonly repository?: string;
  readonly baseDevbox?: string;
  readonly bootstrap?: ReadonlyArray<string>;
}
export interface TerminalAttach {
  readonly sessionName: string;
  readonly reused: boolean;
  readonly command: {
    readonly file: string;
    readonly args: ReadonlyArray<string>;
  };
}
export interface Sandbox {
  readonly ref: SandboxRef;
  readonly workdir: string;
  readonly spawn: (
    command: string,
    args: ReadonlyArray<string>,
    options?: SpawnOptions,
  ) => Effect.Effect<ByteDuplex, SandboxError, Scope.Scope>;
  readonly exec: (
    script: string,
    options?: SpawnOptions,
  ) => Effect.Effect<CommandResult, SandboxError>;
  readonly readFile: (path: string) => Effect.Effect<string, SandboxError>;
  readonly writeFile: (
    path: string,
    content: string,
  ) => Effect.Effect<void, SandboxError>;
  readonly pty: Effect.Effect<TerminalAttach, SandboxError>;
  readonly exposePort: (port: number) => Effect.Effect<string, SandboxError>;
  readonly git: {
    readonly pushBranch: (remote: string) => Effect.Effect<void, SandboxError>;
    readonly fetchBranch: (
      remote: string,
      branch: string,
    ) => Effect.Effect<void, SandboxError>;
  };
  readonly stop: Effect.Effect<void, SandboxError>;
  readonly destroy: Effect.Effect<void, SandboxError>;
}
export interface SandboxProvider {
  readonly id: SandboxRef["provider"];
  readonly capabilities: {
    readonly pty: boolean;
    readonly ports: boolean;
    readonly persistentDisk: boolean;
    readonly snapshots: boolean;
  };
  readonly provision: (
    spec: WorkspaceSpec,
  ) => Effect.Effect<Sandbox, SandboxError>;
  readonly attach: (ref: SandboxRef) => Effect.Effect<Sandbox, SandboxError>;
}
export class Sandboxes extends Context.Service<
  Sandboxes,
  { readonly provider: (id: SandboxRef["provider"]) => SandboxProvider }
>()("Sandboxes") {}
const checkPort = (port: number) =>
  Number.isInteger(port) && port > 0 && port < 65536;

const RegistryLive = Layer.effect(
  Sandboxes,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const attach = (ref: SandboxRef): Effect.Effect<Sandbox, SandboxError> =>
      Effect.sync(() => {
        const remote = ref.provider === "exe";
        const shell = (script: string, options: SpawnOptions = {}) => {
          const cwd = options.cwd ?? ref.workdir;
          const env = Object.entries(options.env ?? {})
            .map(([k, v]) => {
              if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
                throw new SandboxError("Invalid environment variable");
              return `${k}=${quote(v)}`;
            })
            .join(" ");
          return `cd ${quote(cwd)} && ( ${env ? `export ${env}; ` : ""}${script}
)`;
        };
        const command = (script: string, options?: SpawnOptions) =>
          remote
            ? sshCommand(ref.host!, shell(script, options))
            : { file: "bash", args: ["-c", shell(script, options)] };
        const exec = (script: string, options?: SpawnOptions) =>
          io(async () => {
            if (remote)
              return await executeSsh(ref.host!, shell(script, options));
            const cmd = command(script, options);
            const result = await execute(cmd.file, [...cmd.args], {
              maxBuffer: 8 * 1024 * 1024,
              timeout: 120_000,
            });
            return { ...result, exitCode: 0 };
          });
        const path = (name: string) => {
          const value = resolve(ref.workdir, name);
          if (relative(ref.workdir, value).startsWith(".."))
            throw new SandboxError("File path escapes sandbox workspace");
          return value;
        };
        const tmux = (args: string[]) =>
          exec(`tmux ${args.map(quote).join(" ")}`);
        const sandbox: Sandbox = {
          ref,
          workdir: ref.workdir,
          spawn: (file, args, options = {}) => {
            const cmd = remote
              ? command([file, ...args].map(quote).join(" "), options)
              : { file, args };
            return spawner
              .spawn(
                ChildProcess.make(cmd.file, [...cmd.args], {
                  cwd: remote ? undefined : (options.cwd ?? ref.workdir),
                  env: remote
                    ? process.env
                    : { ...process.env, ...options.env },
                  extendEnv: true,
                }),
              )
              .pipe(Effect.mapError((e) => new SandboxError(String(e))));
          },
          exec,
          readFile: (name) =>
            remote
              ? exec(`cat -- ${quote(path(name))}`).pipe(
                  Effect.map((r) => r.stdout),
                )
              : io(() => readFile(path(name), "utf8")),
          writeFile: (name, content) =>
            remote
              ? exec(
                  `mkdir -p -- ${quote(dirname(path(name)))} && printf '%s' ${quote(Buffer.from(content).toString("base64"))} | base64 -d > ${quote(path(name))}`,
                ).pipe(Effect.asVoid)
              : io(async () => {
                  await mkdir(dirname(path(name)), { recursive: true });
                  await writeFile(path(name), content);
                }),
          pty: Effect.sync(() => ({
            sessionName: ref.sessionName,
            reused: true,
            command: remote
              ? sshCommand(
                  ref.host!,
                  `tmux attach-session -t ${quote(ref.sessionName)}`,
                  true,
                )
              : {
                  file: "tmux",
                  args: ["attach-session", "-t", ref.sessionName],
                },
          })),
          exposePort: (port) =>
            checkPort(port)
              ? Effect.succeed(
                  `${remote ? "https" : "http"}://${remote ? ref.host : "127.0.0.1"}:${port}`,
                )
              : Effect.fail(new SandboxError("Invalid port")),
          git: {
            pushBranch: (remoteName) =>
              exec(
                `git push ${quote(remoteName)} HEAD:${quote(ref.branch)}`,
              ).pipe(Effect.asVoid),
            fetchBranch: (remoteName, branch) =>
              exec(`git fetch ${quote(remoteName)} ${quote(branch)}`).pipe(
                Effect.asVoid,
              ),
          },
          stop: ref.vmId
            ? io(() => stopExeSandbox(ref.vmId!))
            : tmux(["kill-session", "-t", ref.sessionName]).pipe(Effect.asVoid),
          destroy: Effect.gen(function* () {
            yield* tmux(["kill-session", "-t", ref.sessionName]).pipe(
              Effect.ignore,
            );
            if (ref.vmId) yield* io(() => destroyExeSandbox(ref.vmId!));
            else if (remote)
              yield* exec(`rm -rf -- ${quote(ref.workdir)}`, { cwd: "/tmp" });
            else
              yield* io(async () => {
                await execute("git", [
                  "-C",
                  ref.projectDir,
                  "worktree",
                  "remove",
                  "--force",
                  ref.workdir,
                ]);
              });
          }),
        };
        return sandbox;
      });
    const provider = (id: SandboxRef["provider"]): SandboxProvider => {
      if (id === "vercel" || id === "cloudflare")
        return {
          id,
          capabilities: {
            pty: false,
            ports: false,
            persistentDisk: false,
            snapshots: false,
          },
          provision: () =>
            Effect.fail(
              new SandboxError(
                `${id} sandbox provider is a typed stub; configure credentials and implement its transport`,
              ),
            ),
          attach: () =>
            Effect.fail(
              new SandboxError(`${id} sandbox provider is not implemented`),
            ),
        };
      return {
        id,
        capabilities: {
          pty: true,
          ports: true,
          persistentDisk: true,
          snapshots: false,
        },
        attach,
        provision: (spec) =>
          Effect.gen(function* () {
            let { ref } = spec;
            if (id === "exe" && !ref.host && spec.baseDevbox) {
              const vm = yield* io(() =>
                cloneExeSandbox(
                  spec.baseDevbox!,
                  `threadvm-${ref.id.slice(0, 8)}`,
                ),
              );
              ref = { ...ref, host: vm.host, vmId: vm.id };
            }
            if (id === "local")
              yield* io(async () => {
                await mkdir(dirname(ref.workdir), { recursive: true });
                await execute("git", [
                  "-C",
                  ref.projectDir,
                  "worktree",
                  "add",
                  "-b",
                  ref.branch,
                  ref.workdir,
                  spec.baseRef,
                ]);
              });
            else {
              if (!ref.host || !spec.repository)
                return yield* Effect.fail(
                  new SandboxError(
                    "exe provisioning requires host and reachable repository",
                  ),
                );
              const cmd = sshCommand(
                ref.host,
                `git clone -- ${quote(spec.repository)} ${quote(ref.workdir)} && cd ${quote(ref.workdir)} && git checkout -b ${quote(ref.branch)} ${quote(spec.baseRef)}`,
              );
              yield* io(() => execute(cmd.file, [...cmd.args]));
            }
            const sandbox = yield* attach(ref);
            for (const script of spec.bootstrap ?? [])
              yield* sandbox.exec(script);
            yield* sandbox.exec(
              `tmux new-session -d -s ${quote(ref.sessionName)} -c ${quote(ref.workdir)} && tmux set-option -t ${quote(ref.sessionName)} remain-on-exit on`,
            );
            return sandbox;
          }),
      };
    };
    return { provider };
  }),
);

export class LocalSandboxProvider extends Context.Service<
  LocalSandboxProvider,
  SandboxProvider
>()("LocalSandboxProvider") {}
export class ExeSandboxProvider extends Context.Service<
  ExeSandboxProvider,
  SandboxProvider
>()("ExeSandboxProvider") {}
export class VercelSandboxProvider extends Context.Service<
  VercelSandboxProvider,
  SandboxProvider
>()("VercelSandboxProvider") {}
export class CloudflareSandboxProvider extends Context.Service<
  CloudflareSandboxProvider,
  SandboxProvider
>()("CloudflareSandboxProvider") {}
export const SandboxProvidersLive = Layer.mergeAll(
  RegistryLive,
  Layer.effect(
    LocalSandboxProvider,
    Effect.map(Sandboxes, (r) => r.provider("local")),
  ).pipe(Layer.provide(RegistryLive)),
  Layer.effect(
    ExeSandboxProvider,
    Effect.map(Sandboxes, (r) => r.provider("exe")),
  ).pipe(Layer.provide(RegistryLive)),
  Layer.effect(
    VercelSandboxProvider,
    Effect.map(Sandboxes, (r) => r.provider("vercel")),
  ).pipe(Layer.provide(RegistryLive)),
  Layer.effect(
    CloudflareSandboxProvider,
    Effect.map(Sandboxes, (r) => r.provider("cloudflare")),
  ).pipe(Layer.provide(RegistryLive)),
);
