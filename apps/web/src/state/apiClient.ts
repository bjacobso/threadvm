import type {
  CreateThreadVmRequestModel,
  CreateThreadVmResponseModel,
  ProjectModel,
  TerminalAttachResponseModel,
  ThreadVmModel
} from "@threadvm/shared/domain";
import {
  CreateThreadVmResponse,
  Project,
  TerminalAttachResponse,
  ThreadVm
} from "@threadvm/shared/domain";
import { Schema } from "effect";

const decodeProjects = Schema.decodeUnknownPromise(Schema.Array(Project));
const decodeThreadVms = Schema.decodeUnknownPromise(Schema.Array(ThreadVm));
const decodeCreateThreadVm =
  Schema.decodeUnknownPromise(CreateThreadVmResponse);
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
