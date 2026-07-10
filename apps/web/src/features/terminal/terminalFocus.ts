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

export const forwardSurfaceMouseEventToTerminal = (
  event: MouseEvent,
  terminal: FocusableTerminal | null | undefined,
  surface: HTMLElement | null | undefined
) => {
  focusedPanelAtom.set("terminal");

  const terminalElement = terminal?.element;
  if (!terminal || !terminalElement || !surface) {
    terminal?.focus();
    return;
  }

  if (
    typeof Node !== "undefined" &&
    event.target instanceof Node &&
    terminalElement.contains(event.target)
  ) {
    terminal.focus();
    return;
  }

  event.preventDefault();
  terminal.focus();
  terminalElement.dispatchEvent(
    new MouseEvent(event.type, {
      bubbles: true,
      cancelable: true,
      button: event.button,
      buttons: event.buttons,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      detail: event.detail,
      metaKey: event.metaKey,
      relatedTarget: event.relatedTarget,
      screenX: event.screenX,
      screenY: event.screenY,
      shiftKey: event.shiftKey,
      altKey: event.altKey
    })
  );
};
