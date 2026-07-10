import { AtomRef } from "effect/unstable/reactivity";
import { useMemo, useSyncExternalStore } from "react";
import type {
  TerminalAttachResponseModel,
  ThreadVmModel
} from "@threadvm/shared/domain";
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

export const selectedVmKey = "threadvm.selectedVmId";
export const activeTerminalVmKey = "threadvm.activeTerminalVmId";

export const threadVmsAtom = AtomRef.make<ReadonlyArray<ThreadVmModel>>([]);
export const inventoryLoadingAtom = AtomRef.make(false);
export const inventoryErrorAtom = AtomRef.make<string | undefined>(undefined);
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
