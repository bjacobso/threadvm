import { Context, Effect, Layer } from "effect";
import { Port, ThreadVm } from "../domain/schema.js";
import { CommandError, CommandService } from "./CommandService.js";

export class ExeDevError {
  readonly _tag = "ExeDevError";

  constructor(readonly message: string, readonly cause?: unknown) {}
}

export class ExeDevService extends Context.Service<
  ExeDevService,
  {
    readonly listVms: Effect.Effect<ReadonlyArray<ThreadVm>, ExeDevError>;
    readonly getVm: (id: string) => Effect.Effect<ThreadVm, ExeDevError>;
    readonly cloneVm: (
      base: string,
      name: string
    ) => Effect.Effect<ThreadVm, ExeDevError>;
    readonly createVm: (
      name: string,
      image: string
    ) => Effect.Effect<ThreadVm, ExeDevError>;
    readonly stopVm: (id: string) => Effect.Effect<void, ExeDevError>;
    readonly removeVm: (id: string) => Effect.Effect<void, ExeDevError>;
  }
>()("ExeDevService") {}

const toExeError = (message: string) => (cause: unknown) =>
  new ExeDevError(message, cause);

const parseVmLine = (line: string): ThreadVm | undefined => {
  const trimmed = line.trim();
  if (
    !trimmed ||
    trimmed.endsWith(":") ||
    trimmed.startsWith("NAME") ||
    trimmed.startsWith("ID")
  ) {
    return undefined;
  }

  const parts = trimmed.split(/\s+/);
  const firstVmToken = parts[0] === "•" || parts[0] === "-" ? parts[1] : parts[0];
  if (!firstVmToken) {
    return undefined;
  }

  const host = firstVmToken.includes(".") ? firstVmToken : `${firstVmToken}.exe.xyz`;
  const name = firstVmToken.replace(/\.exe\.xyz$/, "");
  const stateToken =
    parts.find((part) =>
      [
        "running",
        "ready",
        "stopped",
        "failed",
        "creating",
        "bootstrapping"
      ].includes(part.toLowerCase())
    ) ?? "unknown";

  return new ThreadVm({
    id: name,
    name,
    host,
    state: stateToken.toLowerCase() as ThreadVm["state"],
    source: "exe",
    ports: [],
    raw: line
  });
};

const parseListOutput = (stdout: string): ReadonlyArray<ThreadVm> =>
  stdout
    .split(/\r?\n/)
    .map(parseVmLine)
    .filter((vm): vm is ThreadVm => vm !== undefined);

export const ExeDevServiceLive = Layer.effect(
  ExeDevService,
  Effect.gen(function* () {
    const command = yield* CommandService;

    const runExe = (args: ReadonlyArray<string>) =>
      command
        .execFile("ssh", ["exe.dev", ...args], { timeoutMs: 60_000 })
        .pipe(Effect.mapError(toExeError(`ssh exe.dev ${args.join(" ")} failed`)));

    const listVms = runExe(["ls"]).pipe(
      Effect.map((result) => parseListOutput(result.stdout)),
      Effect.catch((error) =>
        Effect.succeed([
          new ThreadVm({
            id: "exe-dev-unavailable",
            name: "exe.dev unavailable",
            host: "exe.dev",
            state: "unknown",
            source: "mock",
            ports: [
              new Port({
                label: "diagnostic",
                port: 0,
                url: "ssh exe.dev ls failed"
              })
            ],
            raw: error.message
          })
        ])
      )
    );

    const getVm = (id: string) =>
      listVms.pipe(
        Effect.flatMap((vms) => {
          const vm = vms.find((candidate) => candidate.id === id);
          return vm
            ? Effect.succeed(vm)
            : Effect.fail(new ExeDevError(`ThreadVM not found: ${id}`));
        })
      );

    const syntheticVm = (name: string) =>
      new ThreadVm({
        id: name,
        name,
        host: `${name}.exe.xyz`,
        state: "creating",
        source: "exe",
        ports: []
      });

    return {
      listVms,
      getVm,
      cloneVm: (base, name) =>
        runExe(["cp", base, name]).pipe(Effect.as(syntheticVm(name))),
      createVm: (name, image) =>
        runExe(["new", name, "--image", image]).pipe(Effect.as(syntheticVm(name))),
      stopVm: (id) => runExe(["stop", id]).pipe(Effect.asVoid),
      removeVm: (id) => runExe(["rm", id]).pipe(Effect.asVoid)
    } as const;
  })
);
