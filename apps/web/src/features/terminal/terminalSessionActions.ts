import type { ThreadVmModel } from "@threadvm/shared/domain";
import {
  activeTerminalVmKey,
  terminalSessionAtomFamily
} from "./terminalAtoms";
import { threadVmApi } from "@/state/apiClient";
import { writeStored } from "@/state/storage";

interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

interface TerminalSessionView {
  readonly reset: () => void;
  readonly write: (data: string) => void;
  readonly writeln: (data: string) => void;
  readonly getSize: () => TerminalSize | undefined;
}

interface AttachOptions {
  readonly threadVm: ThreadVmModel;
  readonly restart?: boolean;
  readonly view: TerminalSessionView;
}

const cleanupByThreadVm = new Map<string, (closeRemote?: boolean) => void>();
const lastRemoteSizes = new Map<string, TerminalSize>();

const postJson = async (url: string, body: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
};

const parseStreamData = (data: string) => {
  try {
    return JSON.parse(data) as string;
  } catch {
    return data;
  }
};

export const terminalSessionActionAtom = {
  cleanup: (threadVmId: string | undefined, closeRemote = false) => {
    if (!threadVmId) {
      return;
    }

    cleanupByThreadVm.get(threadVmId)?.(closeRemote);
    cleanupByThreadVm.delete(threadVmId);
    lastRemoteSizes.delete(threadVmId);
    terminalSessionAtomFamily(threadVmId).set({
      status: "detached",
      attach: undefined
    });

    if (closeRemote) {
      writeStored(activeTerminalVmKey, undefined);
    }
  },

  sendInput: async (threadVmId: string | undefined, data: string) => {
    if (!threadVmId) {
      return;
    }

    const attach = terminalSessionAtomFamily(threadVmId).value.attach;
    if (!attach) {
      return;
    }

    await postJson(attach.inputUrl, { data });
  },

  resize: async (
    threadVmId: string | undefined,
    size: TerminalSize | undefined,
    force = false
  ) => {
    if (!threadVmId || !size) {
      return;
    }

    const attach = terminalSessionAtomFamily(threadVmId).value.attach;
    if (!attach) {
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

    lastRemoteSizes.set(threadVmId, size);
    await postJson(attach.resizeUrl, size);
  },

  attach: async ({ threadVm, restart = false, view }: AttachOptions) => {
    const sessionAtom = terminalSessionAtomFamily(threadVm.id);
    terminalSessionActionAtom.cleanup(threadVm.id, false);
    sessionAtom.set({ status: "connecting", attach: undefined });

    view.reset();
    view.writeln(`${restart ? "Restarting" : "Attaching"} ${threadVm.name}...`);

    try {
      const attach = await threadVmApi.attachTerminal(threadVm.id, restart);
      let closed = false;
      const nextStatus = attach.status === "exited" ? "exited" : "attached";

      sessionAtom.set({ attach, status: nextStatus });
      writeStored(activeTerminalVmKey, threadVm.id);
      await terminalSessionActionAtom.resize(threadVm.id, view.getSize(), true);

      const source = new EventSource(attach.streamUrl);
      source.onopen = () => {
        if (!closed) {
          sessionAtom.set({ attach, status: "attached" });
        }
      };
      source.onmessage = (event) => {
        view.write(parseStreamData(event.data));
      };
      source.addEventListener("exit", () => {
        if (closed) {
          return;
        }
        view.writeln("\r\n[terminal exited]");
        sessionAtom.set({ attach, status: "exited" });
        writeStored(activeTerminalVmKey, undefined);
        source.close();
        cleanupByThreadVm.delete(threadVm.id);
        lastRemoteSizes.delete(threadVm.id);
      });
      source.onerror = () => {
        if (closed) {
          return;
        }
        view.writeln("\r\n[terminal stream disconnected]");
        sessionAtom.set({ attach, status: "disconnected" });
        source.close();
        cleanupByThreadVm.delete(threadVm.id);
        lastRemoteSizes.delete(threadVm.id);
      };

      cleanupByThreadVm.set(threadVm.id, (closeRemote = false) => {
        closed = true;
        source.close();
        if (closeRemote) {
          void fetch(attach.closeUrl, { method: "DELETE" });
        }
      });
    } catch (cause) {
      sessionAtom.set({ status: "disconnected", attach: undefined });
      view.writeln(
        `\r\n[attach failed: ${cause instanceof Error ? cause.message : String(cause)}]`
      );
    }
  }
} as const;
