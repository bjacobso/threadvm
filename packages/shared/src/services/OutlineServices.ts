import { OutlineMcpLive } from "./OutlineMcp.js";
import { AgentConfigurationLive } from "./AgentConfiguration.js";
import { Layer } from "effect";
import { CommandServiceLive } from "./CommandService.js";
import { ThoughtsRepoLive } from "./ThoughtsRepo.js";
import { OutlineStoreLive } from "./OutlineStore.js";
import { RunEventLogLive } from "./RunEventLog.js";
import { AgentRunsLive } from "./AgentRuns.js";

export const OutlineServicesLive = (projectDir?: string) => {
  const repo = ThoughtsRepoLive(projectDir).pipe(
    Layer.provide(CommandServiceLive),
  );
  const store = OutlineStoreLive.pipe(Layer.provide(repo));
  const events = RunEventLogLive.pipe(Layer.provide(repo));
  const config = AgentConfigurationLive.pipe(Layer.provide(repo));
  const runs = AgentRunsLive.pipe(
    Layer.provide(
      Layer.mergeAll(repo, store, events, config, CommandServiceLive),
    ),
  );
  const mcp = OutlineMcpLive.pipe(Layer.provide(Layer.mergeAll(runs, store)));
  return Layer.mergeAll(repo, store, events, runs, config, mcp);
};
