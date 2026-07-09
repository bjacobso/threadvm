import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

interface Port {
  label: string;
  port: number;
  url: string;
}

interface ThreadVm {
  id: string;
  name: string;
  host: string;
  project?: string;
  slug?: string;
  summary?: string;
  repo?: string;
  branch?: string;
  state: string;
  source: "exe" | "cache" | "mock";
  ports: Port[];
  raw?: string;
}

interface TerminalAttachResponse {
  sessionId: string;
  streamUrl: string;
  inputUrl: string;
  resizeUrl: string;
  closeUrl: string;
  status: "running" | "exited";
  reused: boolean;
  createdAt: number;
}

type TerminalStatus =
  | "detached"
  | "connecting"
  | "attached"
  | "disconnected"
  | "exited";

const activeTerminalVmKey = "threadvm.activeTerminalVmId";
const selectedVmKey = "threadvm.selectedVmId";

const decodeBase64Utf8 = (encoded: string): string => {
  const normalized = encoded
    .replace(/\s/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const parseOsc52 = (data: string): string | undefined => {
  const separator = data.indexOf(";");
  if (separator === -1) {
    return undefined;
  }

  const target = data.slice(0, separator);
  const encoded = data.slice(separator + 1);
  if (encoded === "?" || !["", "c", "p", "s", "0", "1", "2"].includes(target)) {
    return undefined;
  }

  return decodeBase64Utf8(encoded);
};

const apiJson = async <A,>(input: RequestInfo | URL, init?: RequestInit): Promise<A> => {
  const response = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as A;
};

function TerminalPane({ selected }: { selected: ThreadVm | undefined }) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const attachRef = useRef<TerminalAttachResponse | null>(null);
  const cleanupRef = useRef<((closeRemote?: boolean) => void) | null>(null);
  const resizeTimerRef = useRef<number | undefined>(undefined);
  const lastRemoteSizeRef = useRef<{ cols: number; rows: number } | undefined>(
    undefined
  );
  const autoAttachRef = useRef<string | undefined>(undefined);
  const clipboardNoticeTimerRef = useRef<number | undefined>(undefined);
  const [attach, setAttach] = useState<TerminalAttachResponse | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("detached");
  const [clipboardNotice, setClipboardNotice] = useState<
    | { readonly status: "copied"; readonly message: string }
    | { readonly status: "pending"; readonly message: string; readonly text: string }
    | { readonly status: "failed"; readonly message: string }
    | undefined
  >();

  const scheduleClipboardNoticeClear = useCallback(() => {
    if (clipboardNoticeTimerRef.current !== undefined) {
      window.clearTimeout(clipboardNoticeTimerRef.current);
    }
    clipboardNoticeTimerRef.current = window.setTimeout(() => {
      clipboardNoticeTimerRef.current = undefined;
      setClipboardNotice(undefined);
    }, 2400);
  }, []);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard API is unavailable");
        }
        await navigator.clipboard.writeText(text);
        setClipboardNotice({
          status: "copied",
          message: `Copied ${text.length.toLocaleString()} chars`
        });
        scheduleClipboardNoticeClear();
      } catch {
        setClipboardNotice({
          status: "pending",
          message: "Click to copy terminal clipboard",
          text
        });
      }
    },
    [scheduleClipboardNoticeClear]
  );

  const handleOsc52 = useCallback(
    (data: string): boolean => {
      try {
        const text = parseOsc52(data);
        if (text === undefined) {
          return true;
        }
        void copyToClipboard(text);
      } catch {
        setClipboardNotice({
          status: "failed",
          message: "Terminal clipboard payload could not be decoded"
        });
        scheduleClipboardNoticeClear();
      }
      return true;
    },
    [copyToClipboard, scheduleClipboardNoticeClear]
  );

  const sendResize = useCallback(async (current: TerminalAttachResponse, force = false) => {
    const terminal = terminalRef.current;
    if (!terminal) {
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

    await fetch(current.resizeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nextSize)
    });
  }, []);

  const cleanupAttachment = useCallback((closeRemote = false) => {
    cleanupRef.current?.(closeRemote);
    cleanupRef.current = null;
    attachRef.current = null;
    lastRemoteSizeRef.current = undefined;
    setAttach(null);
  }, []);

  const fitAndSync = useCallback(() => {
    const fit = fitRef.current;
    const terminal = terminalRef.current;
    if (!fit || !terminal) {
      return;
    }

    fit.fit();

    const current = attachRef.current;
    if (!current) {
      return;
    }

    if (resizeTimerRef.current !== undefined) {
      window.clearTimeout(resizeTimerRef.current);
    }

    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = undefined;
      void sendResize(current);
    }, 80);
  }, [sendResize]);

  useEffect(() => {
    if (!elementRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      theme: {
        background: "#111111",
        foreground: "#e8e8e8",
        cursor: "#7aa2f7",
        selectionBackground: "#333f58"
      }
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
      if (clipboardNoticeTimerRef.current !== undefined) {
        window.clearTimeout(clipboardNoticeTimerRef.current);
      }
      osc52Disposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [fitAndSync, handleOsc52]);

  useEffect(() => {
    cleanupAttachment(false);
    setStatus("detached");
    terminalRef.current?.reset();
    if (selected) {
      terminalRef.current?.writeln(`Ready to attach ${selected.name}.`);
    }
  }, [cleanupAttachment, selected?.id]);

  const attachTerminal = useCallback(async (restart = false) => {
    if (!selected) {
      return;
    }

    cleanupAttachment(false);
    setStatus("connecting");
    const terminal = terminalRef.current;
    terminal?.reset();
    terminal?.writeln(
      `${restart ? "Restarting" : "Attaching"} ${selected.name}...`
    );
    fitAndSync();

    try {
      const nextAttach = await apiJson<TerminalAttachResponse>("/api/terminal/attach", {
        method: "POST",
        body: JSON.stringify({ threadVmId: selected.id, restart })
      });
      let closed = false;

      attachRef.current = nextAttach;
      setAttach(nextAttach);
      setStatus(nextAttach.status === "exited" ? "exited" : "attached");
      localStorage.setItem(activeTerminalVmKey, selected.id);
      localStorage.setItem(selectedVmKey, selected.id);
      fitAndSync();
      await sendResize(nextAttach, true);

      const source = new EventSource(nextAttach.streamUrl);
      source.onopen = () => {
        if (!closed) {
          setStatus("attached");
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
        setStatus("exited");
        if (localStorage.getItem(activeTerminalVmKey) === selected.id) {
          localStorage.removeItem(activeTerminalVmKey);
        }
        source.close();
      });
      source.onerror = () => {
        if (closed) {
          return;
        }
        terminalRef.current?.writeln("\r\n[terminal stream disconnected]");
        setStatus("disconnected");
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
      setStatus("disconnected");
      terminal?.writeln(
        `\r\n[attach failed: ${cause instanceof Error ? cause.message : String(cause)}]`
      );
    }
  }, [cleanupAttachment, fitAndSync, selected, sendResize]);

  useEffect(() => {
    if (!selected || status !== "detached") {
      return;
    }

    const activeVmId = localStorage.getItem(activeTerminalVmKey);
    if (activeVmId !== selected.id || autoAttachRef.current === selected.id) {
      return;
    }

    autoAttachRef.current = selected.id;
    void attachTerminal(false);
  }, [attachTerminal, selected, status]);

  const primaryLabel =
    status === "disconnected"
      ? "Reconnect"
      : attach
        ? "Reconnect"
        : "Attach Terminal";

  return (
    <section className="terminal-panel">
      <div className="terminal-toolbar">
        <div>
          <strong>{selected?.name ?? "No ThreadVM selected"}</strong>
          <span className={`terminal-status ${status}`}>{status}</span>
          {attach ? (
            <span className="terminal-meta">
              {attach.reused ? "reused" : "new"} session
            </span>
          ) : null}
        </div>
        <div className="terminal-actions">
          {clipboardNotice ? (
            clipboardNotice.status === "pending" ? (
              <button
                className="clipboard-notice pending"
                onClick={() => void copyToClipboard(clipboardNotice.text)}
              >
                {clipboardNotice.message}
              </button>
            ) : (
              <span className={`clipboard-notice ${clipboardNotice.status}`}>
                {clipboardNotice.message}
              </span>
            )
          ) : null}
          <button
            disabled={!selected || status === "connecting"}
            onClick={() => void attachTerminal(false)}
          >
            {primaryLabel}
          </button>
          <button
            disabled={!selected || status === "connecting"}
            onClick={() => void attachTerminal(true)}
          >
            Restart
          </button>
        </div>
      </div>
      <div ref={elementRef} className="terminal-surface" />
    </section>
  );
}

function App() {
  const [threadVms, setThreadVms] = useState<ThreadVm[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    localStorage.getItem(selectedVmKey) ?? undefined
  );
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const selected = useMemo(
    () => threadVms.find((threadVm) => threadVm.id === selectedId),
    [threadVms, selectedId]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const nextThreadVms = await apiJson<ThreadVm[]>("/api/threadvms");
      setThreadVms(nextThreadVms);
      setSelectedId((current) => {
        const preferred =
          current ?? localStorage.getItem(selectedVmKey) ?? nextThreadVms[0]?.id;
        return nextThreadVms.some((threadVm) => threadVm.id === preferred)
          ? preferred
          : nextThreadVms[0]?.id;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header>
          <div>
            <h1>ThreadVM</h1>
            <p>exe.dev reflected workspaces</p>
          </div>
          <button onClick={() => void refresh()}>{loading ? "..." : "Refresh"}</button>
        </header>

        {error ? <div className="error">{error}</div> : null}

        <nav>
          {threadVms.map((threadVm) => (
            <button
              className={threadVm.id === selectedId ? "vm-row selected" : "vm-row"}
              key={threadVm.id}
              onClick={() => {
                localStorage.setItem(selectedVmKey, threadVm.id);
                setSelectedId(threadVm.id);
              }}
            >
              <span>{threadVm.name}</span>
              <small>{threadVm.state}</small>
            </button>
          ))}
        </nav>
      </aside>

      <TerminalPane selected={selected} />

      <aside className="inspector">
        <h2>Inspector</h2>
        {selected ? (
          <dl>
            <dt>Host</dt>
            <dd>{selected.host}</dd>
            <dt>Project</dt>
            <dd>{selected.project ?? "unknown"}</dd>
            <dt>Branch</dt>
            <dd>{selected.branch ?? "unknown"}</dd>
            <dt>Source</dt>
            <dd>{selected.source}</dd>
            <dt>Ports</dt>
            <dd>
              {selected.ports.length === 0
                ? "none"
                : selected.ports.map((port) => (
                    <a key={port.port} href={port.url}>
                      {port.label}:{port.port}
                    </a>
                  ))}
            </dd>
            <dt>Raw</dt>
            <dd className="raw">{selected.raw ?? "none"}</dd>
          </dl>
        ) : (
          <p>Select a ThreadVM.</p>
        )}
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
