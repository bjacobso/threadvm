import type {
  CreateThreadVmRequestModel,
  CreateThreadVmResponseModel,
  ProjectModel,
  TerminalAttachResponseModel,
  ThreadVmLifecycleResponseModel,
  ThreadVmProvisioningEventModel,
  ThreadVmReconciliationEventModel,
  ThreadVmModel
} from "@threadvm/shared/domain";
import {
  CreateThreadVmResponse,
  Project,
  TerminalAttachResponse,
  ThreadVm,
  ThreadVmLifecycleResponse,
  ThreadVmProvisioningEvent,
  ThreadVmReconciliationEvent
} from "@threadvm/shared/domain";
import { Schema } from "effect";

const decodeProjects = Schema.decodeUnknownPromise(Schema.Array(Project));
const decodeThreadVms = Schema.decodeUnknownPromise(Schema.Array(ThreadVm));
const decodeCreateThreadVm =
  Schema.decodeUnknownPromise(CreateThreadVmResponse);
const decodeThreadVmLifecycle =
  Schema.decodeUnknownPromise(ThreadVmLifecycleResponse);
const decodeThreadVmReconciliationEvent = Schema.decodeUnknownPromise(
  ThreadVmReconciliationEvent
);
const decodeThreadVmProvisioningEvent = Schema.decodeUnknownPromise(
  ThreadVmProvisioningEvent
);
const decodeTerminalAttach = Schema.decodeUnknownPromise(TerminalAttachResponse);

const apiJson = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<unknown> => {
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

  return await response.json();
};

export const threadVmApi = {
  listProjects: async (): Promise<ReadonlyArray<ProjectModel>> =>
    await decodeProjects(await apiJson("/api/projects")),
  listThreadVms: async (): Promise<ReadonlyArray<ThreadVmModel>> =>
    await decodeThreadVms(await apiJson("/api/threadvms")),
  createThreadVm: async (
    request: CreateThreadVmRequestModel
  ): Promise<CreateThreadVmResponseModel> =>
    await decodeCreateThreadVm(
      await apiJson("/api/threadvms", {
        method: "POST",
        body: JSON.stringify(request)
      })
    ),
  stopThreadVm: async (
    threadVmId: string
  ): Promise<ThreadVmLifecycleResponseModel> =>
    await decodeThreadVmLifecycle(
      await apiJson(`/api/threadvms/${encodeURIComponent(threadVmId)}/stop`, {
        method: "POST"
      })
    ),
  removeThreadVm: async (
    threadVmId: string
  ): Promise<ThreadVmLifecycleResponseModel> =>
    await decodeThreadVmLifecycle(
      await apiJson(`/api/threadvms/${encodeURIComponent(threadVmId)}`, {
        method: "DELETE"
      })
    ),
  decodeReconciliationEvent: async (
    data: string
  ): Promise<ThreadVmReconciliationEventModel> =>
    await decodeThreadVmReconciliationEvent(JSON.parse(data)),
  decodeProvisioningEvent: async (
    data: string
  ): Promise<ThreadVmProvisioningEventModel> =>
    await decodeThreadVmProvisioningEvent(JSON.parse(data)),
  attachTerminal: async (
    threadVmId: string,
    restart = false
  ): Promise<TerminalAttachResponseModel> =>
    await decodeTerminalAttach(
      await apiJson("/api/terminal/attach", {
        method: "POST",
        body: JSON.stringify({ threadVmId, restart })
      })
    )
};
