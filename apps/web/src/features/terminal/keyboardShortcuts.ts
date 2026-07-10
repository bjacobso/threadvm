export type TerminalShortcutAction = "attach" | "restart";

interface TerminalShortcutEvent {
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly key: string;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

export const terminalShortcutAction = (
  event: TerminalShortcutEvent
): TerminalShortcutAction | undefined => {
  if (event.key !== "Enter" || event.altKey) {
    return undefined;
  }

  if (!event.metaKey && !event.ctrlKey) {
    return undefined;
  }

  return event.shiftKey ? "restart" : "attach";
};
