import type { ThreadVmModel } from "@threadvm/shared/domain";
import {
  TerminalInputMessage,
  TerminalPingMessage,
  TerminalResizeMessage,
  TerminalServerMessage
} from "@threadvm/shared/domain";
import { Schema } from "effect";
import {
  activeTerminalVmKey,
  terminalSessionAtomFamily
} from "./terminalAtoms";
import { writeStored } from "@/state/storage";

interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

interface TerminalSessionView {
  readonly replace: (message: string) => void;
  readonly write: (data: string) => void;
  readonly writeln: (data: string) => void;
  readonly getSize: () => TerminalSize | undefined;
}

interface AttachOptions {
  readonly threadVm: ThreadVmModel;
  readonly restart?: boolean;
  readonly view: TerminalSessionView;
}

interface ActiveTerminalSocket {
  readonly socket: WebSocket;
  readonly close: (forget?: boolean) => void;
}

const socketsByThreadVm = new Map<string, ActiveTerminalSocket>();
const lastRemoteSizes = new Map<string, TerminalSize>();
const decodeServerMessage = Schema.decodeUnknownSync(TerminalServerMessage);
const heartbeatIntervalMs = 15_000;

const socketBaseUrl = () => {
  const href =
    typeof window !== "undefined" && window.location
      ? window.location.href
      : "http://127.0.0.1:3333/";
  const url = new URL(href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
};

export const terminalSocketUrl = (
  threadVmId: string,
  size: TerminalSize,
  restart: boolean
) => {
  const url = socketBaseUrl();
  url.pathname = `/rpc/terminal/${encodeURIComponent(threadVmId)}/socket`;
  url.search = "";
  url.searchParams.set("cols", String(size.cols));
  url.searchParams.set("rows", String(size.rows));
  if (restart) {
    url.searchParams.set("restart", "1");
  }
  return url.toString();
};

const parseServerMessage = (data: unknown) => {
  const text = typeof data === "string" ? data : String(data);
  return decodeServerMessage(JSON.parse(text) as unknown);
};

const send = (socket: WebSocket, message: unknown) => {
  if (socket.readyState !== 1) {
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
};

export const terminalSessionActionAtom = {
  cleanup: (threadVmId: string | undefined, forget = false) => {
    if (!threadVmId) {
      return;
    }

    socketsByThreadVm.get(threadVmId)?.close(forget);
    socketsByThreadVm.delete(threadVmId);
    lastRemoteSizes.delete(threadVmId);
    terminalSessionAtomFamily(threadVmId).set({
      status: "detached",
      connection: undefined
    });

    if (forget) {
      writeStored(activeTerminalVmKey, undefined);
    }
  },

  sendInput: (threadVmId: string | undefined, data: string) => {
    if (!threadVmId) {
      return;
    }
    const session = terminalSessionAtomFamily(threadVmId).value;
    const active = socketsByThreadVm.get(threadVmId);
    if (!active || session.status !== "attached") {
      return;
    }
    send(active.socket, new TerminalInputMessage({ type: "input", data }));
  },

  resize: (
    threadVmId: string | undefined,
    size: TerminalSize | undefined,
    force = false
  ) => {
    if (!threadVmId || !size) {
      return;
    }
    const session = terminalSessionAtomFamily(threadVmId).value;
    const active = socketsByThreadVm.get(threadVmId);
    if (!active || session.status !== "attached") {
      return;
    }

    const lastSize = lastRemoteSizes.get(threadVmId);
    if (
      !force &&
      lastSize?.cols === size.cols &&
      lastSize.rows === size.rows
    ) {
      return;
    }

    if (
      send(
        active.socket,
        new TerminalResizeMessage({
          type: "resize",
          cols: size.cols,
          rows: size.rows
        })
      )
    ) {
      lastRemoteSizes.set(threadVmId, size);
    }
  },

  attach: ({ threadVm, restart = false, view }: AttachOptions) => {
    const sessionAtom = terminalSessionAtomFamily(threadVm.id);
    terminalSessionActionAtom.cleanup(threadVm.id, false);
    view.replace(`${restart ? "Restarting" : "Attaching"} ${threadVm.name}...`);
    const size = view.getSize() ?? { cols: 120, rows: 32 };
    const socket = new WebSocket(terminalSocketUrl(threadVm.id, size, restart));
    let closedByClient = false;
    let ready = false;
    let heartbeat: number | undefined;

    sessionAtom.set({ status: "connecting", connection: undefined });

    const close = (forget = false) => {
      if (closedByClient) {
        return;
      }
      closedByClient = true;
      if (heartbeat !== undefined) {
        window.clearInterval(heartbeat);
      }
      socket.close(1000, "browser-detached");
      if (forget) {
        writeStored(activeTerminalVmKey, undefined);
      }
    };

    socketsByThreadVm.set(threadVm.id, { socket, close });

    socket.onopen = () => {
      heartbeat = window.setInterval(() => {
        send(
          socket,
          new TerminalPingMessage({ type: "ping", timestamp: Date.now() })
        );
      }, heartbeatIntervalMs);
    };

    socket.onmessage = (event) => {
      try {
        const message = parseServerMessage(event.data);
        switch (message.type) {
          case "ready":
            ready = true;
            sessionAtom.set({
              status: "connecting",
              connection: {
                attachmentId: message.attachmentId,
                sessionName: message.sessionName,
                createdAt: message.createdAt,
                reused: message.reused
              }
            });
            lastRemoteSizes.set(threadVm.id, size);
            writeStored(activeTerminalVmKey, threadVm.id);
            break;
          case "output":
            view.write(message.data);
            break;
          case "status":
            sessionAtom.set({
              status: message.status,
              connection: sessionAtom.value.connection
            });
            break;
          case "error":
            view.writeln(`\r\n[terminal error: ${message.message}]`);
            sessionAtom.set({
              status: "disconnected",
              connection: sessionAtom.value.connection
            });
            break;
          case "pong":
            break;
        }
      } catch (cause) {
        view.writeln(
          `\r\n[terminal protocol error: ${cause instanceof Error ? cause.message : String(cause)}]`
        );
        socket.close(1008, "invalid-server-message");
      }
    };

    socket.onerror = () => {
      if (closedByClient) {
        return;
      }
      sessionAtom.set({
        status: "disconnected",
        connection: sessionAtom.value.connection
      });
    };

    socket.onclose = (event) => {
      if (heartbeat !== undefined) {
        window.clearInterval(heartbeat);
      }
      if (socketsByThreadVm.get(threadVm.id)?.socket === socket) {
        socketsByThreadVm.delete(threadVm.id);
      }
      lastRemoteSizes.delete(threadVm.id);
      if (closedByClient) {
        return;
      }
      const exited = event.reason === "terminal-exited";
      sessionAtom.set({
        status: exited ? "exited" : "disconnected",
        connection: sessionAtom.value.connection
      });
      view.writeln(
        `\r\n[terminal ${exited ? "exited" : ready ? "disconnected" : "attach failed"}]`
      );
    };
  }
} as const;
