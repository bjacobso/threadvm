import { AtomRef } from "effect/unstable/reactivity";
import { useMemo, useSyncExternalStore } from "react";
import type {
  ProjectModel,
  TerminalAttachResponseModel,
  ThreadVmModel
} from "@threadvm/shared/domain";
import { threadVmApi } from "./apiClient";
import { readStored, writeStored } from "./storage";

export type TerminalStatus =
  | "detached"
  | "connecting"
  | "attached"
  | "disconnected"
  | "exited";

export type ClipboardNotice =
  | { readonly status: "copied"; readonly message: string }
  | { readonly status: "pending"; readonly message: string; readonly text: string }
  | { readonly status: "failed"; readonly message: string };

export interface TerminalSessionState {
  readonly status: TerminalStatus;
  readonly attach: TerminalAttachResponseModel | undefined;
}

export interface TerminalUiState {
  readonly clipboardNotice: ClipboardNotice | undefined;
  readonly focusedPanel: "inventory" | "terminal" | "inspector";
}

export interface ProjectConfigState {
  readonly projects: ReadonlyArray<ProjectModel>;
  readonly loading: boolean;
  readonly error: string | undefined;
}

export interface ReconciliationState {
  readonly status: "idle" | "refreshing" | "succeeded" | "failed";
  readonly lastStartedAt: number | undefined;
  readonly lastFinishedAt: number | undefined;
  readonly error: string | undefined;
}

export const selectedVmKey = "threadvm.selectedVmId";
export const activeTerminalVmKey = "threadvm.activeTerminalVmId";

export const projectConfigAtom = AtomRef.make<ProjectConfigState>({
  projects: [],
  loading: false,
  error: undefined
});
export const threadVmsAtom = AtomRef.make<ReadonlyArray<ThreadVmModel>>([]);
export const inventoryLoadingAtom = AtomRef.make(false);
export const inventoryErrorAtom = AtomRef.make<string | undefined>(undefined);
export const reconciliationAtom = AtomRef.make<ReconciliationState>({
  status: "idle",
  lastStartedAt: undefined,
  lastFinishedAt: undefined,
  error: undefined
});
export const selectedThreadVmIdAtom = AtomRef.make<string | undefined>(
  readStored(selectedVmKey)
);
export const terminalUiAtom = AtomRef.make<TerminalUiState>({
  clipboardNotice: undefined,
  focusedPanel: "terminal"
});

const emptyTerminalSessionAtom = AtomRef.make<TerminalSessionState>({
  status: "detached",
  attach: undefined
});

const terminalSessionAtoms = new Map<string, AtomRef.AtomRef<TerminalSessionState>>();

export const terminalSessionAtomFamily = (threadVmId: string | undefined) => {
  if (threadVmId === undefined) {
    return emptyTerminalSessionAtom;
  }
  const existing = terminalSessionAtoms.get(threadVmId);
  if (existing) {
    return existing;
  }
  const created = AtomRef.make<TerminalSessionState>({
    status: "detached",
    attach: undefined
  });
  terminalSessionAtoms.set(threadVmId, created);
  return created;
};

export const useAtomRef = <A,>(ref: AtomRef.ReadonlyRef<A>): A =>
  useSyncExternalStore(
    (listener) => ref.subscribe(listener),
    () => ref.value,
    () => ref.value
  );

export const useSelectedThreadVm = () => {
  const threadVms = useAtomRef(threadVmsAtom);
  const selectedId = useAtomRef(selectedThreadVmIdAtom);

  return useMemo(
    () => threadVms.find((threadVm) => threadVm.id === selectedId),
    [selectedId, threadVms]
  );
};

export const setSelectedThreadVmId = (threadVmId: string | undefined) => {
  selectedThreadVmIdAtom.set(threadVmId);
  writeStored(selectedVmKey, threadVmId);
};

export const loadProjectConfigAtom = {
  run: async () => {
    projectConfigAtom.update((current) => ({
      ...current,
      loading: true,
      error: undefined
    }));
    try {
      const projects = await threadVmApi.listProjects();
      projectConfigAtom.set({
        projects,
        loading: false,
        error: undefined
      });
    } catch (cause) {
      projectConfigAtom.update((current) => ({
        ...current,
        loading: false,
        error: cause instanceof Error ? cause.message : String(cause)
      }));
    }
  }
} as const;

export const refreshThreadVmsAtom = {
  run: async () => {
    const startedAt = Date.now();
    inventoryLoadingAtom.set(true);
    inventoryErrorAtom.set(undefined);
    reconciliationAtom.set({
      status: "refreshing",
      lastStartedAt: startedAt,
      lastFinishedAt: undefined,
      error: undefined
    });

    try {
      const nextThreadVms = await threadVmApi.listThreadVms();
      threadVmsAtom.set(nextThreadVms);
      const selectedId = selectedThreadVmIdAtom.value;
      const preferred = selectedId ?? nextThreadVms[0]?.id;
      setSelectedThreadVmId(
        nextThreadVms.some((threadVm) => threadVm.id === preferred)
          ? preferred
          : nextThreadVms[0]?.id
      );
      reconciliationAtom.set({
        status: "succeeded",
        lastStartedAt: startedAt,
        lastFinishedAt: Date.now(),
        error: undefined
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      inventoryErrorAtom.set(message);
      reconciliationAtom.set({
        status: "failed",
        lastStartedAt: startedAt,
        lastFinishedAt: Date.now(),
        error: message
      });
    } finally {
      inventoryLoadingAtom.set(false);
    }
  }
} as const;
