import { useCallback, useEffect, useMemo, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { ThreadVmModel } from "@threadvm/shared/domain";
import { toast } from "sonner";
import {
  activeTerminalVmKey,
  terminalSessionAtomFamily,
  terminalUiAtom,
  useAtomRef
} from "@/state/atoms";
import { threadVmApi } from "@/state/apiClient";
import { writeStored } from "@/state/storage";
import { parseOsc52 } from "./osc52";
import { TerminalToolbar } from "./TerminalToolbar";
import { terminalFontStack, xtermTheme } from "./xtermTheme";

interface TerminalPaneProps {
  readonly selected: ThreadVmModel | undefined;
}

export function TerminalPane({ selected }: TerminalPaneProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<((closeRemote?: boolean) => void) | null>(null);
  const resizeTimerRef = useRef<number | undefined>(undefined);
  const lastRemoteSizeRef = useRef<{ cols: number; rows: number } | undefined>(
    undefined
  );
  const autoAttachRef = useRef<string | undefined>(undefined);
  const sessionAtom = useMemo(
    () => terminalSessionAtomFamily(selected?.id),
    [selected?.id]
  );
  const session = useAtomRef(sessionAtom);

  const setSession = useCallback(
    (next: typeof session) => {
      sessionAtom.set(next);
    },
    [sessionAtom]
  );

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is unavailable");
      }
      await navigator.clipboard.writeText(text);
      terminalUiAtom.update((current) => ({
        ...current,
        clipboardNotice: {
          status: "copied",
          message: `Copied ${text.length.toLocaleString()} chars`
        }
      }));
      toast.success("Copied terminal selection to clipboard");
    } catch {
      terminalUiAtom.update((current) => ({
        ...current,
        clipboardNotice: {
          status: "pending",
          message: "Browser blocked terminal clipboard copy",
          text
        }
      }));
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
        terminalUiAtom.update((current) => ({
          ...current,
          clipboardNotice: {
            status: "failed",
            message: "Terminal clipboard payload could not be decoded"
          }
        }));
        toast.error("Terminal clipboard payload could not be decoded");
      }
      return true;
    },
    [copyToClipboard]
  );

  const sendResize = useCallback(async (force = false) => {
    const terminal = terminalRef.current;
    const attach = sessionAtom.value.attach;
    if (!terminal || !attach) {
      return;
    }

    const nextSize = {
      cols: terminal.cols,
      rows: terminal.rows
    };
    const lastSize = lastRemoteSizeRef.current;
    if (
      !force &&
      lastSize?.cols === nextSize.cols &&
      lastSize.rows === nextSize.rows
    ) {
      return;
    }
    lastRemoteSizeRef.current = nextSize;

    await fetch(attach.resizeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nextSize)
    });
  }, [sessionAtom]);

  const cleanupAttachment = useCallback(
    (closeRemote = false) => {
      cleanupRef.current?.(closeRemote);
      cleanupRef.current = null;
      lastRemoteSizeRef.current = undefined;
      setSession({ status: "detached", attach: undefined });
    },
    [setSession]
  );

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
      void sendResize();
    }, 80);
  }, [sendResize, sessionAtom]);

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

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(fitAndSync);
    });
    observer.observe(elementRef.current);

    const onResize = () => fitAndSync();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      cleanupRef.current?.(false);
      if (resizeTimerRef.current !== undefined) {
        window.clearTimeout(resizeTimerRef.current);
      }
      osc52Disposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [fitAndSync, handleOsc52]);

  useEffect(() => {
    cleanupAttachment(false);
    terminalRef.current?.reset();
    if (selected) {
      terminalRef.current?.writeln(`Ready to attach ${selected.name}.`);
    }
  }, [cleanupAttachment, selected?.id, selected?.name]);

  const attachTerminal = useCallback(
    async (restart = false) => {
      if (!selected) {
        return;
      }

      cleanupAttachment(false);
      setSession({ status: "connecting", attach: undefined });
      const terminal = terminalRef.current;
      terminal?.reset();
      terminal?.writeln(
        `${restart ? "Restarting" : "Attaching"} ${selected.name}...`
      );
      fitAndSync();

      try {
        const nextAttach = await threadVmApi.attachTerminal(selected.id, restart);
        let closed = false;

        setSession({
          attach: nextAttach,
          status: nextAttach.status === "exited" ? "exited" : "attached"
        });
        writeStored(activeTerminalVmKey, selected.id);
        fitAndSync();
        await sendResize(true);

        const source = new EventSource(nextAttach.streamUrl);
        source.onopen = () => {
          if (!closed) {
            setSession({ attach: nextAttach, status: "attached" });
          }
        };
        source.onmessage = (event) => {
          terminalRef.current?.write(JSON.parse(event.data));
        };
        source.addEventListener("exit", () => {
          if (closed) {
            return;
          }
          terminalRef.current?.writeln("\r\n[terminal exited]");
          setSession({ attach: nextAttach, status: "exited" });
          writeStored(activeTerminalVmKey, undefined);
          source.close();
        });
        source.onerror = () => {
          if (closed) {
            return;
          }
          terminalRef.current?.writeln("\r\n[terminal stream disconnected]");
          setSession({ attach: nextAttach, status: "disconnected" });
          source.close();
        };

        const dataDisposable = terminalRef.current?.onData((data) => {
          void fetch(nextAttach.inputUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ data })
          });
        });

        cleanupRef.current = (closeRemote = false) => {
          closed = true;
          dataDisposable?.dispose();
          source.close();
          if (closeRemote) {
            void fetch(nextAttach.closeUrl, { method: "DELETE" });
          }
        };
      } catch (cause) {
        setSession({ status: "disconnected", attach: undefined });
        terminal?.writeln(
          `\r\n[attach failed: ${cause instanceof Error ? cause.message : String(cause)}]`
        );
      }
    },
    [cleanupAttachment, fitAndSync, selected, sendResize, setSession]
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

  return (
    <section className="grid size-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-terminal-background">
      <TerminalToolbar
        selected={selected}
        session={session}
        onAttach={(restart) => void attachTerminal(restart)}
      />
      <div ref={elementRef} className="terminal-surface" />
    </section>
  );
}

