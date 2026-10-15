import { Context, Effect, Layer } from "effect";
import { mkdir, readFile, writeFile, rename, rm, stat, appendFile } from "node:fs/promises";
import { join, resolve, dirname, relative } from "node:path";
import { CommandService } from "./CommandService.js";

export class OutlineError extends Error {
  readonly _tag = "OutlineError";
}
export const outlineIO = <A>(work: () => Promise<A>) => Effect.tryPromise({
  try: work, catch: (cause) => new OutlineError(cause instanceof Error ? cause.message : String(cause))
});
export const atomicWrite = async (path: string, content: string) => {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
};

// A filesystem lock coordinates independently launched CLI and server processes.
const acquire = async (path: string) => {
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(path);
      await writeFile(join(path, "owner"), String(process.pid));
      return;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      try {
        const owner = Number(await readFile(join(path, "owner"), "utf8"));
        if (Number.isInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") {
              await rm(path, { recursive: true, force: true });
              continue;
            }
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const info = await stat(path).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > 30_000) {
          await rm(path, { recursive: true, force: true });
          continue;
        }
      }
      if (Date.now() - started > 35_000) throw new OutlineError("Timed out waiting for thoughts repository writer");
      await new Promise((done) => setTimeout(done, 25));
    }
  }
};

export class ThoughtsRepo extends Context.Service<ThoughtsRepo, {
  readonly projectDir: string;
  readonly dir: string;
  readonly init: Effect.Effect<void, OutlineError>;
  readonly git: (args: ReadonlyArray<string>) => Effect.Effect<string, OutlineError>;
  readonly projectGit: (args: ReadonlyArray<string>) => Effect.Effect<string, OutlineError>;
  readonly withLock: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E | OutlineError, R>;
  readonly remoteAdd: (name: string, url: string) => Effect.Effect<string, OutlineError>;
  readonly push: (remote?: string, branch?: string) => Effect.Effect<string, OutlineError>;
}>()("ThoughtsRepo") {}

export const ThoughtsRepoLive = (projectDir = process.env.THREADVM_PROJECT_DIR ?? process.cwd()) => Layer.effect(
  ThoughtsRepo, Effect.gen(function* () {
    const commands = yield* CommandService;
    const project = resolve(projectDir);
    const dir = join(project, ".threadvm");
    const exec = (cwd: string, args: ReadonlyArray<string>) => commands.execFile("git", args, { cwd, timeoutMs: 60_000 }).pipe(
      Effect.map((r) => r.stdout.trimEnd()),
      Effect.mapError((e) => new OutlineError(`${e.message}: ${e.stderr}`))
    );
    const git = (args: ReadonlyArray<string>) => exec(dir, args);
    const projectGit = (args: ReadonlyArray<string>) => exec(project, args);
    const withLock: ThoughtsRepo["Service"]["withLock"] = (work) => Effect.scoped(
      Effect.acquireRelease(outlineIO(() => acquire(join(dir, ".writer-lock"))),
        () => outlineIO(() => rm(join(dir, ".writer-lock"), { recursive: true, force: true })).pipe(Effect.orDie)
      ).pipe(Effect.andThen(work))
    );
    const init = Effect.gen(function* () {
      yield* outlineIO(() => mkdir(dir, { recursive: true }));
      yield* withLock(Effect.gen(function* () {
        const excludePath = resolve(project, yield* projectGit(["rev-parse", "--git-path", "info/exclude"]));
        const top = yield* projectGit(["rev-parse", "--show-toplevel"]);
        const ignored = `/${relative(top, dir).split("\\").join("/")}/`;
        yield* outlineIO(async () => {
          await mkdir(dirname(excludePath), { recursive: true });
          const content = await readFile(excludePath, "utf8").catch(() => "");
          if (!content.split("\n").includes(ignored)) await appendFile(excludePath, `\n${ignored}\n`);
        });
        yield* git(["init", "--initial-branch=main"]);
        yield* git(["config", "user.name", "ThreadVM"]);
        yield* git(["config", "user.email", "threadvm@localhost"]);
        yield* outlineIO(() => writeFile(join(dir, ".gitignore"), "events.jsonl\nruns/\ntranscripts/\nworktrees/\n.writer-lock/\n*.tmp\n"));
        yield* outlineIO(async () => {
          try { await stat(join(dir, "events.jsonl")); }
          catch (cause) {
            if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
            await writeFile(join(dir, "events.jsonl"), "");
          }
        });
      }));
    });
    return {
      projectDir: project, dir, init, git, projectGit, withLock,
      remoteAdd: (name, url) => git(["remote", "add", "--", name, url]),
      push: (remote = "origin", branch = "main") => git(["push", "--", remote, branch])
    };
  })
);
