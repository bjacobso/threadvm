import type { AgentId } from "./protocol.ts";

export type AgentProfile = Readonly<{
  id: AgentId;
  name: string;
  /** The harness that would run it, once these are real integrations. */
  harness: string;
  description: string;
  /** Used as `data-agent` for the agent's color. */
  initials: string;
}>;

const profiles: Readonly<Record<AgentId, AgentProfile>> = {
  shell: {
    id: "shell",
    name: "Shell",
    harness: "Local tmux shell",
    description: "An interactive shell in an isolated worktree",
    initials: "Sh",
  },
  conductor: {
    id: "conductor",
    name: "Conductor",
    harness: "Conductor workspaces",
    description: "Breaks work down and runs agents in parallel",
    initials: "Co",
  },
  claude: {
    id: "claude",
    name: "Claude",
    harness: "Claude Code sandbox",
    description: "Implements changes and opens pull requests",
    initials: "Cl",
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    harness: "Cursor background agent",
    description: "Builds interfaces and shares previews",
    initials: "Cu",
  },
  codex: {
    id: "codex",
    name: "Codex",
    harness: "Codex cloud task",
    description: "Reviews code, audits, and writes tests",
    initials: "Cx",
  },
};

export const AGENTS = profiles;
export const AGENT_IDS = Object.keys(profiles) as ReadonlyArray<AgentId>;

const isAgentId = (name: string): name is AgentId =>
  Object.hasOwn(profiles, name);

/** The first agent mentioned in a bullet, such as `claude` in "@claude add tests". */
export const mentionedAgent = (
  text: string,
  available?: ReadonlyArray<string>,
): AgentId | undefined => {
  for (const match of text.matchAll(
    /(^|[\s([{,;:!?])@([a-z][a-z0-9_-]*)\b/giu,
  )) {
    const name = match[2]!.toLowerCase();
    if (isAgentId(name) || available?.includes(name)) return name;
  }
  return undefined;
};

/** The bullet without its agent mentions, for writing about the task. */
export const taskOf = (text: string): string =>
  text
    .replace(/(^|\s)@(claude|cursor|conductor|codex|shell)\b[:,]?/giu, "$1")
    .replace(/\s+/gu, " ")
    .trim();

export const sandboxOf = (text: string): string | undefined =>
  /(?:^|\s)@[a-z][a-z0-9_-]*\/([a-z][a-z0-9_-]*)\b/i.exec(text)?.[1];
export const agentInfo = (id: string): AgentProfile => {
  if (id === "cli")
    return {
      id,
      name: "CLI",
      harness: "Outline proposal",
      description: "Submitted through the CLI write path",
      initials: "CLI",
    };
  if (Object.hasOwn(profiles, id)) return profiles[id]!;
  return {
    id,
    name: id,
    harness: "ACP profile",
    description: "Configured agent profile",
    initials: id.slice(0, 2),
  };
};
