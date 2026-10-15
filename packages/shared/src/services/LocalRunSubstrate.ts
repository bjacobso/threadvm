/** Compatibility for existing API consumers. New code depends on normalized AgentRuns. */
export {
  AgentRuns as LocalRunSubstrate,
  AgentRunsLive as LocalRunSubstrateLive,
} from "./AgentRuns.js";
export type { StartOptions } from "./AgentRuns.js";
