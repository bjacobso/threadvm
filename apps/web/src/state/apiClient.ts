import type {
  CreateThreadVmRequestModel,
  CreateThreadVmResponseModel,
  ProjectModel,
  ProjectRegistryResponseModel,
  ThreadVmDevLogResponseModel,
  ThreadVmLifecycleResponseModel,
  ThreadVmPortsResponseModel,
  ThreadVmProvisioningEventModel,
  ThreadVmReconciliationEventModel,
  ThreadVmModel
} from "@threadvm/shared/domain";
import { ThreadVmApi } from "@threadvm/shared/api";
import {
  CreateThreadVmRequest,
  Project,
  ThreadVmProvisioningEvent,
  ThreadVmReconciliationEvent
} from "@threadvm/shared/domain";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { Effect, Schema } from "effect";

const decodeThreadVmReconciliationEvent = Schema.decodeUnknownPromise(
  ThreadVmReconciliationEvent
);
const decodeThreadVmProvisioningEvent = Schema.decodeUnknownPromise(
  ThreadVmProvisioningEvent
);

const baseUrl =
  typeof window === "undefined"
    ? "http://127.0.0.1:3333"
    : window.location.origin;

const clientPromise = Effect.runPromise(
  HttpApiClient.make(ThreadVmApi, { baseUrl }).pipe(
    Effect.provide(FetchHttpClient.layer)
  )
);

const formatApiError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error(JSON.stringify(error));
};

const runApiEffect = async <A>(
  effect: Effect.Effect<A, unknown, never>
): Promise<A> => {
  try {
    return await Effect.runPromise(effect);
  } catch (error) {
    throw formatApiError(error);
  }
};

export const apiPayloads = {
  project: (project: ProjectModel): Project => new Project(project),
  createThreadVmRequest: (
    request: CreateThreadVmRequestModel
  ): CreateThreadVmRequest => new CreateThreadVmRequest(request)
};

export const threadVmApi = {
  listProjects: async (): Promise<ReadonlyArray<ProjectModel>> =>
    await runApiEffect((await clientPromise).projects.list()),
  saveProject: async (
    project: ProjectModel
  ): Promise<ProjectRegistryResponseModel> =>
    await runApiEffect(
      (await clientPromise).projects.save({
        params: { id: project.id },
        payload: apiPayloads.project(project)
      })
    ),
  removeProject: async (
    projectId: string
  ): Promise<ProjectRegistryResponseModel> =>
    await runApiEffect(
      (await clientPromise).projects.remove({ params: { id: projectId } })
    ),
  listThreadVms: async (): Promise<ReadonlyArray<ThreadVmModel>> =>
    await runApiEffect((await clientPromise).threadvms.list()),
  readDevLog: async (threadVmId: string): Promise<ThreadVmDevLogResponseModel> =>
    await runApiEffect(
      (await clientPromise).threadvms.devLog({ params: { id: threadVmId } })
    ),
  checkPorts: async (threadVmId: string): Promise<ThreadVmPortsResponseModel> =>
    await runApiEffect(
      (await clientPromise).threadvms.ports({ params: { id: threadVmId } })
    ),
  createThreadVm: async (
    request: CreateThreadVmRequestModel
  ): Promise<CreateThreadVmResponseModel> =>
    await runApiEffect(
      (await clientPromise).threadvms.create({
        payload: apiPayloads.createThreadVmRequest(request)
      })
    ),
  stopThreadVm: async (
    threadVmId: string
  ): Promise<ThreadVmLifecycleResponseModel> =>
    await runApiEffect(
      (await clientPromise).threadvms.stop({ params: { id: threadVmId } })
    ),
  removeThreadVm: async (
    threadVmId: string
  ): Promise<ThreadVmLifecycleResponseModel> =>
    await runApiEffect(
      (await clientPromise).threadvms.remove({ params: { id: threadVmId } })
    ),
  decodeReconciliationEvent: async (
    data: string
  ): Promise<ThreadVmReconciliationEventModel> =>
    await decodeThreadVmReconciliationEvent(JSON.parse(data)),
  decodeProvisioningEvent: async (
    data: string
  ): Promise<ThreadVmProvisioningEventModel> =>
    await decodeThreadVmProvisioningEvent(JSON.parse(data))
};
