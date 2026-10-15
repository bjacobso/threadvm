// One Durable Object per outline. It owns the document and every agent
// thread, relays changes between connections, and plays the simulated runs.
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  ClientMessageJson,
  ServerMessageJson,
  isActive,
  type ClientMessage,
  type Items,
  type ServerMessage,
  type Thread,
} from "../shared/protocol.ts";
import { contextOf, find } from "../shared/tree.ts";
import { seed } from "./seed.ts";
import {
  answer,
  cancel,
  finishBeat,
  isTimed,
  newThread,
  resolve,
  scriptFor,
  startBeat,
  steer,
} from "./simulator.ts";

const DOCUMENT_KEY = "document";
/** Scales every simulated step, so runs are slow enough to watch. */
const PACE = 1.6;
const threadKey = (id: string) => `thread:${id}`;

/** A timed beat to finish, if the thread is still on it. */
type BeatEvent = Readonly<{ threadId: string; cursor: number }>;

const encode = Schema.encodeSync(ServerMessageJson);
const decode = Schema.decodeUnknownOption(ClientMessageJson);

export default class OutlineRoom extends Cloudflare.DurableObject<OutlineRoom>()(
  "OutlineRooms",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      let items: Items = (yield* state.storage.get<Items>(DOCUMENT_KEY)) ?? [];
      const threads = new Map<string, Thread>();
      for (const thread of (yield* state.storage.list<Thread>({ prefix: "thread:" })).values())
        threads.set(thread.id, thread);

      const broadcast = (message: ServerMessage, except?: Cloudflare.WebSocket) =>
        Effect.gen(function* () {
          const text = encode(message);
          for (const socket of yield* state.getWebSockets()) {
            if (except !== undefined && socket.ws === except.ws) continue;
            yield* socket.send(text).pipe(Effect.ignore);
          }
        });

      const saveThread = (thread: Thread) =>
        Effect.gen(function* () {
          threads.set(thread.id, thread);
          yield* state.storage.put(threadKey(thread.id), thread);
          yield* broadcast({ _tag: "ThreadChanged", thread });
        });

      const depthOf = (thread: Thread): number => {
        let depth = 0;
        for (let id = thread.parentThreadId; id !== null && depth < 8; depth += 1)
          id = threads.get(id)?.parentThreadId ?? null;
        return depth;
      };

      const beatOf = (thread: Thread) =>
        scriptFor(thread, { items, depth: depthOf(thread) })[thread.cursor];

      /** Threads waiting on a person, finished, or stopped have nothing to play. */
      const isPlaying = (thread: Thread) =>
        thread.status === "Queued" ||
        thread.status === "Provisioning" ||
        thread.status === "Working";

      /**
       * Starts the beat at the thread's cursor. A timed beat finishes from a
       * scheduled event, so a run survives the object being evicted mid-step.
       */
      const advance = (id: string) =>
        Effect.gen(function* () {
          const thread = threads.get(id);
          if (thread === undefined || !isPlaying(thread)) return;
          const beat = beatOf(thread);
          if (beat === undefined) return;
          const started = startBeat(thread, beat, Date.now());
          yield* saveThread(started);
          if (isTimed(beat))
            yield* Cloudflare.Workers.scheduleEvent(
              `beat:${id}`,
              new Date(Date.now() + beat.ms * PACE),
              { threadId: id, cursor: started.cursor } satisfies BeatEvent,
            );
        });

      const finish = (event: BeatEvent) =>
        Effect.gen(function* () {
          const thread = threads.get(event.threadId);
          if (thread === undefined || !isPlaying(thread) || thread.cursor !== event.cursor) return;
          const beat = beatOf(thread);
          if (beat === undefined || !isTimed(beat)) return;
          yield* saveThread(finishBeat(thread, beat, Date.now()));
          yield* advance(thread.id);
        });

      const reset = Effect.gen(function* () {
        const seeded = seed(Date.now());
        yield* state.storage.deleteAll();
        threads.clear();
        items = seeded.items;
        yield* state.storage.put(DOCUMENT_KEY, items);
        for (const thread of seeded.threads) {
          threads.set(thread.id, thread);
          yield* state.storage.put(threadKey(thread.id), thread);
        }
        yield* broadcast({ _tag: "Snapshot", items, threads: [...threads.values()] });
        for (const thread of seeded.threads) yield* advance(thread.id);
      });

      if (items.length === 0) yield* reset;

      const handle = (socket: Cloudflare.WebSocket, message: ClientMessage) =>
        Effect.gen(function* () {
          const now = Date.now();
          switch (message._tag) {
            case "SaveDocument": {
              items = message.items;
              yield* state.storage.put(DOCUMENT_KEY, items);
              yield* broadcast({ _tag: "DocumentChanged", items }, socket);
              return;
            }
            case "Dispatch": {
              const node = find(items, message.nodeId);
              if (node === undefined || threads.has(message.threadId)) return;
              const prompt = message.instruction || node.text;
              yield* saveThread(
                newThread({
                  id: message.threadId,
                  nodeId: node.id,
                  agent: message.agent,
                  prompt,
                  contextSize: contextOf(items, node.id).size,
                  parentThreadId: message.parentThreadId,
                  now,
                }),
              );
              yield* advance(message.threadId);
              return;
            }
            case "Answer": {
              const thread = threads.get(message.threadId);
              if (thread?.question?.id !== message.questionId) return;
              yield* saveThread(answer(thread, message.text, now));
              yield* advance(thread.id);
              return;
            }
            case "Resolve": {
              const thread = threads.get(message.threadId);
              if (thread === undefined) return;
              yield* saveThread(resolve(thread, message.opIds, message.state, now));
              yield* advance(thread.id);
              return;
            }
            case "Steer": {
              const thread = threads.get(message.threadId);
              if (thread === undefined || !isActive(thread.status)) return;
              yield* saveThread(steer(thread, message.text, now));
              return;
            }
            case "Cancel": {
              const thread = threads.get(message.threadId);
              if (thread === undefined || !isActive(thread.status)) return;
              yield* saveThread(cancel(thread, now));
              return;
            }
            case "ResetDemo":
              return yield* reset;
          }
        });

      return {
        alarm: () =>
          Effect.gen(function* () {
            for (const event of yield* Cloudflare.Workers.processScheduledEvents)
              yield* finish(event.payload as BeatEvent);
          }),
        fetch: Effect.gen(function* () {
          const [response, socket] = yield* Cloudflare.upgrade();
          yield* socket.send(
            encode({ _tag: "Snapshot", items, threads: [...threads.values()] }),
          );
          return response;
        }),
        webSocketMessage: Effect.fn(function* (
          socket: Cloudflare.WebSocket,
          raw: string | ArrayBuffer,
        ) {
          const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
          const message = decode(text);
          if (message._tag === "None") return;
          yield* handle(socket, message.value);
        }),
        webSocketClose: Effect.fn(function* (
          socket: Cloudflare.WebSocket,
          code: number,
          reason: string,
        ) {
          yield* socket.close(code, reason).pipe(Effect.ignore);
        }),
      };
    });
  }),
) {}
