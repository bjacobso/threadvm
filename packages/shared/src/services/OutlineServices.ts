import { Layer } from "effect";
import { CommandServiceLive } from "./CommandService.js";
import { ThoughtsRepoLive } from "./ThoughtsRepo.js";
import { OutlineStoreLive } from "./OutlineStore.js";
import { RunEventLogLive } from "./RunEventLog.js";
import { LocalRunSubstrateLive } from "./LocalRunSubstrate.js";

export const OutlineServicesLive = (projectDir?: string) => {
  const repo = ThoughtsRepoLive(projectDir).pipe(
    Layer.provide(CommandServiceLive)
  );
  const store = OutlineStoreLive.pipe(Layer.provide(repo));
  const events = RunEventLogLive.pipe(Layer.provide(repo));
  const runs = LocalRunSubstrateLive.pipe(
    Layer.provide(Layer.mergeAll(repo, store, events, CommandServiceLive))
  );
  return Layer.mergeAll(repo, store, events, runs);
};
