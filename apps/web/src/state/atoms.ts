import { AtomRef } from "effect/unstable/reactivity";
import { useMemo, useSyncExternalStore } from "react";
import type {
  CreateThreadVmRequestModel,
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
  readonly status: "idle" | "streaming" | "refreshing" | "succeeded" | "failed";
  readonly lastStartedAt: number | undefined;
  readonly lastFinishedAt: number | undefined;
  readonly error: string | undefined;
}

export interface ProvisioningStreamState {
  readonly status: "idle" | "streaming" | "failed";
  readonly threadVmId: string | undefined;
  readonly lastStartedAt: number | undefined;
  readonly lastObservedAt: number | undefined;
  readonly error: string | undefined;
}

export interface CreateThreadVmState {
  readonly status: "idle" | "creating" | "succeeded" | "failed";
  readonly message: string | undefined;
  readonly error: string | undefined;
  readonly createdThreadVmId: string | undefined;
}

export interface ProjectRegistryMutationState {
  readonly status: "idle" | "saving" | "removing" | "succeeded" | "failed";
  readonly projectId: string | undefined;
  readonly message: string | undefined;
  readonly error: string | undefined;
}

export interface ThreadVmLifecycleState {
  readonly status: "idle" | "running" | "succeeded" | "failed";
  readonly action: "stop" | "remove" | undefined;
  readonly threadVmId: string | undefined;
  readonly message: string | undefined;
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
export const provisioningStreamStateAtom = AtomRef.make<ProvisioningStreamState>({
  status: "idle",
  threadVmId: undefined,
  lastStartedAt: undefined,
  lastObservedAt: undefined,
  error: undefined
});
export const selectedThreadVmIdAtom = AtomRef.make<string | undefined>(
  readStored(selectedVmKey)
);
export const terminalUiAtom = AtomRef.make<TerminalUiState>({
  clipboardNotice: undefined,
  focusedPanel: "terminal"
});
export const createThreadVmAtom = AtomRef.make<CreateThreadVmState>({
  status: "idle",
  message: undefined,
  error: undefined,
  createdThreadVmId: undefined
});
export const projectRegistryMutationAtom =
  AtomRef.make<ProjectRegistryMutationState>({
    status: "idle",
    projectId: undefined,
    message: undefined,
    error: undefined
  });
export const threadVmLifecycleAtom = AtomRef.make<ThreadVmLifecycleState>({
  status: "idle",
  action: undefined,
  threadVmId: undefined,
  message: undefined,
  error: undefined
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

const setThreadVmsFromServer = (nextThreadVms: ReadonlyArray<ThreadVmModel>) => {
  threadVmsAtom.set(nextThreadVms);
  const selectedId = selectedThreadVmIdAtom.value;
  const preferred = selectedId ?? nextThreadVms[0]?.id;
  setSelectedThreadVmId(
    nextThreadVms.some((threadVm) => threadVm.id === preferred)
      ? preferred
      : nextThreadVms[0]?.id
  );
};

const upsertThreadVmFromServer = (nextThreadVm: ThreadVmModel) => {
  threadVmsAtom.update((current) => {
    const existing = current.find((threadVm) => threadVm.id === nextThreadVm.id);
    if (!existing) {
      return [nextThreadVm, ...current];
    }
    return current.map((threadVm) =>
      threadVm.id === nextThreadVm.id ? nextThreadVm : threadVm
    );
  });
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
      setThreadVmsFromServer(nextThreadVms);
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

let reconciliationStreamCleanup: (() => void) | undefined;

export const reconciliationStreamAtom = {
  start: () => {
    reconciliationStreamCleanup?.();

    const startedAt = Date.now();
    let closed = false;
    const source = new EventSource("/rpc/threadvms/reconcile");
    reconciliationAtom.set({
      status: "streaming",
      lastStartedAt: startedAt,
      lastFinishedAt: undefined,
      error: undefined
    });

    source.addEventListener("snapshot", (event) => {
      void threadVmApi
        .decodeReconciliationEvent(event.data)
        .then((snapshot) => {
          if (closed) {
            return;
          }
          inventoryLoadingAtom.set(false);
          inventoryErrorAtom.set(undefined);
          setThreadVmsFromServer(snapshot.threadVms);
          reconciliationAtom.set({
            status: "streaming",
            lastStartedAt: startedAt,
            lastFinishedAt: snapshot.observedAt,
            error: undefined
          });
        })
        .catch((cause) => {
          if (closed) {
            return;
          }
          const message = cause instanceof Error ? cause.message : String(cause);
          inventoryErrorAtom.set(message);
          reconciliationAtom.set({
            status: "failed",
            lastStartedAt: startedAt,
            lastFinishedAt: Date.now(),
            error: message
          });
        });
    });

    source.addEventListener("reconciliation-error", (event) => {
      if (closed) {
        return;
      }
      const message =
        "data" in event ? String(event.data) : "reconciliation failed";
      inventoryErrorAtom.set(message);
      reconciliationAtom.set({
        status: "failed",
        lastStartedAt: startedAt,
        lastFinishedAt: Date.now(),
        error: message
      });
    });

    source.onerror = () => {
      if (closed) {
        return;
      }
      const message = "Reconciliation stream disconnected";
      inventoryErrorAtom.set(message);
      reconciliationAtom.set({
        status: "failed",
        lastStartedAt: startedAt,
        lastFinishedAt: Date.now(),
        error: message
      });
      source.close();
      reconciliationStreamCleanup = undefined;
    };

    reconciliationStreamCleanup = () => {
      closed = true;
      source.close();
      if (reconciliationStreamCleanup) {
        reconciliationStreamCleanup = undefined;
      }
    };

    return reconciliationStreamCleanup;
  },
  stop: () => {
    reconciliationStreamCleanup?.();
  }
} as const;

let provisioningStreamCleanup: (() => void) | undefined;

export const provisioningStreamAtom = {
  start: (threadVmId: string | undefined) => {
    provisioningStreamCleanup?.();

    if (!threadVmId) {
      provisioningStreamStateAtom.set({
        status: "idle",
        threadVmId: undefined,
        lastStartedAt: undefined,
        lastObservedAt: undefined,
        error: undefined
      });
      return () => {};
    }

    const startedAt = Date.now();
    let closed = false;
    const source = new EventSource(
      `/rpc/threadvms/${encodeURIComponent(threadVmId)}/provisioning`
    );
    provisioningStreamStateAtom.set({
      status: "streaming",
      threadVmId,
      lastStartedAt: startedAt,
      lastObservedAt: undefined,
      error: undefined
    });

    source.addEventListener("provisioning", (event) => {
      void threadVmApi
        .decodeProvisioningEvent(event.data)
        .then((snapshot) => {
          if (closed) {
            return;
          }
          upsertThreadVmFromServer(snapshot.threadVm);
          provisioningStreamStateAtom.set({
            status: "streaming",
            threadVmId,
            lastStartedAt: startedAt,
            lastObservedAt: snapshot.observedAt,
            error: undefined
          });
        })
        .catch((cause) => {
          if (closed) {
            return;
          }
          provisioningStreamStateAtom.set({
            status: "failed",
            threadVmId,
            lastStartedAt: startedAt,
            lastObservedAt: Date.now(),
            error: cause instanceof Error ? cause.message : String(cause)
          });
        });
    });

    source.addEventListener("provisioning-error", (event) => {
      if (closed) {
        return;
      }
      provisioningStreamStateAtom.set({
        status: "failed",
        threadVmId,
        lastStartedAt: startedAt,
        lastObservedAt: Date.now(),
        error: "data" in event ? String(event.data) : "provisioning failed"
      });
    });

    source.onerror = () => {
      if (closed) {
        return;
      }
      provisioningStreamStateAtom.set({
        status: "failed",
        threadVmId,
        lastStartedAt: startedAt,
        lastObservedAt: Date.now(),
        error: "Provisioning stream disconnected"
      });
      source.close();
      provisioningStreamCleanup = undefined;
    };

    provisioningStreamCleanup = () => {
      closed = true;
      source.close();
      if (provisioningStreamCleanup) {
        provisioningStreamCleanup = undefined;
      }
    };

    return provisioningStreamCleanup;
  },
  stop: () => {
    provisioningStreamCleanup?.();
    provisioningStreamStateAtom.set({
      status: "idle",
      threadVmId: undefined,
      lastStartedAt: undefined,
      lastObservedAt: undefined,
      error: undefined
    });
  }
} as const;

export const createThreadVmActionAtom = {
  run: async (request: CreateThreadVmRequestModel) => {
    createThreadVmAtom.set({
      status: "creating",
      message: undefined,
      error: undefined,
      createdThreadVmId: undefined
    });

    try {
      const response = await threadVmApi.createThreadVm(request);
      threadVmsAtom.update((current) => {
        const withoutCreated = current.filter(
          (threadVm) => threadVm.id !== response.threadVm.id
        );
        return [response.threadVm, ...withoutCreated];
      });
      setSelectedThreadVmId(response.threadVm.id);
      createThreadVmAtom.set({
        status: "succeeded",
        message: response.message,
        error: undefined,
        createdThreadVmId: response.threadVm.id
      });
      return response;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      createThreadVmAtom.set({
        status: "failed",
        message: undefined,
        error: message,
        createdThreadVmId: undefined
      });
      throw cause;
    }
  },
  reset: () => {
    createThreadVmAtom.set({
      status: "idle",
      message: undefined,
      error: undefined,
      createdThreadVmId: undefined
    });
  }
} as const;

export const projectRegistryActionAtom = {
  save: async (project: ProjectModel) => {
    projectRegistryMutationAtom.set({
      status: "saving",
      projectId: project.id,
      message: undefined,
      error: undefined
    });
    try {
      const response = await threadVmApi.saveProject(project);
      projectConfigAtom.set({
        projects: response.projects,
        loading: false,
        error: undefined
      });
      projectRegistryMutationAtom.set({
        status: "succeeded",
        projectId: project.id,
        message: response.message,
        error: undefined
      });
      return response;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      projectRegistryMutationAtom.set({
        status: "failed",
        projectId: project.id,
        message: undefined,
        error: message
      });
      throw cause;
    }
  },
  remove: async (projectId: string) => {
    projectRegistryMutationAtom.set({
      status: "removing",
      projectId,
      message: undefined,
      error: undefined
    });
    try {
      const response = await threadVmApi.removeProject(projectId);
      projectConfigAtom.set({
        projects: response.projects,
        loading: false,
        error: undefined
      });
      projectRegistryMutationAtom.set({
        status: "succeeded",
        projectId,
        message: response.message,
        error: undefined
      });
      return response;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      projectRegistryMutationAtom.set({
        status: "failed",
        projectId,
        message: undefined,
        error: message
      });
      throw cause;
    }
  },
  reset: () => {
    projectRegistryMutationAtom.set({
      status: "idle",
      projectId: undefined,
      message: undefined,
      error: undefined
    });
  }
} as const;

const lifecycleStarted = (
  action: ThreadVmLifecycleState["action"],
  threadVmId: string
) => {
  threadVmLifecycleAtom.set({
    status: "running",
    action,
    threadVmId,
    message: undefined,
    error: undefined
  });
};

const lifecycleFailed = (
  action: ThreadVmLifecycleState["action"],
  threadVmId: string,
  cause: unknown
) => {
  threadVmLifecycleAtom.set({
    status: "failed",
    action,
    threadVmId,
    message: undefined,
    error: cause instanceof Error ? cause.message : String(cause)
  });
};

export const threadVmLifecycleActionAtom = {
  stop: async (threadVmId: string) => {
    lifecycleStarted("stop", threadVmId);
    try {
      const response = await threadVmApi.stopThreadVm(threadVmId);
      threadVmsAtom.update((current) =>
        current.map((threadVm) =>
          threadVm.id === response.threadVm.id ? response.threadVm : threadVm
        )
      );
      threadVmLifecycleAtom.set({
        status: "succeeded",
        action: "stop",
        threadVmId,
        message: response.message,
        error: undefined
      });
      return response;
    } catch (cause) {
      lifecycleFailed("stop", threadVmId, cause);
      throw cause;
    }
  },
  remove: async (threadVmId: string) => {
    lifecycleStarted("remove", threadVmId);
    try {
      const response = await threadVmApi.removeThreadVm(threadVmId);
      threadVmsAtom.update((current) => {
        const next = current.filter((threadVm) => threadVm.id !== threadVmId);
        if (selectedThreadVmIdAtom.value === threadVmId) {
          setSelectedThreadVmId(next[0]?.id);
        }
        return next;
      });
      threadVmLifecycleAtom.set({
        status: "succeeded",
        action: "remove",
        threadVmId,
        message: response.message,
        error: undefined
      });
      return response;
    } catch (cause) {
      lifecycleFailed("remove", threadVmId, cause);
      throw cause;
    }
  },
  reset: () => {
    threadVmLifecycleAtom.set({
      status: "idle",
      action: undefined,
      threadVmId: undefined,
      message: undefined,
      error: undefined
    });
  }
} as const;
