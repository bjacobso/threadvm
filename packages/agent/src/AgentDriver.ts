import {
  Cause,
  Fiber,
  Context,
  Deferred,
  Effect,
  Layer,
  Queue,
  Schema,
  Scope,
  Stream,
  Stdio,
  Sink,
} from "effect";
import type { AgentProfile } from "@threadvm/shared/domain";
import type { Sandbox } from "./Sandbox.ts";
import { AcpProcessExitedError, AcpTransportError } from "./acp/errors.ts";
import * as Acp from "./acp/client.ts";
import type * as Protocol from "./acp/compat.ts";
import { randomUUID } from "node:crypto";

export class AgentEvent extends Schema.Class<AgentEvent>("AgentEvent")({
  type: Schema.Literals([
    "initialized",
    "session",
    "update",
    "permission",
    "permission_resolved",
    "cancelled",
    "turn_complete",
    "turn_started",
    "question",
    "question_resolved",
  ]),
  sessionId: Schema.optional(Schema.String),
  requestId: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  options: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        kind: Schema.String,
      }),
    ),
  ),
  payload: Schema.optional(Schema.Unknown),
}) {}
export class AgentError extends Schema.TaggedError<AgentError>()("AgentError", {
  message: Schema.String,
}) {}
export interface AgentSession {
  readonly id: string;
  readonly ready: Effect.Effect<void, AgentError>;
  readonly capabilities: unknown;
  readonly events: Stream.Stream<AgentEvent>;
  readonly prompt: (text: string) => Effect.Effect<void, AgentError>;
  readonly cancel: Effect.Effect<void, AgentError>;
  readonly respondToPermission: (
    id: string,
    option: string,
  ) => Effect.Effect<void, AgentError>;
  readonly answer: (
    id: string,
    text: string,
  ) => Effect.Effect<void, AgentError>;
  readonly endEvents: Effect.Effect<void>;
}
export class AgentDriver extends Context.Service<
  AgentDriver,
  {
    readonly open: (options: {
      profile: AgentProfile;
      sandbox: Sandbox;
      sessionId?: string;
      mcpServers?: ReadonlyArray<Protocol.McpServer>;
    }) => Effect.Effect<AgentSession, AgentError, Scope.Scope>;
  }
>()("AgentDriver") {}
const failure = (e: unknown) => new AgentError({ message: String(e) });

export const AcpDriverLive = Layer.effect(
  AgentDriver,
  Effect.gen(function* () {
    return {
      open: (options) =>
        Effect.gen(function* () {
          const { profile, sandbox } = options;
          if (!profile.command)
            return yield* Effect.fail(
              new AgentError({ message: "ACP profile needs a command" }),
            );
          const handle = yield* sandbox.spawn(
            profile.command,
            profile.args ?? [],
            { env: profile.env },
          );
          // stderr is diagnostic output; stdout is exclusively JSON-RPC.
          yield* handle.stderr.pipe(
            Stream.decodeText(),
            Stream.runForEach((text) =>
              Effect.sync(() => process.stderr.write(text)),
            ),
            Effect.forkScoped,
          );
          const client = yield* Acp.make(
            Stdio.make({
              args: Effect.succeed([]),
              stdin: handle.stdout,
              stdout: () =>
                Sink.mapInput(handle.stdin, (chunk: string | Uint8Array) =>
                  typeof chunk === "string"
                    ? new TextEncoder().encode(chunk)
                    : chunk,
                ),
              stderr: () => Sink.drain,
            }),
            {},
            Effect.match(handle.exitCode, {
              onFailure: (cause) =>
                new AcpTransportError({
                  operation: "read-process-exit-status",
                  cause,
                }),
              onSuccess: (code) => new AcpProcessExitedError({ code }),
            }),
          );
          const scope = yield* Scope.Scope;
          const transportFailure = (cause: unknown) =>
            new AcpTransportError({ operation: "call-rpc", cause });
          yield* client.handleReadTextFile((r) =>
            sandbox.readFile(r.path).pipe(
              Effect.map((text) => ({
                content: text
                  .split("\n")
                  .slice(
                    (r.line ?? 1) - 1,
                    r.limit !== undefined && r.limit !== null
                      ? (r.line ?? 1) - 1 + r.limit
                      : undefined,
                  )
                  .join("\n"),
              })),
              Effect.mapError(transportFailure),
            ),
          );
          yield* client.handleWriteTextFile((r) =>
            sandbox
              .writeFile(r.path, r.content)
              .pipe(Effect.as({}), Effect.mapError(transportFailure)),
          );
          const terminals = new Map<
            string,
            {
              handle: typeof handle;
              output: Buffer;
              drained: Deferred.Deferred<void>;
              truncated: boolean;
              limit: number;
              exitCode?: number;
            }
          >();
          yield* client.handleCreateTerminal((r) =>
            Effect.gen(function* () {
              const env = Object.fromEntries(
                (r.env ?? []).map((e) => [e.name, e.value]),
              );
              const handle = yield* sandbox
                .spawn(r.command, r.args ?? [], {
                  cwd: r.cwd ?? undefined,
                  env,
                })
                .pipe(Effect.provideService(Scope.Scope, scope));
              const drained = yield* Deferred.make<void>();
              const id = randomUUID(),
                terminal = {
                  handle,
                  output: Buffer.alloc(0),
                  drained,
                  truncated: false,
                  limit: r.outputByteLimit ?? 65536,
                  exitCode: undefined as number | undefined,
                };
              terminals.set(id, terminal);
              yield* Stream.merge(handle.stdout, handle.stderr).pipe(
                Stream.runForEach((chunk) =>
                  Effect.sync(() => {
                    terminal.output = Buffer.concat([terminal.output, chunk]);
                    if (terminal.output.length > terminal.limit) {
                      terminal.output =
                        terminal.limit === 0
                          ? Buffer.alloc(0)
                          : terminal.output.subarray(-terminal.limit);
                      terminal.truncated = true;
                    }
                  }),
                ),
                Effect.ensuring(Deferred.succeed(drained, undefined)),
                Effect.forkIn(scope),
              );
              yield* handle.exitCode.pipe(
                Effect.tap((code) =>
                  Effect.sync(() => {
                    terminal.exitCode = code;
                  }),
                ),
                Effect.ignore,
                Effect.forkIn(scope),
              );
              return { terminalId: id };
            }).pipe(Effect.mapError(transportFailure)),
          );
          const terminal = (id: string) =>
            Effect.fromNullishOr(terminals.get(id)).pipe(
              Effect.mapError(transportFailure),
            );
          yield* client.handleTerminalOutput((r) =>
            terminal(r.terminalId).pipe(
              Effect.map((t) => ({
                output: t.output.toString("utf8"),
                truncated: t.truncated,
                ...(t.exitCode === undefined
                  ? {}
                  : { exitStatus: { exitCode: t.exitCode } }),
              })),
            ),
          );
          yield* client.handleTerminalWaitForExit((r) =>
            terminal(r.terminalId).pipe(
              Effect.flatMap((t) =>
                t.handle.exitCode.pipe(
                  Effect.tap(() => Deferred.await(t.drained)),
                ),
              ),
              Effect.map((exitCode) => ({ exitCode })),
              Effect.mapError(transportFailure),
            ),
          );
          yield* client.handleTerminalKill((r) =>
            terminal(r.terminalId).pipe(
              Effect.flatMap((t) => t.handle.kill()),
              Effect.as({}),
              Effect.mapError(transportFailure),
            ),
          );
          yield* client.handleTerminalRelease((r) =>
            terminal(r.terminalId).pipe(
              Effect.flatMap((t) => t.handle.kill().pipe(Effect.ignore)),
              Effect.tap(() =>
                Effect.sync(() => terminals.delete(r.terminalId)),
              ),
              Effect.as({}),
              Effect.mapError(transportFailure),
            ),
          );
          const queue = yield* Queue.bounded<AgentEvent, Cause.Done<void>>(512);
          const emit = (event: AgentEvent) =>
            Queue.offer(queue, event).pipe(Effect.asVoid);
          const questions = new Map<string, Deferred.Deferred<string>>();
          const pending = new Map<
            string,
            {
              options: ReadonlyArray<string>;
              reply: Deferred.Deferred<Protocol.RequestPermissionResponse>;
            }
          >();
          yield* client.handleSessionUpdate((event) =>
            emit(
              new AgentEvent({
                type: "update",
                sessionId: event.sessionId,
                payload: event.update,
              }),
            ),
          );
          yield* client.handleRequestPermission((request) =>
            Effect.gen(function* () {
              const requestId = randomUUID();
              const reply =
                yield* Deferred.make<Protocol.RequestPermissionResponse>();
              pending.set(requestId, {
                options: request.options.map((o) => o.optionId),
                reply,
              });
              yield* emit(
                new AgentEvent({
                  type: "permission",
                  sessionId: request.sessionId,
                  requestId,
                  title: request.toolCall.title ?? "Agent requests permission",
                  options: request.options.map((o) => ({
                    id: o.optionId,
                    name: o.name,
                    kind: o.kind,
                  })),
                  payload: request.toolCall,
                }),
              );
              return yield* Deferred.await(reply).pipe(
                Effect.ensuring(Effect.sync(() => pending.delete(requestId))),
              );
            }),
          );
          yield* client.handleElicitation((request) =>
            Effect.gen(function* () {
              if (request.mode !== "form")
                return {
                  action: "decline",
                } as Protocol.CreateElicitationResponse;
              const schema = request.requestedSchema as {
                properties?: Record<
                  string,
                  {
                    type?: string;
                    description?: string;
                    enum?: string[];
                    oneOf?: Array<{ const: string; title?: string }>;
                    items?: {
                      anyOf?: Array<{ const: string; title?: string }>;
                    };
                  }
                >;
              };
              const content: Record<string, Protocol.ElicitationContentValue> =
                {};
              for (const [field, property] of Object.entries(
                schema.properties ?? {},
              )) {
                if (field.endsWith("_custom")) continue;
                const choices =
                  property.oneOf ??
                  property.items?.anyOf ??
                  property.enum?.map((value) => ({
                    const: value,
                    title: value,
                  })) ??
                  [];
                const requestId = randomUUID();
                const reply = yield* Deferred.make<string>();
                questions.set(requestId, reply);
                yield* emit(
                  new AgentEvent({
                    type: "question",
                    requestId,
                    sessionId:
                      "sessionId" in request &&
                      typeof request.sessionId === "string"
                        ? request.sessionId
                        : undefined,
                    title: property.description ?? request.message,
                    options: choices.map((choice) => ({
                      id: choice.const,
                      name: choice.title ?? choice.const,
                      kind: "answer",
                    })),
                    payload: { request, field },
                  }),
                );
                const text = yield* Deferred.await(reply).pipe(
                  Effect.ensuring(
                    Effect.sync(() => questions.delete(requestId)),
                  ),
                );
                if (!text)
                  return {
                    action: "cancel",
                  } as Protocol.CreateElicitationResponse;
                const choice = choices.find(
                  (c) => c.title === text || c.const === text,
                );
                if (
                  choices.length &&
                  !choice &&
                  schema.properties?.[`${field}_custom`]
                )
                  content[`${field}_custom`] = text;
                else
                  content[field] =
                    property.type === "array"
                      ? [choice?.const ?? text]
                      : property.type === "boolean"
                        ? /^(true|yes)$/i.test(text)
                        : property.type === "number" ||
                            property.type === "integer"
                          ? Number(text)
                          : (choice?.const ?? text);
                yield* emit(
                  new AgentEvent({
                    type: "question_resolved",
                    requestId,
                    payload: { text },
                  }),
                );
              }
              return {
                action: "accept",
                content,
              } as Protocol.CreateElicitationResponse;
            }),
          );
          const initialized = yield* client.agent.initialize({
            protocolVersion: 1,
            clientInfo: { name: "threadvm", version: "0.0.0" },
            clientCapabilities: {
              elicitation: { form: {} },
              fs: { readTextFile: true, writeTextFile: true },
              terminal: true,
            },
          });
          yield* emit(
            new AgentEvent({ type: "initialized", payload: initialized }),
          );
          if (options.sessionId && !initialized.agentCapabilities?.loadSession)
            return yield* Effect.fail(
              new AgentError({
                message: "Agent cannot load the persisted ACP session",
              }),
            );
          if (
            options.mcpServers?.some(
              (server) => "type" in server && server.type === "http",
            ) &&
            !initialized.agentCapabilities?.mcpCapabilities?.http
          )
            return yield* Effect.fail(
              new AgentError({
                message:
                  "This agent does not support the HTTP MCP transport required by the remote sandbox",
              }),
            );
          const sessionOptions = {
            cwd: sandbox.workdir,
            mcpServers: options.mcpServers ?? [],
          };
          const created = options.sessionId
            ? { sessionId: options.sessionId }
            : yield* client.agent.createSession(sessionOptions);
          const id = created.sessionId;
          const sessionEvent = emit(
            new AgentEvent({
              type: "session",
              sessionId: id,
              payload: created,
            }),
          );
          // session/load may replay more updates than the bounded event queue holds.
          // Return the stream before awaiting replay; the caller drains it while ready waits.
          const loading = yield* (
            options.sessionId
              ? client.agent
                  .loadSession({ ...sessionOptions, sessionId: id })
                  .pipe(
                    Effect.asVoid,
                    Effect.andThen(sessionEvent),
                    Effect.mapError(failure),
                  )
              : sessionEvent
          ).pipe(Effect.forkScoped);
          const ready = Fiber.join(loading);
          let active = false;
          const cancel = Effect.gen(function* () {
            yield* client.agent.cancel({ sessionId: id });
            // cancel is a notification, so let the transport flush before Scope reaps the peer.
            yield* Effect.sleep("150 millis");
            active = false;
            for (const reply of questions.values())
              yield* Deferred.succeed(reply, "");
            for (const value of pending.values())
              yield* Deferred.succeed(value.reply, {
                outcome: { outcome: "cancelled" },
              });
            yield* emit(new AgentEvent({ type: "cancelled", sessionId: id }));
          }).pipe(Effect.mapError(failure));
          // Scope finalizers run before the child is reaped. Never leave an active turn behind.
          yield* Effect.addFinalizer(() =>
            active
              ? cancel.pipe(Effect.timeout("2 seconds"), Effect.ignore)
              : Effect.void,
          );
          return {
            id,
            ready,
            capabilities: initialized.agentCapabilities,
            events: Stream.fromQueue(queue),
            prompt: (text: string) =>
              ready.pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    active = true;
                  }),
                ),
                Effect.andThen(
                  emit(
                    new AgentEvent({
                      type: "turn_started",
                      sessionId: id,
                      payload: { text },
                    }),
                  ),
                ),
                Effect.andThen(
                  client.agent.prompt({
                    sessionId: id,
                    prompt: [{ type: "text", text }],
                  }),
                ),
                Effect.flatMap((result) =>
                  emit(
                    new AgentEvent({
                      type: "turn_complete",
                      sessionId: id,
                      payload: result,
                    }),
                  ),
                ),
                Effect.onInterrupt(() =>
                  cancel.pipe(Effect.timeout("2 seconds"), Effect.ignore),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    active = false;
                  }),
                ),
                Effect.mapError(failure),
              ),
            cancel,
            respondToPermission: (requestId: string, option: string) =>
              Effect.gen(function* () {
                const request = pending.get(requestId);
                if (!request || !request.options.includes(option))
                  return yield* Effect.fail(
                    new AgentError({
                      message: "Unknown permission request or option",
                    }),
                  );
                yield* Deferred.succeed(request.reply, {
                  outcome: { outcome: "selected", optionId: option },
                });
                yield* emit(
                  new AgentEvent({
                    type: "permission_resolved",
                    requestId,
                    sessionId: id,
                    payload: { optionId: option },
                  }),
                );
              }),
            answer: (requestId: string, text: string) =>
              Effect.gen(function* () {
                const reply = questions.get(requestId);
                if (!reply)
                  return yield* Effect.fail(
                    new AgentError({ message: "Question is no longer live" }),
                  );
                yield* Deferred.succeed(reply, text);
              }),
            endEvents: Queue.end(queue).pipe(Effect.asVoid),
          };
        }).pipe(Effect.mapError(failure)),
    };
  }),
);
