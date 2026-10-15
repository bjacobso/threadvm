import { ExeDevService, ExeDevServiceLive } from "./ExeDevService.js";
import { Effect, Layer } from "effect";
import { SshService, SshServiceLive } from "./SshService.js";
import { CommandServiceLive } from "./CommandService.js";
/** Plain Promise boundary: stable Effect runtime never receives beta Effect values. */
export const executeSsh = (host: string, script: string) =>
  Effect.runPromise(
    Effect.flatMap(SshService, (ssh) => ssh.exec(host, script)).pipe(
      Effect.provide(SshServiceLive.pipe(Layer.provide(CommandServiceLive))),
    ),
  );
const exeLayer = ExeDevServiceLive.pipe(Layer.provide(CommandServiceLive));
export const cloneExeSandbox = (base: string, name: string) =>
  Effect.runPromise(
    Effect.flatMap(ExeDevService, (svc) => svc.cloneVm(base, name)).pipe(
      Effect.provide(exeLayer),
    ),
  );
export const stopExeSandbox = (id: string) =>
  Effect.runPromise(
    Effect.flatMap(ExeDevService, (svc) => svc.stopVm(id)).pipe(
      Effect.provide(exeLayer),
    ),
  );
export const destroyExeSandbox = (id: string) =>
  Effect.runPromise(
    Effect.flatMap(ExeDevService, (svc) => svc.removeVm(id)).pipe(
      Effect.provide(exeLayer),
    ),
  );
