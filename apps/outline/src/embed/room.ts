// The whole outline room, inside the page, for the demo embedded on the
// homepage. It plays the same seed and simulator as `OutlineRoom` and speaks
// the same protocol through a WebSocket-shaped object, so the client cannot
// tell the difference. Nothing leaves the browser.
//
// On top of the room sits a director: a short story that types a bullet,
// sends it to an agent, and answers or accepts for the visitor when they
// leave it alone. The first thing the visitor does stops the director; the
// agents keep running and the outline is theirs.
import { Schema } from "effect";

import { mentionedAgent } from "../shared/agents.ts";
import {
  ClientMessageJson,
  ServerMessageJson,
  isActive,
  pendingOps,
  type ClientMessage,
  type Items,
  type ServerMessage,
  type Thread,
} from "../shared/protocol.ts";
import { applyOp, contextOf, find, updateItem } from "../shared/tree.ts";
import { seed } from "../worker/seed.ts";
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
} from "../worker/simulator.ts";

/** Scales every simulated step. A little quicker than the shared demo. */
const PACE = 1.25;

/** The bullet the story writes, and the thread it starts. */
const STORY_NODE = "dialog";
const STORY_TEXT = "@cursor build the share dialog";
const STORY_THREAD = "t-story";
/** The seed's own run on that bullet, which the story replaces. */
const SEEDED_THREAD = "t-dialog";

const FIRST_KEY_MS = 1400;
const KEY_MS = 55;
const SEND_MS = 900;
/** How long the director waits for the visitor before answering or accepting. */
const PATIENCE_MS = 6500;
/** The answer the director picks when nobody else does. */
const STORY_ANSWER = "Full dialog with tabs";

export const STAGES = [
  "Write",
  "Delegate",
  "Answer",
  "Review",
  "Done",
] as const;
export type Stage = (typeof STAGES)[number];

/** Sent by the embedding page once the frame is in view. */
export type StoryCommand = Readonly<{
  source: "threadvm-site";
  command: "play";
}>;

/** Posted to the embedding page whenever the story moves. */
export type StoryEvent = Readonly<{
  source: "threadvm-demo";
  stage: Stage;
  driving: "Story" | "Visitor";
}>;

const encode = Schema.encodeSync(ServerMessageJson);
const decode = Schema.decodeUnknownOption(ClientMessageJson);

const stageOf = (thread: Thread): Stage =>
  thread.status === "NeedsInput"
    ? "Answer"
    : thread.status === "Review"
      ? "Review"
      : thread.status === "Done"
        ? "Done"
        : "Delegate";

/** Threads waiting on a person, finished, or stopped have nothing to play. */
const isPlaying = (thread: Thread) =>
  thread.status === "Queued" ||
  thread.status === "Provisioning" ||
  thread.status === "Working";

/** Timeouts that can be cancelled together. */
class Timers {
  private readonly ids = new Set<ReturnType<typeof setTimeout>>();
  after(ms: number, run: () => void) {
    const id = setTimeout(() => {
      this.ids.delete(id);
      run();
    }, ms);
    this.ids.add(id);
  }
  clear() {
    for (const id of this.ids) clearTimeout(id);
    this.ids.clear();
  }
}

class Room {
  private items: Items = [];
  private readonly threads = new Map<string, Thread>();
  private readonly beats = new Timers();
  private readonly cues = new Timers();
  private socket: DemoSocket | null = null;
  private seeded = false;
  /** Whether the story has been asked for; a framed demo waits until it is seen. */
  private cued = window.parent === window;
  private told = false;
  private stage: Stage = "Write";
  private driving: StoryEvent["driving"] = "Story";

  constructor(private readonly onStory: (event: StoryEvent) => void) {}

  connect(socket: DemoSocket) {
    this.socket = socket;
    if (!this.seeded) this.seed();
    this.seeded = true;
    this.send({
      _tag: "Snapshot",
      items: this.items,
      threads: [...this.threads.values()],
    });
    this.report();
    this.begin();
  }

  /** The embedding page can see the frame. */
  play() {
    this.cued = true;
    this.begin();
  }

  private begin() {
    if (this.told || !this.cued || this.socket === null) return;
    this.told = true;
    this.tell();
  }

  disconnect(socket: DemoSocket) {
    if (this.socket === socket) this.socket = null;
  }

  receive(message: ClientMessage) {
    if (this.isVisitor(message)) this.takeOver();
    const now = Date.now();
    switch (message._tag) {
      case "SaveDocument":
        this.items = message.items;
        return;
      case "Dispatch": {
        const node = find(this.items, message.nodeId);
        if (node === undefined || this.threads.has(message.threadId)) return;
        this.save(
          newThread({
            id: message.threadId,
            nodeId: node.id,
            agent: message.agent,
            prompt: message.instruction || node.text,
            contextSize: contextOf(this.items, node.id).size,
            parentThreadId: message.parentThreadId,
            now,
          }),
        );
        return this.advance(message.threadId);
      }
      case "Answer": {
        const thread = this.threads.get(message.threadId);
        if (thread?.question?.id !== message.questionId) return;
        this.save(answer(thread, message.text, now));
        return this.advance(thread.id);
      }
      case "Resolve": {
        const thread = this.threads.get(message.threadId);
        if (thread === undefined) return;
        this.save(resolve(thread, message.opIds, message.state, now));
        return this.advance(thread.id);
      }
      case "Steer": {
        const thread = this.threads.get(message.threadId);
        if (thread === undefined || !isActive(thread.status)) return;
        return this.save(steer(thread, message.text, now));
      }
      case "Cancel": {
        const thread = this.threads.get(message.threadId);
        if (thread === undefined || !isActive(thread.status)) return;
        return this.save(cancel(thread, now));
      }
      case "Push":
        return this.send({
          _tag: "Error",
          message: "Git push is available in local mode",
        });
      case "ResetDemo":
        return this.replay();
    }
  }

  private replay() {
    this.seed();
    this.send({
      _tag: "Snapshot",
      items: this.items,
      threads: [...this.threads.values()],
    });
    this.report();
    this.tell();
  }

  // -------------------------------------------------------------------- room

  /** The shared demo outline, with the story's bullet still to be written. */
  private seed() {
    this.beats.clear();
    this.cues.clear();
    const seeded = seed(Date.now());
    this.items = updateItem(seeded.items, STORY_NODE, (node) => ({
      ...node,
      text: "",
    }));
    this.threads.clear();
    for (const thread of seeded.threads)
      if (thread.id !== SEEDED_THREAD) this.threads.set(thread.id, thread);
    this.stage = "Write";
    this.driving = "Story";
  }

  private send(message: ServerMessage) {
    this.socket?.deliver(encode(message));
  }

  private save(thread: Thread) {
    this.threads.set(thread.id, thread);
    this.send({ _tag: "ThreadChanged", thread });
    if (thread.id === STORY_THREAD) this.follow(thread);
  }

  private depthOf(thread: Thread): number {
    let depth = 0;
    for (let id = thread.parentThreadId; id !== null && depth < 8; depth += 1)
      id = this.threads.get(id)?.parentThreadId ?? null;
    return depth;
  }

  private beatOf(thread: Thread) {
    return scriptFor(thread, {
      items: this.items,
      depth: this.depthOf(thread),
    })[thread.cursor];
  }

  /** Starts the beat at the thread's cursor, and finishes it later if it is timed. */
  private advance(id: string) {
    const thread = this.threads.get(id);
    if (thread === undefined || !isPlaying(thread)) return;
    const beat = this.beatOf(thread);
    if (beat === undefined) return;
    const started = startBeat(thread, beat, Date.now());
    this.save(started);
    if (!isTimed(beat)) return;
    this.beats.after(beat.ms * PACE, () => {
      const current = this.threads.get(id);
      if (
        current === undefined ||
        !isPlaying(current) ||
        current.cursor !== started.cursor
      )
        return;
      this.save(finishBeat(current, beat, Date.now()));
      this.advance(id);
    });
  }

  // ------------------------------------------------------------------- story

  /** Writes the story's bullet a key at a time, then sends it to the agent. */
  private tell() {
    let typed = 0;
    const type = () => {
      typed += 1;
      this.write(
        updateItem(this.items, STORY_NODE, (node) => ({
          ...node,
          text: STORY_TEXT.slice(0, typed),
        })),
      );
      if (typed < STORY_TEXT.length)
        this.cues.after(KEY_MS + ((typed * 37) % 45), type);
      else this.cues.after(SEND_MS, dispatch);
    };
    const dispatch = () => {
      const node = find(this.items, STORY_NODE);
      const agent = node && mentionedAgent(node.text);
      if (node === undefined || agent === undefined) return;
      this.save(
        newThread({
          id: STORY_THREAD,
          nodeId: node.id,
          agent,
          prompt: node.text,
          contextSize: contextOf(this.items, node.id).size,
          parentThreadId: null,
          now: Date.now(),
        }),
      );
      this.advance(STORY_THREAD);
    };
    this.cues.after(FIRST_KEY_MS, type);
  }

  /** Moves the story forward with its thread, answering for an absent visitor. */
  private follow(thread: Thread) {
    const stage = stageOf(thread);
    if (STAGES.indexOf(stage) > STAGES.indexOf(this.stage)) {
      this.stage = stage;
      this.report();
    }
    if (this.driving !== "Story") return;
    const asked = thread.question;
    if (thread.status === "NeedsInput" && asked)
      this.cues.after(PATIENCE_MS, () => {
        const current = this.threads.get(STORY_THREAD);
        if (
          current === undefined ||
          current.question?.id !== asked.id ||
          this.driving !== "Story"
        )
          return;
        const choice = asked.options.includes(STORY_ANSWER)
          ? STORY_ANSWER
          : (asked.options[0] ?? "Yes");
        this.save(answer(current, choice, Date.now()));
        this.advance(STORY_THREAD);
      });
    if (thread.status === "Review")
      this.cues.after(PATIENCE_MS, () => {
        const current = this.threads.get(STORY_THREAD);
        if (current?.status !== "Review" || this.driving !== "Story") return;
        const ops = pendingOps(current);
        let items = this.items;
        for (const op of ops) items = applyOp(items, op);
        this.write(items);
        this.save(
          resolve(
            current,
            ops.map((op) => op.id),
            "Accepted",
            Date.now(),
          ),
        );
        this.advance(STORY_THREAD);
      });
  }

  /** The room changes the outline, as another window would. */
  private write(items: Items) {
    this.items = items;
    this.send({ _tag: "DocumentChanged", items });
  }

  /** Anything but an echo of the room's own outline means a person is here. */
  private isVisitor(message: ClientMessage) {
    if (message._tag === "ResetDemo") return false;
    if (message._tag === "SaveDocument")
      return JSON.stringify(message.items) !== JSON.stringify(this.items);
    return true;
  }

  private takeOver() {
    if (this.driving === "Visitor") return;
    this.driving = "Visitor";
    this.cues.clear();
    this.report();
  }

  private report() {
    this.onStory({
      source: "threadvm-demo",
      stage: this.stage,
      driving: this.driving,
    });
  }
}

/**
 * Enough of a WebSocket for the client's room connection. The client listens
 * for frames only once it has handled `open`, so frames wait until it does.
 */
export class DemoSocket extends EventTarget {
  private waiting: Array<string> | null = [];

  constructor(private readonly room: Room) {
    super();
    queueMicrotask(() => {
      this.dispatchEvent(new Event("open"));
      room.connect(this);
    });
  }

  override addEventListener(
    ...args: Parameters<EventTarget["addEventListener"]>
  ) {
    super.addEventListener(...args);
    const waiting = this.waiting;
    if (args[0] !== "message" || waiting === null) return;
    this.waiting = null;
    queueMicrotask(() => {
      for (const text of waiting) this.deliver(text);
    });
  }

  send(text: string) {
    const message = decode(text);
    if (message._tag === "None") return;
    // A real socket never answers within the same call stack.
    queueMicrotask(() => this.room.receive(message.value));
  }

  close() {
    this.room.disconnect(this);
    this.dispatchEvent(new CloseEvent("close"));
  }

  deliver(text: string) {
    if (this.waiting !== null) this.waiting.push(text);
    else this.dispatchEvent(new MessageEvent("message", { data: text }));
  }
}

// The embedding page starts the story when the frame comes into view, and
// replays it by reloading the frame.
const room = new Room((event) => {
  if (window.parent !== window)
    window.parent.postMessage(event, location.origin);
});

window.addEventListener(
  "message",
  (event: MessageEvent<Partial<StoryCommand>>) => {
    if (event.origin !== location.origin || event.source !== window.parent)
      return;
    if (event.data?.source === "threadvm-site" && event.data.command === "play")
      room.play();
  },
);

export const openDemoSocket = (_outlineId: string): WebSocket =>
  new DemoSocket(room) as unknown as WebSocket;
