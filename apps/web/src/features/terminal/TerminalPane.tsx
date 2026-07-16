import { useCallback, useEffect, useMemo, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { ThreadVmModel } from "@threadvm/shared/domain";
import { toast } from "sonner";
import {
  activeTerminalVmKey,
  clipboardNoticeAtom,
  terminalSessionAtomFamily,
  useAtomRef
} from "./terminalAtoms";
import { terminalShortcutAction } from "./keyboardShortcuts";
import { parseOsc52 } from "./osc52";
import {
  focusTerminalPane,
  forwardSurfaceMouseEventToTerminal
} from "./terminalFocus";
import { TerminalToolbar } from "./TerminalToolbar";
import { terminalSessionActionAtom } from "./terminalSessionActions";
import { terminalFontStack, xtermTheme } from "./xtermTheme";

interface TerminalPaneProps {
  readonly selected: ThreadVmModel | undefined;
  readonly onOpenDetails: () => void;
}

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
  );
};

export function TerminalPane({ selected, onOpenDetails }: TerminalPaneProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeTimerRef = useRef<number | undefined>(undefined);
  const terminalDisposablesRef = useRef<
    | {
        readonly data: { readonly dispose: () => void };
        readonly osc52: { readonly dispose: () => void };
      }
    | undefined
  >(undefined);
  const selectedIdRef = useRef<string | undefined>(selected?.id);
  const sessionAtom = useMemo(
    () => terminalSessionAtomFamily(selected?.id),
    [selected?.id]
  );
  const session = useAtomRef(sessionAtom);
  const clipboardNotice = useAtomRef(clipboardNoticeAtom);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is unavailable");
      }
      await navigator.clipboard.writeText(text);
      clipboardNoticeAtom.set({
        status: "copied",
        message: `Copied ${text.length.toLocaleString()} chars`
      });
      toast.success("Copied terminal selection to clipboard");
    } catch {
      clipboardNoticeAtom.set({
        status: "pending",
        message: "Browser blocked terminal clipboard copy",
        text
      });
      toast.warning("Terminal requested clipboard access");
    }
  }, []);

  const handleOsc52 = useCallback(
    (data: string): boolean => {
      try {
        const text = parseOsc52(data);
        if (text === undefined) {
          return true;
        }
        void copyToClipboard(text);
      } catch {
        clipboardNoticeAtom.set({
          status: "failed",
          message: "Terminal clipboard payload could not be decoded"
        });
        toast.error("Terminal clipboard payload could not be decoded");
      }
      return true;
    },
    [copyToClipboard]
  );

  const getTerminalSize = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return undefined;
    }

    return {
      cols: terminal.cols,
      rows: terminal.rows
    };
  }, []);

  const disposeTerminal = useCallback(() => {
    terminalDisposablesRef.current?.data.dispose();
    terminalDisposablesRef.current?.osc52.dispose();
    terminalDisposablesRef.current = undefined;
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitRef.current = null;
  }, []);

  const replaceTerminal = useCallback(
    (message: string) => {
      const element = elementRef.current;
      if (!element) {
        return;
      }

      disposeTerminal();
      element.replaceChildren();
      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: terminalFontStack,
        fontSize: 13,
        theme: xtermTheme
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(element);
      fit.fit();
      const osc52 = terminal.parser.registerOscHandler(52, handleOsc52);
      const data = terminal.onData((input) => {
        terminalSessionActionAtom.sendInput(selectedIdRef.current, input);
      });

      terminalRef.current = terminal;
      fitRef.current = fit;
      terminalDisposablesRef.current = { data, osc52 };
      terminal.writeln(message);
    },
    [disposeTerminal, handleOsc52]
  );

  const fitAndSync = useCallback(() => {
    const fit = fitRef.current;
    const terminal = terminalRef.current;
    if (!fit || !terminal) {
      return;
    }

    fit.fit();

    if (!sessionAtom.value.connection) {
      return;
    }

    if (resizeTimerRef.current !== undefined) {
      window.clearTimeout(resizeTimerRef.current);
    }

    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = undefined;
      void terminalSessionActionAtom.resize(
        selectedIdRef.current,
        getTerminalSize()
      );
    }, 80);
  }, [getTerminalSize, sessionAtom]);

  useEffect(() => {
    if (!elementRef.current) {
      return;
    }

    replaceTerminal("Choose a task to open its terminal.");

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(fitAndSync);
    });
    observer.observe(elementRef.current);

    const onResize = () => fitAndSync();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      terminalSessionActionAtom.cleanup(selectedIdRef.current, false);
      if (resizeTimerRef.current !== undefined) {
        window.clearTimeout(resizeTimerRef.current);
      }
      disposeTerminal();
    };
  }, [disposeTerminal, fitAndSync, replaceTerminal]);

  useEffect(() => {
    const previousId = selectedIdRef.current;
    if (previousId !== selected?.id) {
      terminalSessionActionAtom.cleanup(previousId, false);
    }
    selectedIdRef.current = selected?.id;
    if (selected) {
      replaceTerminal(`Ready to attach ${selected.name}.`);
    } else {
      replaceTerminal("Choose a task to open its terminal.");
    }
  }, [replaceTerminal, selected?.id, selected?.name]);

  const attachTerminal = useCallback(
    async (restart = false) => {
      if (!selected) {
        return;
      }

      fitAndSync();
      focusTerminalPane(terminalRef.current);
      await terminalSessionActionAtom.attach({
        threadVm: selected,
        restart,
        view: {
          replace: replaceTerminal,
          write: (data) => terminalRef.current?.write(data),
          writeln: (data) => terminalRef.current?.writeln(data),
          getSize: getTerminalSize
        }
      });
    },
    [fitAndSync, getTerminalSize, replaceTerminal, selected]
  );

  useEffect(() => {
    if (!selected || session.status !== "detached") {
      return;
    }

    const activeVmId = window.localStorage.getItem(activeTerminalVmKey);
    if (activeVmId !== selected.id) {
      return;
    }

    void attachTerminal(false);
  }, [attachTerminal, selected, session.status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !selected ||
        sessionAtom.value.status === "connecting" ||
        event.defaultPrevented ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const action = terminalShortcutAction(event);
      if (!action) {
        return;
      }

      event.preventDefault();
      void attachTerminal(action === "restart");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [attachTerminal, selected, sessionAtom]);

  return (
    <section className="grid size-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
      <TerminalToolbar
        selected={selected}
        session={session}
        clipboardNotice={clipboardNotice}
        onOpenDetails={onOpenDetails}
        onAttach={(restart) => void attachTerminal(restart)}
        onCopyPendingClipboard={() => {
          const notice = clipboardNoticeAtom.value;
          if (notice?.status === "pending") {
            void copyToClipboard(notice.text);
          }
        }}
      />
      <div className="min-h-0 min-w-0 px-3 pt-2 pb-3">
        <div
          ref={elementRef}
          className="terminal-surface rounded-xl border border-border/75"
          onMouseDown={(event) =>
            forwardSurfaceMouseEventToTerminal(
              event.nativeEvent,
              terminalRef.current,
              elementRef.current
            )
          }
          onMouseUp={(event) =>
            forwardSurfaceMouseEventToTerminal(
              event.nativeEvent,
              terminalRef.current,
              elementRef.current
            )
          }
          onPointerDownCapture={() => focusTerminalPane(terminalRef.current)}
        />
      </div>
    </section>
  );
}
