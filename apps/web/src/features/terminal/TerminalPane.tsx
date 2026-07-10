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
} from "@/state/atoms";
import { terminalShortcutAction } from "./keyboardShortcuts";
import { parseOsc52 } from "./osc52";
import { TerminalToolbar } from "./TerminalToolbar";
import { terminalSessionActionAtom } from "./terminalSessionActions";
import { terminalFontStack, xtermTheme } from "./xtermTheme";

interface TerminalPaneProps {
  readonly selected: ThreadVmModel | undefined;
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

export function TerminalPane({ selected }: TerminalPaneProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeTimerRef = useRef<number | undefined>(undefined);
  const autoAttachRef = useRef<string | undefined>(undefined);
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

  const fitAndSync = useCallback(() => {
    const fit = fitRef.current;
    const terminal = terminalRef.current;
    if (!fit || !terminal) {
      return;
    }

    fit.fit();

    if (!sessionAtom.value.attach) {
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

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: terminalFontStack,
      fontSize: 13,
      theme: xtermTheme
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    const osc52Disposable = terminal.parser.registerOscHandler(52, handleOsc52);
    terminal.open(elementRef.current);
    fit.fit();
    terminal.writeln("Select a ThreadVM and attach a VM terminal.");

    terminalRef.current = terminal;
    fitRef.current = fit;
    const dataDisposable = terminal.onData((data) => {
      void terminalSessionActionAtom.sendInput(selectedIdRef.current, data);
    });

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
      dataDisposable.dispose();
      osc52Disposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [fitAndSync, handleOsc52]);

  useEffect(() => {
    const previousId = selectedIdRef.current;
    if (previousId !== selected?.id) {
      terminalSessionActionAtom.cleanup(previousId, false);
    }
    selectedIdRef.current = selected?.id;
    terminalRef.current?.reset();
    if (selected) {
      terminalRef.current?.writeln(`Ready to attach ${selected.name}.`);
    }
  }, [selected?.id, selected?.name]);

  const attachTerminal = useCallback(
    async (restart = false) => {
      if (!selected) {
        return;
      }

      fitAndSync();
      await terminalSessionActionAtom.attach({
        threadVm: selected,
        restart,
        view: {
          reset: () => terminalRef.current?.reset(),
          write: (data) => terminalRef.current?.write(data),
          writeln: (data) => terminalRef.current?.writeln(data),
          getSize: getTerminalSize
        }
      });
    },
    [fitAndSync, getTerminalSize, selected]
  );

  useEffect(() => {
    if (!selected || session.status !== "detached") {
      return;
    }

    const activeVmId = window.localStorage.getItem(activeTerminalVmKey);
    if (activeVmId !== selected.id || autoAttachRef.current === selected.id) {
      return;
    }

    autoAttachRef.current = selected.id;
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
    <section className="grid size-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-terminal-background">
      <TerminalToolbar
        selected={selected}
        session={session}
        clipboardNotice={clipboardNotice}
        onAttach={(restart) => void attachTerminal(restart)}
        onCopyPendingClipboard={() => {
          const notice = clipboardNoticeAtom.value;
          if (notice?.status === "pending") {
            void copyToClipboard(notice.text);
          }
        }}
      />
      <div ref={elementRef} className="terminal-surface" />
    </section>
  );
}
