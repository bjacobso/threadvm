import { focusedPanelAtom } from "./terminalAtoms";

interface FocusableTerminal {
  readonly element?: HTMLElement;
  readonly focus: () => void;
}

export const focusTerminalPane = (
  terminal: FocusableTerminal | null | undefined
) => {
  focusedPanelAtom.set("terminal");
  terminal?.focus();
};

export const forwardSurfaceMouseDownToTerminal = (
  _event: MouseEvent,
  terminal: FocusableTerminal | null | undefined,
  _surface: HTMLElement | null | undefined
) => {
  focusedPanelAtom.set("terminal");
  terminal?.focus();
};
