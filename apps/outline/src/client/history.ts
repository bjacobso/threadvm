import type { Items } from "../shared/protocol.ts";
import { flatten } from "@threadvm/outline-protocol/document";
/** Undo restores content with fresh identities after a committed deletion.
 * Tombstoned IDs may never re-enter the canonical document. Rewrite history
 * before Foldworks restores it so its native focus commands use the new IDs. */
export const renewDeletedIds = (
  outline: import("@foldworks/outliner").Outliner.Model,
  tombstones: Readonly<Record<string, number>>,
  fresh: () => string,
): import("@foldworks/outliner").Outliner.Model => {
  const aliases = new Map<string, string>();
  for (const items of [
    outline.items,
    ...outline.history.past.map((s) => s.items),
    ...outline.history.future.map((s) => s.items),
  ])
    for (const node of flatten(items))
      if (Object.hasOwn(tombstones, node.id) && !aliases.has(node.id))
        aliases.set(node.id, fresh());
  if (aliases.size === 0) return outline;
  const id = (value: string) => aliases.get(value) ?? value;
  const items = (value: Items): Items =>
    value.map((node) => ({
      ...node,
      id: id(node.id),
      children: items(node.children),
    }));
  const focus = (value: typeof outline.focus) =>
    value === null ? null : { ...value, id: id(value.id) };
  const snapshot = (value: (typeof outline.history.past)[number]) => ({
    items: items(value.items),
    focus: focus(value.focus),
  });
  return {
    ...outline,
    items: items(outline.items),
    focus: focus(outline.focus),
    scopeId: outline.scopeId === null ? null : id(outline.scopeId),
    selection:
      outline.selection === null
        ? null
        : {
            anchorId: id(outline.selection.anchorId),
            headId: id(outline.selection.headId),
          },
    drag: null,
    hover: null,
    completion: null,
    history: {
      ...outline.history,
      past: outline.history.past.map(snapshot),
      future: outline.history.future.map(snapshot),
    },
  };
};
