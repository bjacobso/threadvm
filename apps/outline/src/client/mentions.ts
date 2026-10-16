// `@agent` mentions and `#tags`, through the shared text-intelligence vocabulary.
import type { TextSpan } from "@foldworks/outliner";
import { Mentions, segments } from "@foldworks/text-intelligence";

import { agentInfo, AGENT_IDS } from "../shared/agents.ts";
import type { Items } from "../shared/protocol.ts";
import { walk } from "../shared/tree.ts";

const entities: ReadonlyArray<Mentions.Entity> = AGENT_IDS.map((id) => ({
  id,
  kind: "mention",
  name: id,
  label: `${agentInfo(id).name} · ${agentInfo(id).harness}`,
  description: agentInfo(id).description,
}));

const tagCache = new WeakMap<Items, ReadonlyArray<string>>();
const tagsOf = (items: Items): ReadonlyArray<string> => {
  const cached = tagCache.get(items);
  if (cached !== undefined) return cached;
  const tags = Mentions.tagsIn(walk(items).map((node) => node.text));
  tagCache.set(items, tags);
  return tags;
};

export const dataFor = (items: Items): Mentions.Data => ({
  entities,
  tags: tagsOf(items),
  unknownMention: (name) =>
    `No agent named @${name}. Try @claude, @cursor, @codex, or @conductor.`,
});

/** Painted spans for a bullet, with each agent mention colored as its agent. */
export const spansOf = (
  text: string,
  data: Mentions.Data,
): ReadonlyArray<TextSpan> | undefined => {
  const { tokens } = Mentions.analyze(text, data);
  if (tokens.length === 0) return undefined;
  const marks = Mentions.recognize(text);
  return segments(text, { tokens }).map((part) => {
    const token = part.covering.tokens[0];
    if (token === undefined) return { text: part.text };
    const mark = marks.find((candidate) => candidate.from === token.from);
    const agent =
      mark?.kind === "mention" ? Mentions.resolve(mark, data)?.id : undefined;
    return {
      text: part.text,
      kind: agent === undefined ? token.kind : `agent-${agent}`,
    };
  });
};

export const diagnosticsOf = (text: string, data: Mentions.Data) =>
  Mentions.analyze(text, data).diagnostics;

export const suggestionsAt = (items: Items, text: string, caret: number) => {
  const query = Mentions.queryAt(text, caret);
  return query === undefined
    ? undefined
    : Mentions.suggestions(query, text, dataFor(items));
};

export const describeAt = (
  items: Items,
  text: string,
  offset: number,
  lenient: boolean,
) => Mentions.describe(text, offset, dataFor(items), {}, lenient);
