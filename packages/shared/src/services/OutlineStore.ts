import { Context, Effect, Layer, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Node, OutlineSnapshot, OperationBatch, AppliedBatch, Proposal, ReviewRequest, type OutlineOperation } from "../domain/outline.js";
import { ThoughtsRepo, OutlineError, outlineIO, atomicWrite } from "./ThoughtsRepo.js";

export const operationNodeId = (op: OutlineOperation) => op.type === "insert" ? op.node.id : op.id;
const emptySnapshot = () => new OutlineSnapshot({ revision: 0, nodes: [], tombstones: {}, proposals: [] });
const fail = (message: string): never => { throw new OutlineError(message); };

export const applyOperations = (snapshot: OutlineSnapshot, batch: OperationBatch): OutlineSnapshot => {
  if (batch.baseRevision > snapshot.revision) fail("baseRevision is ahead of the outline");
  if (!batch.operations.length) fail("An operation batch cannot be empty");
  const revision = snapshot.revision + 1;
  let nodes = [...snapshot.nodes];
  const tombstones = { ...snapshot.tombstones };
  const initial = new Map(nodes.map((node) => [node.id, node]));
  const get = (id: string) => nodes.find((node) => node.id === id) ?? fail(`Missing node ${id}`);
  const unchanged = (id: string) => {
    const node = initial.get(id);
    if (node && node.changedAt > batch.baseRevision) fail(`Conflict: ${id} changed since revision ${batch.baseRevision}`);
  };
  const descendantIds = (id: string): Set<string> => {
    const ids = new Set([id]);
    let added = true;
    while (added) {
      added = false;
      for (const node of nodes) if (node.parent !== null && ids.has(node.parent) && !ids.has(node.id)) {
        ids.add(node.id); added = true;
      }
    }
    return ids;
  };
  const place = (node: Node, after: string | null | undefined) => {
    if (node.parent !== null) get(node.parent);
    if (after != null) {
      const anchor = get(after);
      if (anchor.parent !== node.parent || anchor.id === node.id) fail("Anchor must be another sibling");
    }
    const siblings = nodes.filter((n) => n.parent === node.parent);
    const anchor = after === undefined ? siblings.at(-1)?.id : after;
    const index = anchor ? nodes.findIndex((n) => n.id === anchor) + 1 :
      siblings.length ? nodes.findIndex((n) => n.id === siblings[0].id) : nodes.length;
    nodes.splice(index, 0, node);
  };
  for (const op of batch.operations) {
    const id = operationNodeId(op);
    if (op.type === "insert") {
      if (nodes.some((node) => node.id === id) || id in tombstones) fail(`Node ID ${id} has already been used`);
      place(new Node({ ...op.node, parent: op.parent, changedAt: revision }), op.after);
      continue;
    }
    unchanged(id);
    const node = get(id);
    if (op.type === "update") {
      nodes = nodes.map((n) => n.id === id ? new Node({ ...n, ...op.patch, changedAt: revision }) : n);
    } else if (op.type === "delete") {
      const ids = descendantIds(id);
      for (const child of ids) { unchanged(child); tombstones[child] = revision; }
      nodes = nodes.filter((n) => !ids.has(n.id));
    } else {
      if (op.parent !== null && descendantIds(id).has(op.parent)) fail("Moving a node cannot create a cycle");
      nodes = nodes.filter((n) => n.id !== id);
      place(new Node({ ...node, parent: op.parent, changedAt: revision }), op.after);
    }
  }
  return new OutlineSnapshot({ ...snapshot, revision, nodes, tombstones });
};

export const renderMarkdown = (snapshot: OutlineSnapshot): string => {
  const lines: string[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const node of snapshot.nodes.filter((n) => n.parent === parent)) {
      lines.push(`${"  ".repeat(depth)}- [${node.done ? "x" : " "}] ${node.text.replace(/\n/g, " ")} ^${node.id}`);
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return `${lines.join("\n")}\n`;
};

export class OutlineStore extends Context.Service<OutlineStore, {
  readonly init: Effect.Effect<OutlineSnapshot, OutlineError>;
  readonly read: Effect.Effect<OutlineSnapshot, OutlineError>;
  readonly apply: (batch: OperationBatch) => Effect.Effect<OutlineSnapshot, OutlineError>;
  readonly propose: (batch: OperationBatch, runId?: string) => Effect.Effect<Proposal, OutlineError>;
  readonly review: (request: ReviewRequest) => Effect.Effect<OutlineSnapshot, OutlineError>;
}>()("OutlineStore") {}

export const OutlineStoreLive = Layer.effect(OutlineStore, Effect.gen(function* () {
  const repo = yield* ThoughtsRepo;
  const decode = Schema.decodeUnknownEffect(OutlineSnapshot);
  const readAt = (sha: string) => repo.git(["show", `${sha}:snapshot.json`]).pipe(
    Effect.flatMap((text) => Effect.try({ try: () => JSON.parse(text), catch: (e) => new OutlineError(String(e)) })),
    Effect.flatMap((json) => decode(json).pipe(Effect.mapError((e) => new OutlineError(String(e)))))
  );
  const read = repo.git(["rev-parse", "HEAD"]).pipe(Effect.flatMap(readAt));
  const persist = (snapshot: OutlineSnapshot, ops: string, message: string) => Effect.gen(function* () {
    yield* outlineIO(async () => {
      await atomicWrite(join(repo.dir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
      await atomicWrite(join(repo.dir, "ops.jsonl"), ops);
      await atomicWrite(join(repo.dir, "outline.md"), renderMarkdown(snapshot));
    });
    yield* repo.git(["add", "--", "snapshot.json", "ops.jsonl", "outline.md", ".gitignore"]);
    yield* repo.git(["-c", "commit.gpgsign=false", "commit", "--no-verify", "--only", "-m", message, "--", "snapshot.json", "ops.jsonl", "outline.md", ".gitignore"]);
    return snapshot;
  });
  const opsLog = repo.git(["show", "HEAD:ops.jsonl"]).pipe(Effect.map((text) => text ? `${text}\n` : ""));
  const apply = (input: OperationBatch) => repo.withLock(Effect.gen(function* () {
    const batch = yield* Schema.decodeUnknownEffect(OperationBatch)(input).pipe(Effect.mapError((e) => new OutlineError(String(e))));
    const snapshot = yield* read;
    const next = yield* Effect.try({ try: () => applyOperations(snapshot, batch), catch: (e) => new OutlineError(String(e)) });
    const record = new AppliedBatch({ ...batch, id: randomUUID(), revision: next.revision, time: Date.now(), actor: "human" });
    return yield* persist(next, `${yield* opsLog}${JSON.stringify(record)}\n`, `outline: human batch ${record.id}`);
  }));
  return {
    read, apply,
    init: repo.init.pipe(Effect.andThen(repo.withLock(Effect.gen(function* () {
      const head = yield* Effect.result(repo.git(["rev-parse", "--verify", "HEAD"]));
      if (head._tag === "Success") {
        yield* repo.git(["restore", "--source=HEAD", "--staged", "--worktree", "--", "snapshot.json", "ops.jsonl", "outline.md"]);
        return yield* read;
      }
      return yield* persist(emptySnapshot(), "", "Initialize ThreadVM outline");
    })))),
    propose: (input, runId) => repo.withLock(Effect.gen(function* () {
      const batch = yield* Schema.decodeUnknownEffect(OperationBatch)(input).pipe(Effect.mapError((e) => new OutlineError(String(e))));
      const snapshot = yield* read;
      yield* Effect.try({ try: () => applyOperations(snapshot, batch), catch: (e) => new OutlineError(String(e)) });
      const proposal = new Proposal({ id: randomUUID(), batch, runId, createdAt: Date.now(),
        pending: [...new Set(batch.operations.map(operationNodeId))], accepted: [], rejected: [] });
      yield* persist(new OutlineSnapshot({ ...snapshot, proposals: [...snapshot.proposals, proposal] }), yield* opsLog, `proposal: submit ${proposal.id}`);
      return proposal;
    })),
    review: (request) => repo.withLock(Effect.gen(function* () {
      const snapshot = yield* read;
      const proposal = snapshot.proposals.find((p) => p.id === request.proposalId);
      if (!proposal) return yield* Effect.fail(new OutlineError("Proposal not found"));
      const ids = request.nodeIds ?? proposal.pending;
      if (!ids.length || ids.some((id) => !proposal.pending.includes(id))) return yield* Effect.fail(new OutlineError("Select pending proposal nodes"));
      let next = snapshot;
      let log = yield* opsLog;
      if (request.decision === "accept") {
        const batch = new OperationBatch({ baseRevision: proposal.batch.baseRevision, operations: proposal.batch.operations.filter((op) => ids.includes(operationNodeId(op))) });
        // Nodes already accepted from this proposal may be referenced by the rest.
        // Only the selected node's own revision participates in conflict checking.
        next = yield* Effect.try({ try: () => applyOperations(snapshot, batch), catch: (e) => new OutlineError(String(e)) });
        const record = new AppliedBatch({ ...batch, id: randomUUID(), revision: next.revision, actor: "accepted", proposalId: proposal.id, runId: proposal.runId, time: Date.now() });
        log += `${JSON.stringify(record)}\n`;
      }
      const reviewed = new Proposal({ ...proposal,
        pending: proposal.pending.filter((id) => !ids.includes(id)),
        accepted: request.decision === "accept" ? [...proposal.accepted, ...ids] : proposal.accepted,
        rejected: request.decision === "reject" ? [...proposal.rejected, ...ids] : proposal.rejected
      });
      next = new OutlineSnapshot({ ...next, proposals: next.proposals.map((p) => p.id === reviewed.id ? reviewed : p) });
      return yield* persist(next, log, `proposal: ${request.decision} ${proposal.id} (${ids.join(", ")})`);
    }))
  };
}));
