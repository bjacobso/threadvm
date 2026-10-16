import { AgentConfiguration } from "@threadvm/shared/services/AgentConfiguration";
import {
  Context,
  Effect,
  Layer,
  Semaphore,
  Stream,
  Schema,
  Scope,
  Fiber,
} from "effect";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { hostname, platform, release } from "node:os";
import { randomUUID } from "node:crypto";
import {
  OutlineStore,
  operationNodeId,
} from "@threadvm/shared/services/OutlineStore";
import {
  ThoughtsRepo,
  outlineIO,
  atomicWrite,
  OutlineError,
} from "@threadvm/shared/services/ThoughtsRepo";
import { AgentRuns } from "@threadvm/shared/services/AgentRuns";
import { RunEventLog } from "@threadvm/shared/services/RunEventLog";
import {
  OperationBatch,
  ReviewRequest,
  RunControlRequest,
  type RunEvent,
  type Proposal,
} from "@threadvm/shared/domain";
import {
  type ClientMessage,
  type ServerMessage,
  type Thread,
  type Op,
  type Items,
  type Backend,
  type AgentId,
  type Activity,
} from "@threadvm/outline-protocol";
import { asNodes, diff, toItems } from "@threadvm/outline-protocol/document";
import { contextOf, find, walk } from "@threadvm/outline-protocol/tree";

interface RoomState {
  collapsed: Record<string, boolean>;
  failed: Record<string, Thread>;
  cancelled: string[];
  answers: string[];
}
const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? (value as Record<string, any>) : {};
const eventActivity = (events: ReadonlyArray<RunEvent>): Activity[] => {
  const activity: Activity[] = [];
  const tools = new Map<string, number>();
  for (const event of events) {
    const signal = event.agent,
      data = object(signal?.payload);
    if (signal?.type === "update") {
      if (
        data.sessionUpdate === "agent_message_chunk" &&
        typeof data.content?.text === "string"
      ) {
        const last = activity.at(-1);
        if (last?._tag === "Said" && last.who === "Agent")
          activity[activity.length - 1] = {
            ...last,
            text: last.text + data.content.text,
          };
        else
          activity.push({
            _tag: "Said",
            id: event.id,
            at: event.time,
            who: "Agent",
            text: data.content.text,
          });
      } else if (
        data.sessionUpdate === "tool_call" ||
        data.sessionUpdate === "tool_call_update"
      ) {
        const index = tools.get(data.toolCallId);
        const prior = index === undefined ? undefined : activity[index];
        const entry: Activity = {
          _tag: "Step",
          id: data.toolCallId,
          at: event.time,
          kind:
            data.kind === "edit"
              ? "edit"
              : data.kind === "read"
                ? "read"
                : data.kind === "search"
                  ? "search"
                  : "bash",
          label:
            data.title ?? (prior?._tag === "Step" ? prior.label : "Agent tool"),
          detail: data.status ?? "",
          state:
            data.status === "failed"
              ? "Failed"
              : data.status === "completed"
                ? "Done"
                : "Running",
        };
        if (index === undefined) {
          tools.set(data.toolCallId, activity.length);
          activity.push(entry);
        } else activity[index] = entry;
      }
      continue;
    }
    if (signal?.type === "question_resolved")
      activity.push({
        _tag: "Said",
        id: event.id,
        at: event.time,
        who: "Human",
        text: String(data.text ?? "Answered"),
      });
    else if (
      signal?.type === "turn_started" &&
      typeof data.text === "string" &&
      !data.text.startsWith("# ThreadVM run")
    )
      activity.push({
        _tag: "Said",
        id: event.id,
        at: event.time,
        who: "Human",
        text: data.text,
      });
    else if (event.kind === "observation" || event.kind === "output")
      activity.push({
        _tag: "Said",
        id: event.id,
        at: event.time,
        who: "Agent",
        text: event.message ?? "",
      });
    else if (
      event.kind === "started" ||
      event.kind === "commit" ||
      event.kind === "failed" ||
      (event.kind === "finished" &&
        event.exitCode !== undefined &&
        event.exitCode !== 0)
    )
      activity.push({
        _tag: "Step",
        id: event.id,
        at: event.time,
        kind: event.kind === "commit" ? "git" : "sandbox",
        label:
          event.kind === "started"
            ? "Local worktree and tmux session ready"
            : event.kind === "commit"
              ? "Code committed"
              : "Run failed",
        detail: event.codeSha ?? event.message ?? "",
        state:
          event.kind === "failed" ||
          (event.kind === "finished" && event.exitCode !== 0)
            ? "Failed"
            : "Done",
      });
  }
  return activity;
};

/** One project room, independent of browser URL aliases. Git/events are authoritative. */
export class OutlineRoom extends Context.Service<
  OutlineRoom,
  {
    readonly connect: (
      send: (message: ServerMessage) => void,
    ) => Effect.Effect<() => void, OutlineError>;
    readonly handle: (
      message: ClientMessage,
    ) => Effect.Effect<void, OutlineError>;
  }
>()("OutlineRoom") {}

export const OutlineRoomLive = Layer.effect(
  OutlineRoom,
  Effect.gen(function* () {
    const store = yield* OutlineStore,
      repo = yield* ThoughtsRepo,
      runs = yield* AgentRuns,
      profiles = yield* AgentConfiguration,
      log = yield* RunEventLog;
    const mutex = yield* Semaphore.make(1);
    const scope = yield* Scope.Scope;
    const listeners = new Set<(message: ServerMessage) => void>();
    let state: RoomState = {
        collapsed: {},
        failed: {},
        cancelled: [],
        answers: [],
      },
      loaded = false;
    let items: Items = [],
      threads: Thread[] = [],
      backend: Backend | undefined;
    let lastDocument = "",
      lastThreads = new Map<string, string>();
    const statePath = join(repo.dir, "runs", "outline-room.json");
    const persist = () =>
      outlineIO(async () => {
        await mkdir(join(repo.dir, "runs"), { recursive: true });
        await atomicWrite(statePath, JSON.stringify(state));
      });
    const broadcast = (message: ServerMessage) => {
      for (const listener of listeners) listener(message);
    };
    const makeOps = (
      proposals: ReadonlyArray<Proposal>,
      nodes: ReadonlyArray<import("@threadvm/shared/domain").Node>,
    ): Op[] => {
      const result: Op[] = [];
      for (const p of proposals) {
        const stateOf = (id: string) =>
          p.pending.includes(id)
            ? ("Pending" as const)
            : p.accepted.includes(id)
              ? ("Accepted" as const)
              : ("Rejected" as const);
        const inserts = p.batch.operations.filter((op) => op.type === "insert");
        const nested = new Set<string>();
        const tree = (id: string): Items =>
          inserts
            .filter(
              (op) => op.parent === id && stateOf(op.node.id) === stateOf(id),
            )
            .map((op) => {
              nested.add(op.node.id);
              return {
                id: op.node.id,
                text: op.node.text,
                checked: op.node.done,
                collapsed: false,
                children: tree(op.node.id),
              };
            });
        for (const [i, op] of p.batch.operations.entries()) {
          const nodeId = operationNodeId(op),
            id = `${p.id}|${nodeId}|${i}`,
            status = stateOf(nodeId);
          if (op.type === "insert") {
            if (
              nested.has(nodeId) ||
              inserts.some(
                (parent) =>
                  parent.node.id === op.parent &&
                  stateOf(parent.node.id) === status,
              )
            )
              continue;
            const children = tree(nodeId),
              inserted = {
                id: nodeId,
                text: op.node.text,
                checked: op.node.done,
                collapsed: false,
                children,
              };
            result.push({
              _tag: "Insert",
              id,
              state: status,
              parentId: op.parent,
              afterId: op.after ?? null,
              items: [inserted],
              nodeIds: walk([inserted]).map((n) => n.id),
            });
          } else if (op.type === "update") {
            if (op.patch.text !== undefined)
              result.push({
                _tag: "Edit",
                id,
                state: status,
                nodeId,
                before: nodes.find((n) => n.id === nodeId)?.text ?? "",
                after: op.patch.text,
              });
            if (op.patch.done === true)
              result.push({
                _tag: "Complete",
                id: `${id}-done`,
                state: status,
                nodeId,
              });
            if (op.patch.done === false && op.patch.text === undefined)
              result.push({
                _tag: "Structural",
                id,
                state: status,
                nodeId,
                label: "Reopen this task",
              });
          } else
            result.push({
              _tag: "Structural",
              id,
              state: status,
              nodeId,
              label:
                op.type === "delete"
                  ? "Delete this task and its descendants"
                  : `Move under ${op.parent ?? "top level"}`,
            });
        }
      }
      return result;
    };
    const refresh = (requestId?: string) =>
      Effect.gen(function* () {
        if (!loaded) {
          const file = yield* outlineIO(() =>
            readFile(statePath, "utf8").catch((e) => {
              if (e.code === "ENOENT") return "";
              throw e;
            }),
          );
          if (file) state = { answers: [], ...JSON.parse(file) };
          loaded = true;
        }
        const snapshot = yield* store.read;
        const allRuns = yield* runs.list,
          events = yield* log.read;
        const prefs = (nodes: Items): Items =>
          nodes.map((n) => ({
            ...n,
            collapsed: state.collapsed[n.id] ?? false,
            children: prefs(n.children),
          }));
        items = prefs(toItems(snapshot.nodes));
        const available: AgentId[] = [...(yield* profiles.names)];
        backend = {
          kind: "local",
          revision: snapshot.revision,
          projectDir: repo.projectDir,
          remote: yield* repo
            .git(["remote", "get-url", "origin"])
            .pipe(Effect.catch(() => Effect.succeed(""))),
          branch: yield* repo.git(["branch", "--show-current"]),
          available,
          tombstones: snapshot.tombstones,
        };
        threads = allRuns.map((run): Thread => {
          const own = events.filter((event) => event.runId === run.id);
          const proposals = snapshot.proposals.filter(
            (p) => p.runId === run.id,
          );
          const ops = makeOps(proposals, snapshot.nodes);
          const pending = ops.some((op) => op.state === "Pending");
          const cancelled =
            state.cancelled.includes(run.id) ||
            own.some((e) => e.agent?.type === "cancelled");
          const pendingRequest = cancelled
            ? undefined
            : [...(run.pendingRequests ?? [])]
                .filter((r) => !state.answers.includes(r.id))
                .sort(
                  (a, b) =>
                    Number(b.response === "live") -
                    Number(a.response === "live"),
                )[0];
          const lastTurn = own
            .filter(
              (e) =>
                e.agent?.type === "turn_started" ||
                e.agent?.type === "turn_complete",
            )
            .at(-1);
          const idle = lastTurn?.agent?.type === "turn_complete";
          const question = pendingRequest
            ? {
                requestId: pendingRequest.id,
                type: pendingRequest.kind,
                title: pendingRequest.title,
                options: pendingRequest.options,
                payload: pendingRequest.payload,
              }
            : undefined;
          const activity = eventActivity(own);
          const report = [...activity]
            .reverse()
            .find((a) => a._tag === "Said" && a.who === "Agent");
          const contextItems = toItems(run.contextNodes ?? snapshot.nodes);
          return {
            id: run.threadId ?? run.id,
            nodeId: run.nodeId,
            agent: (run.executor ??
              run.agentProfile?.id ??
              (run.agent === "acp" ? "claude" : run.agent)) as AgentId,
            prompt:
              run.contextNodes?.find((n) => n.id === run.nodeId)?.text ??
              find(items, run.nodeId)?.text ??
              run.nodeId,
            contextSize: contextOf(contextItems, run.nodeId).size,
            parentThreadId: run.parentThreadId ?? null,
            status: cancelled
              ? "Cancelled"
              : question
                ? "NeedsInput"
                : run.status === "failed"
                  ? "Failed"
                  : pending && (idle || run.status === "finished")
                    ? "Review"
                    : idle || run.status === "finished"
                      ? "Done"
                      : run.status === "starting"
                        ? "Provisioning"
                        : "Working",
            headline: question
              ? "Needs you"
              : run.status === "failed"
                ? "Executor failed"
                : run.agent === "shell"
                  ? "Shell is running"
                  : idle
                    ? "Finished this turn"
                    : "Working in the local worktree",
            createdAt: run.startedAt,
            updatedAt: own.at(-1)?.time ?? run.startedAt,
            sandbox: {
              id: `${run.worktree} · ${run.sessionName}`,
              image: `${hostname()} · ${platform()} ${release()}`,
              branch: run.branch,
            },
            activity,
            question: question
              ? {
                  id: question.requestId!,
                  response: pendingRequest?.response,
                  prompt: question.title ?? "Agent requests input",
                  options: question.options?.map((o) => o.name) ?? [],
                  kind:
                    question.type === "permission" ? "permission" : "question",
                  details:
                    question.type === "permission"
                      ? JSON.stringify(question.payload, null, 2)
                      : "",
                }
              : null,
            answers: own
              .filter((e) => e.agent?.type === "question_resolved")
              .map((e) => String(object(e.agent?.payload).text ?? "")),
            proposal: ops.length
              ? {
                  id: proposals.map((p) => p.id).join(","),
                  summary: `${ops.filter((op) => op.state === "Pending").length} suggestions`,
                  ops,
                }
              : null,
            report: report?._tag === "Said" ? report.text : "",
            links: [],
            cursor: 0,
            contextItems,
            execution: {
              runId: run.id,
              worktree: run.worktree,
              sessionName: run.sessionName,
              codeSha:
                own.filter((e) => e.kind === "commit").at(-1)?.codeSha ??
                run.codeSha,
              transport: run.agent === "acp" ? "acp" : "terminal",
              persistent: run.persistent ?? false,
            },
          };
        });
        for (const p of snapshot.proposals.filter((p) => !p.runId)) {
          const op = p.batch.operations[0];
          if (!op) continue;
          const nodeId =
            op.type === "insert"
              ? (op.parent ??
                snapshot.nodes.find((n) => n.parent === null)?.id ??
                op.node.id)
              : op.id;
          threads.push({
            id: `proposal-${p.id}`,
            nodeId,
            agent: "cli",
            prompt: find(items, nodeId)?.text ?? "CLI proposal",
            contextSize: contextOf(items, nodeId).size,
            parentThreadId: null,
            status: p.pending.length ? "Review" : "Done",
            headline: "CLI proposal",
            createdAt: p.createdAt,
            updatedAt: p.createdAt,
            sandbox: null,
            activity: [],
            question: null,
            answers: [],
            proposal: {
              id: p.id,
              summary: "Submitted through the outline write path",
              ops: makeOps([p], snapshot.nodes),
            },
            report: "",
            links: [],
            cursor: 0,
          });
        }
        threads.push(...Object.values(state.failed));
        const documentHash = JSON.stringify({ items, backend });
        if (documentHash !== lastDocument || requestId) {
          broadcast({
            _tag: "DocumentChanged",
            items,
            backend,
            ...(requestId ? { requestId } : {}),
          });
          lastDocument = documentHash;
        }
        for (const thread of threads) {
          const encoded = JSON.stringify(thread);
          if (lastThreads.get(thread.id) !== encoded)
            broadcast({ _tag: "ThreadChanged", thread });
        }
        lastThreads = new Map(threads.map((t) => [t.id, JSON.stringify(t)]));
      });
    const dispatch = (message: Extract<ClientMessage, { _tag: "Dispatch" }>) =>
      Effect.gen(function* () {
        if (threads.some((t) => t.id === message.threadId)) return;
        const node = find(items, message.nodeId);
        if (!node)
          return yield* Effect.fail(
            new OutlineError("Delegated bullet is missing"),
          );
        let depth = 0,
          parent = message.parentThreadId;
        while (parent && depth <= 2) {
          depth++;
          parent = threads.find((t) => t.id === parent)?.parentThreadId ?? null;
        }
        const configured = yield* profiles
          .resolve(message.agent, message.sandbox)
          .pipe(Effect.result);
        const unavailable = configured._tag === "Failure" || depth > 2;
        if (unavailable) {
          state.failed[message.threadId] = {
            id: message.threadId,
            nodeId: node.id,
            agent: message.agent,
            prompt: message.instruction || node.text,
            contextSize: contextOf(items, node.id).size,
            parentThreadId: message.parentThreadId,
            status: "Failed",
            headline:
              depth > 2
                ? "Delegation depth limit reached"
                : `${message.agent} is unavailable locally`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sandbox: null,
            activity: [],
            question: null,
            answers: [],
            proposal: null,
            report: "Configure an installed ACP agent to run this profile.",
            links: [],
            cursor: 0,
          };
          yield* persist();
          return;
        }
        if (
          threads.some(
            (t) =>
              t.nodeId === node.id &&
              (t.status === "Working" ||
                t.status === "NeedsInput" ||
                t.status === "Provisioning"),
          )
        )
          return;
        const instruction =
          message.agent === "conductor"
            ? `${message.instruction || node.text}\nBreak this down into delegated sub-bullets as an outline proposal. Use @claude or @codex on implementation bullets. Do not launch agents yourself; acceptance launches them, at most two levels deep.`
            : message.instruction || node.text;
        yield* runs.start(node.id, message.agent, {
          sandbox: message.sandbox,
          threadId: message.threadId,
          executor: message.agent,
          parentThreadId: message.parentThreadId,
          instruction,
          persistent: message.agent !== "shell",
        });
      });
    const handleWork = (message: ClientMessage) =>
      mutex.withPermits(1)(
        Effect.gen(function* () {
          yield* refresh();
          switch (message._tag) {
            case "SaveDocument": {
              const operations = diff(
                asNodes(message.baseItems ?? items),
                message.items,
              );
              if (operations.length) {
                const batch = yield* Schema.decodeUnknownEffect(OperationBatch)(
                  {
                    baseRevision: message.baseRevision ?? backend!.revision,
                    operations,
                    requestId: message.requestId,
                  },
                ).pipe(Effect.mapError((e) => new OutlineError(e.message)));
                yield* store.apply(batch);
              }
              for (const node of walk(message.items))
                state.collapsed[node.id] = node.collapsed;
              yield* persist();
              yield* refresh(message.requestId);
              return;
            }
            case "Dispatch":
              yield* dispatch(message);
              break;
            case "Resolve": {
              if (message.state === "Pending")
                return yield* Effect.fail(
                  new OutlineError(
                    "Accepted suggestions are immutable; propose a new change to reverse them",
                  ),
                );
              const thread = threads.find((t) => t.id === message.threadId);
              const selected =
                thread?.proposal?.ops.filter(
                  (op) =>
                    message.opIds.includes(op.id) && op.state === "Pending",
                ) ?? [];
              const batches = new Map<string, Set<string>>();
              for (const op of selected) {
                const [proposalId, nodeId] = op.id.split("|");
                const ids = batches.get(proposalId!) ?? new Set<string>();
                for (const id of op._tag === "Insert"
                  ? (op.nodeIds ?? [nodeId!])
                  : [nodeId!])
                  ids.add(id);
                batches.set(proposalId!, ids);
              }
              for (const [proposalId, nodeIds] of batches)
                yield* store.review(
                  new ReviewRequest({
                    proposalId,
                    nodeIds: [...nodeIds],
                    decision:
                      message.state === "Accepted" ? "accept" : "reject",
                  }),
                );
              yield* refresh();
              if (message.state === "Accepted")
                for (const op of selected)
                  if (op._tag === "Insert")
                    for (const node of walk(op.items)) {
                      const agent = /(?:^|\s)@([a-z][a-z0-9_-]*)\b/.exec(
                        node.text,
                      )?.[1] as AgentId | undefined;
                      if (agent)
                        yield* dispatch({
                          _tag: "Dispatch",
                          threadId: randomUUID(),
                          nodeId: node.id,
                          agent,
                          instruction: "",
                          parentThreadId: message.threadId,
                        });
                    }
              break;
            }
            case "Answer": {
              if (state.answers.includes(message.questionId)) return;
              const thread = threads.find((t) => t.id === message.threadId);
              if (
                !thread?.execution ||
                thread.question?.id !== message.questionId
              )
                return yield* Effect.fail(
                  new OutlineError("Question is no longer live"),
                );
              const ownEvents = yield* log.read;
              const question = ownEvents.find(
                (e) =>
                  e.runId === thread.execution!.runId &&
                  e.agent?.requestId === message.questionId,
              )?.agent;
              if (question?.type === "permission") {
                const option = question.options?.find(
                  (o) => o.name === message.text,
                );
                if (!option)
                  return yield* Effect.fail(
                    new OutlineError(
                      "Choose a permission option; free text cannot grant tool permission",
                    ),
                  );
                yield* runs.control(
                  new RunControlRequest({
                    action: "permission",
                    runId: thread.execution.runId,
                    requestId: message.questionId,
                    optionId: option.id,
                  }),
                );
              } else
                yield* runs.control(
                  new RunControlRequest({
                    action: "answer",
                    runId: thread.execution.runId,
                    requestId: message.questionId,
                    text: message.text,
                  }),
                );
              state.answers.push(message.questionId);
              yield* persist();
              break;
            }
            case "Steer": {
              const thread = threads.find((t) => t.id === message.threadId);
              if (!thread?.execution)
                return yield* Effect.fail(
                  new OutlineError("This thread has no executor"),
                );
              yield* runs.control(
                new RunControlRequest({
                  action: "prompt",
                  runId: thread.execution.runId,
                  text: message.text,
                }),
              );
              break;
            }
            case "Cancel": {
              const thread = threads.find((t) => t.id === message.threadId);
              if (!thread?.execution) return;
              yield* runs.control(
                new RunControlRequest({
                  action: "cancel",
                  runId: thread.execution.runId,
                }),
              );
              state.cancelled.push(thread.execution.runId);
              yield* persist();
              break;
            }
            case "Push":
              yield* repo.push();
              break;
            case "ResetDemo":
              return yield* Effect.fail(
                new OutlineError("Reset is available only in demo mode"),
              );
          }
          yield* refresh();
        }),
      );
    const handle = (message: ClientMessage) =>
      handleWork(message).pipe(
        Effect.forkIn(scope),
        Effect.flatMap(Fiber.join),
      );
    yield* Stream.tick("300 millis").pipe(
      Stream.runForEach(() =>
        listeners.size
          ? mutex
              .withPermits(1)(refresh())
              .pipe(
                Effect.catch((e) =>
                  Effect.sync(() =>
                    broadcast({ _tag: "Error", message: e.message }),
                  ),
                ),
              )
          : Effect.void,
      ),
      Effect.forkScoped,
    );
    return {
      handle,
      connect: (send) =>
        mutex.withPermits(1)(
          Effect.gen(function* () {
            yield* refresh();
            listeners.add(send);
            send({ _tag: "Snapshot", items, threads, backend: backend! });
            return () => listeners.delete(send);
          }),
        ),
    };
  }),
);
