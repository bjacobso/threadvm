import { focusedPanelAtom } from "./terminalAtoms";

interface FocusableTerminal {
  readonly focus: () => void;
}

export const focusTerminalPane = (
  terminal: FocusableTerminal | null | undefined
) => {
  focusedPanelAtom.set("terminal");
  terminal?.focus();
};
