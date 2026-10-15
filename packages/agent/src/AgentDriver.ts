import {
  Cause,
  Context,
  Deferred,
  Effect,
  Layer,
  Queue,
  Schema,
  Scope,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
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
  readonly capabilities: unknown;
  readonly events: Stream.Stream<AgentEvent>;
  readonly prompt: (text: string) => Effect.Effect<void, AgentError>;
  readonly cancel: Effect.Effect<void, AgentError>;
  readonly respondToPermission: (
    id: string,
    option: string,
  ) => Effect.Effect<void, AgentError>;
  readonly endEvents: Effect.Effect<void>;
}
export class AgentDriver extends Context.Service<
  AgentDriver,
  {
    readonly open: (options: {
      command: string;
      args: ReadonlyArray<string>;
      cwd: string;
    }) => Effect.Effect<AgentSession, AgentError, Scope.Scope>;
  }
>()("AgentDriver") {}
const failure = (e: unknown) => new AgentError({ message: String(e) });

export const AcpDriverLive = Layer.effect(
  AgentDriver,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return {
      open: (options) =>
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make(options.command, [...options.args], {
              cwd: options.cwd,
              env: process.env,
              extendEnv: true,
            }),
          );
          // stderr is diagnostic output; stdout is exclusively JSON-RPC.
          yield* handle.stderr.pipe(
            Stream.decodeText(),
            Stream.runForEach((text) =>
              Effect.sync(() => process.stderr.write(text)),
            ),
            Effect.forkScoped,
          );
          const context = yield* Layer.buildWithScope(
            Acp.layerChildProcess(handle),
            yield* Scope.Scope,
          );
          const client = Context.get(context, Acp.AcpClient);
          const queue = yield* Queue.bounded<AgentEvent, Cause.Done<void>>(512);
          const emit = (event: AgentEvent) =>
            Queue.offer(queue, event).pipe(Effect.asVoid);
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
          const initialized = yield* client.agent.initialize({
            protocolVersion: 1,
            clientInfo: { name: "threadvm", version: "0.0.0" },
            clientCapabilities: {},
          });
          yield* emit(
            new AgentEvent({ type: "initialized", payload: initialized }),
          );
          const created = yield* client.agent.createSession({
            cwd: options.cwd,
            mcpServers: [],
          });
          const id = created.sessionId;
          yield* emit(
            new AgentEvent({
              type: "session",
              sessionId: id,
              payload: created,
            }),
          );
          let active = false;
          const cancel = Effect.gen(function* () {
            yield* client.agent.cancel({ sessionId: id });
            // cancel is a notification, so let the transport flush before Scope reaps the peer.
            yield* Effect.sleep("150 millis");
            active = false;
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
            capabilities: initialized.agentCapabilities,
            events: Stream.fromQueue(queue),
            prompt: (text: string) =>
              Effect.sync(() => {
                active = true;
              }).pipe(
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
            endEvents: Queue.end(queue).pipe(Effect.asVoid),
          };
        }).pipe(Effect.mapError(failure)),
    };
  }),
);
