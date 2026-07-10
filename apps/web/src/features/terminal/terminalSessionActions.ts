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
  readonly restoreMouseModes: (modes: ReadonlyArray<number>) => void;
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
const outputCursorBySession = new Map<string, number>();

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

const parseStreamData = (
  data: string
): { readonly data: string; readonly cursor?: number } => {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (typeof parsed === "string") {
      return { data: parsed };
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "data" in parsed &&
      typeof parsed.data === "string"
    ) {
      return {
        data: parsed.data,
        cursor:
          "cursor" in parsed && typeof parsed.cursor === "number"
            ? parsed.cursor
            : undefined
      };
    }
  } catch {
  }
  return { data };
};

const streamUrlWithReplay = (
  url: string,
  replay: boolean,
  since: number | undefined
) => {
  const params = new URLSearchParams();
  if (replay) {
    if (since !== undefined) {
      params.set("since", String(since));
    }
  } else {
    params.set("replay", "0");
  }
  const query = params.toString();
  return query ? `${url}${url.includes("?") ? "&" : "?"}${query}` : url;
};

export const terminalSessionActionAtom = {
  cleanup: (threadVmId: string | undefined, closeRemote = false) => {
    if (!threadVmId) {
      return;
    }

    cleanupByThreadVm.get(threadVmId)?.(closeRemote);
    cleanupByThreadVm.delete(threadVmId);
    lastRemoteSizes.delete(threadVmId);
    if (closeRemote) {
      const attach = terminalSessionAtomFamily(threadVmId).value.attach;
      if (attach) {
        outputCursorBySession.delete(attach.sessionId);
      }
    }
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
    const status = terminalSessionAtomFamily(threadVmId).value.status;
    if (!attach || status !== "attached") {
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
    const previousAttach = sessionAtom.value.attach;
    terminalSessionActionAtom.cleanup(threadVm.id, false);
    sessionAtom.set({ status: "connecting", attach: undefined });

    try {
      const attach = await threadVmApi.attachTerminal(threadVm.id, restart);
      const preserveLocalTerminalState =
        !restart &&
        attach.reused &&
        previousAttach?.sessionId === attach.sessionId;
      const previousCursor = outputCursorBySession.get(attach.sessionId);
      const canResumeFromCursor =
        preserveLocalTerminalState && previousCursor !== undefined;
      const shouldReplayStream = !attach.reused || canResumeFromCursor;
      const shouldRequestRedraw = attach.reused && !canResumeFromCursor;
      let closed = false;
      const nextStatus = attach.status === "exited" ? "exited" : "attached";

      if (!preserveLocalTerminalState) {
        outputCursorBySession.delete(attach.sessionId);
        view.reset();
        view.restoreMouseModes(attach.mouseModes);
        view.writeln(`${restart ? "Restarting" : "Attaching"} ${threadVm.name}...`);
      } else {
        view.restoreMouseModes(attach.mouseModes);
      }

      sessionAtom.set({
        attach,
        status: nextStatus === "attached" ? "connecting" : nextStatus
      });
      writeStored(activeTerminalVmKey, threadVm.id);
      await terminalSessionActionAtom.resize(threadVm.id, view.getSize(), true);

      const source = new EventSource(
        streamUrlWithReplay(
          attach.streamUrl,
          shouldReplayStream,
          canResumeFromCursor ? previousCursor : undefined
        )
      );
      source.onopen = () => {
        if (!closed) {
          sessionAtom.set({ attach, status: "attached" });
          if (shouldRequestRedraw) {
            void postJson(attach.inputUrl, { data: "\f" });
          }
        }
      };
      source.onmessage = (event) => {
        const chunk = parseStreamData(event.data);
        view.write(chunk.data);
        if (chunk.cursor !== undefined) {
          outputCursorBySession.set(attach.sessionId, chunk.cursor);
        }
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
