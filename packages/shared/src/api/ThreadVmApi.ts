import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi
} from "effect/unstable/httpapi";
import { Schema } from "effect";
import {
  ApiError,
  CreateThreadVmRequest,
  CreateThreadVmResponse,
  Project,
  TerminalAttachRequest,
  TerminalAttachResponse,
  ThreadVm,
  ThreadVmLifecycleResponse
} from "../domain/schema.js";

const IdParams = Schema.Struct({
  id: Schema.String
});

const ApiErrorResponse = ApiError.pipe(HttpApiSchema.status(500));
const AcceptedThreadVmResponse = CreateThreadVmResponse.pipe(
  HttpApiSchema.status(202)
);
const AcceptedThreadVmLifecycleResponse = ThreadVmLifecycleResponse.pipe(
  HttpApiSchema.status(202)
);
const CreatedTerminalAttachResponse = TerminalAttachResponse.pipe(
  HttpApiSchema.status(201)
);

const ProjectsGroup = HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.get("list", "/projects", {
      success: Schema.Array(Project),
      error: ApiErrorResponse
    })
  )
  .prefix("/api");

const ThreadVmsGroup = HttpApiGroup.make("threadvms")
  .add(
    HttpApiEndpoint.get("list", "/threadvms", {
      success: Schema.Array(ThreadVm),
      error: ApiErrorResponse
    })
  )
  .add(
    HttpApiEndpoint.get("get", "/threadvms/:id", {
      params: IdParams,
      success: ThreadVm,
      error: ApiErrorResponse
    })
  )
  .add(
    HttpApiEndpoint.post("create", "/threadvms", {
      payload: CreateThreadVmRequest,
      success: AcceptedThreadVmResponse,
      error: ApiErrorResponse
    })
  )
  .add(
    HttpApiEndpoint.post("stop", "/threadvms/:id/stop", {
      params: IdParams,
      success: AcceptedThreadVmLifecycleResponse,
      error: ApiErrorResponse
    })
  )
  .add(
    HttpApiEndpoint.delete("remove", "/threadvms/:id", {
      params: IdParams,
      success: AcceptedThreadVmLifecycleResponse,
      error: ApiErrorResponse
    })
  )
  .prefix("/api");

const TerminalGroup = HttpApiGroup.make("terminal")
  .add(
    HttpApiEndpoint.post("attach", "/terminal/attach", {
      payload: TerminalAttachRequest,
      success: CreatedTerminalAttachResponse,
      error: ApiErrorResponse
    })
  )
  .prefix("/api");

export class ThreadVmApi extends HttpApi.make("ThreadVmApi")
  .add(ProjectsGroup)
  .add(ThreadVmsGroup)
  .add(TerminalGroup)
  .annotate(OpenApi.Summary, "ThreadVM local control API")
  .annotate(
    OpenApi.Description,
    "Effect Platform API for reflecting exe.dev ThreadVMs and attaching browser terminals."
  ) {}
