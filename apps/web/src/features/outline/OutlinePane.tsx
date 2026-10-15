import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CornerDownRightIcon,
  CornerUpLeftIcon,
  PlusIcon,
  PlayIcon,
  Trash2Icon,
  GitBranchIcon,
  TerminalIcon,
  CheckIcon
} from "lucide-react";
import {
  InsertOperation,
  MoveOperation,
  UpdateOperation,
  DeleteOperation,
  NodeDraft,
  NodePatch,
  type Node,
  type OutlineOperation,
  type Proposal,
  type Run,
  type ThreadVmModel
} from "@threadvm/shared/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { TerminalPane } from "@/features/terminal/TerminalPane";
import { cn } from "@/lib/utils";
import {
  outlineActions,
  outlineAtom,
  outlineBusyAtom,
  outlineErrorAtom,
  refreshOutline,
  useAtomRef
} from "./outlineAtoms";

const opId = (op: OutlineOperation) =>
  op.type === "insert" ? op.node.id : op.id;

function RunPanel({ run }: { run: Run }) {
  const view = useAtomRef(outlineAtom);
  const [terminalOpen, setTerminalOpen] = useState(
    () => window.localStorage.getItem(`threadvm.run.${run.id}`) === "open"
  );
  const selected = useMemo<ThreadVmModel>(
    () => ({
      id: `run-${run.id}`,
      name: `${run.agent} · ${run.id.slice(0, 8)}`,
      host: "localhost",
      state: "running",
      source: "cache",
      branch: run.branch,
      ports: []
    }),
    [run.id, run.agent, run.branch]
  );
  const observations =
    view?.events
      .filter(
        (e) =>
          e.runId === run.id &&
          ["observation", "output", "commit", "pr", "failed"].includes(e.kind)
      )
      .slice(-5) ?? [];
  return (
    <section
      className="my-3 overflow-hidden rounded-lg border border-border bg-card"
      aria-label={`Run ${run.id}`}
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs">
        <span
          className={cn(
            "flex items-center gap-2",
            run.status === "running"
              ? "text-status-running"
              : run.status === "failed"
                ? "text-status-failed"
                : "text-muted-foreground"
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {run.status}
        </span>
        <Badge variant="secondary">{run.agent}</Badge>
        <span className="text-muted-foreground">{run.id.slice(0, 8)}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-muted-foreground">
          <GitBranchIcon className="size-3" />
          {run.branch}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setTerminalOpen(!terminalOpen);
            window.localStorage.setItem(
              `threadvm.run.${run.id}`,
              terminalOpen ? "closed" : "open"
            );
          }}
        >
          <TerminalIcon />
          {terminalOpen ? "Hide terminal" : "Open terminal"}
        </Button>
      </div>
      {observations.length > 0 && (
        <div className="space-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {observations.map((event) => (
            <p key={event.id} className="break-words">
              <span className="mr-3 text-foreground">{event.kind}</span>
              {event.message}
            </p>
          ))}
        </div>
      )}
      {terminalOpen && (
        <div className="h-[360px] border-t border-border">
          <TerminalPane selected={selected} />
        </div>
      )}
    </section>
  );
}

function ProposalCard({
  proposal,
  nodeId,
  operations
}: {
  proposal: Proposal;
  nodeId: string;
  operations: ReadonlyArray<OutlineOperation>;
}) {
  const busy = useAtomRef(outlineBusyAtom);
  return (
    <div
      className="my-2 rounded-md border border-status-blocked/40 bg-status-blocked/5 px-3 py-2"
      data-proposal-node={nodeId}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-status-blocked">
        <Badge variant="outline">Proposed</Badge>
        <span>
          {proposal.runId ? `run ${proposal.runId.slice(0, 8)}` : "agent"} ·{" "}
          {nodeId}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            void outlineActions.review(proposal.id, "accept", [nodeId])
          }
        >
          Accept node
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            void outlineActions.review(proposal.id, "reject", [nodeId])
          }
        >
          Reject node
        </Button>
      </div>
      {operations.map((op, index) => (
        <p key={index} className="py-1 text-sm">
          {op.type === "insert" ? (
            op.node.text
          ) : op.type === "update" ? (
            <>
              <span className="text-muted-foreground">Update → </span>
              {op.patch.text}
              {op.patch.done === undefined ? null : (
                <span className="ml-2 text-muted-foreground">
                  [{op.patch.done ? "complete" : "incomplete"}]
                </span>
              )}
            </>
          ) : op.type === "move" ? (
            `Move → ${op.parent ?? "root"} (after ${op.after ?? "first"})`
          ) : (
            "Delete this subtree"
          )}
        </p>
      ))}
    </div>
  );
}

function NodeEditor({
  node,
  onAdd
}: {
  node: Node;
  onAdd: (parent: string | null, after?: string) => Promise<void>;
}) {
  const view = useAtomRef(outlineAtom)!;
  const busy = useAtomRef(outlineBusyAtom);
  const [text, setText] = useState(node.text);
  const [agent, setAgent] = useState<"shell" | "codex" | "claude">("shell");
  const [runOpen, setRunOpen] = useState(false);
  const siblings = view.snapshot.nodes.filter((n) => n.parent === node.parent);
  const index = siblings.findIndex((n) => n.id === node.id);
  const editing = useRef(false);
  const editingRevision = useRef(view.snapshot.revision);
  useEffect(() => {
    if (!editing.current) setText(node.text);
  }, [node.text]);
  const save = async () => {
    if (text === node.text || text.endsWith("/run")) return true;
    return outlineActions.apply(
      [
        new UpdateOperation({
          type: "update",
          id: node.id,
          patch: new NodePatch({ text })
        })
      ],
      editingRevision.current
    );
  };
  const move = async (operation: MoveOperation) => {
    if (await outlineActions.apply([operation]))
      window.requestAnimationFrame(() =>
        document
          .querySelector<HTMLInputElement>(`[aria-label="Edit ${node.id}"]`)
          ?.focus()
      );
  };
  const indent = () =>
    index > 0 &&
    move(
      new MoveOperation({
        type: "move",
        id: node.id,
        parent: siblings[index - 1].id
      })
    );
  const outdent = () => {
    const parent = view.snapshot.nodes.find((n) => n.id === node.parent);
    return (
      parent &&
      move(
        new MoveOperation({
          type: "move",
          id: node.id,
          parent: parent.parent,
          after: parent.id
        })
      )
    );
  };
  const reorder = (direction: -1 | 1) => {
    if (direction === -1 && index > 0)
      return move(
        new MoveOperation({
          type: "move",
          id: node.id,
          parent: node.parent,
          after: index > 1 ? siblings[index - 2].id : null
        })
      );
    if (direction === 1 && index < siblings.length - 1)
      return move(
        new MoveOperation({
          type: "move",
          id: node.id,
          parent: node.parent,
          after: siblings[index + 1].id
        })
      );
  };
  return (
    <div className="group/node" data-node-id={node.id}>
      <div className="flex min-w-0 items-center gap-2 rounded-md py-1 hover:bg-muted/30">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Toggle done ${node.id}`}
          disabled={busy}
          onClick={() =>
            void outlineActions.apply([
              new UpdateOperation({
                type: "update",
                id: node.id,
                patch: new NodePatch({ done: !node.done })
              })
            ])
          }
        >
          {node.done ? (
            <CheckIcon className="text-status-running" />
          ) : (
            <span className="size-2 rounded-full border border-muted-foreground" />
          )}
        </Button>
        <Input
          aria-label={`Edit ${node.id}`}
          value={text}
          className={cn(
            "h-9 min-w-16 flex-1 border-transparent bg-transparent shadow-none focus-visible:border-input",
            node.done && "text-muted-foreground line-through"
          )}
          onFocus={() => {
            editing.current = true;
            editingRevision.current = view.snapshot.revision;
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            editing.current = false;
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (text.trim().endsWith("/run")) {
                setText(node.text);
                setRunOpen(true);
              } else
                void save().then((ok) => {
                  if (ok) void onAdd(node.parent, node.id);
                });
            }
            if (e.key === "Tab") {
              e.preventDefault();
              void save().then((ok) => {
                if (ok) void (e.shiftKey ? outdent() : indent());
              });
            }
            if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
              e.preventDefault();
              void reorder(e.key === "ArrowUp" ? -1 : 1);
            }
          }}
        />
        <span className="hidden text-[10px] text-muted-foreground lg:inline">
          {node.id.slice(0, 8)}
        </span>
        <div className="flex shrink-0 items-center">
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy || index === 0}
            aria-label={`Indent ${node.id}`}
            onClick={() => void indent()}
          >
            <CornerDownRightIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy || !node.parent}
            aria-label={`Outdent ${node.id}`}
            onClick={() => void outdent()}
          >
            <CornerUpLeftIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy || index === 0}
            aria-label={`Move up ${node.id}`}
            onClick={() => void reorder(-1)}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy || index === siblings.length - 1}
            aria-label={`Move down ${node.id}`}
            onClick={() => void reorder(1)}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            aria-label={`Add child ${node.id}`}
            onClick={() => void onAdd(node.id)}
          >
            <PlusIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            aria-label={`Delete ${node.id}`}
            onClick={() =>
              void outlineActions.apply([
                new DeleteOperation({ type: "delete", id: node.id })
              ])
            }
          >
            <Trash2Icon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setRunOpen(!runOpen)}
            aria-label={`Run ${node.id}`}
          >
            <PlayIcon />
            Run
          </Button>
        </div>
      </div>
      {runOpen && (
        <div className="my-2 ml-10 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
          <span className="mr-2 text-muted-foreground">
            Delegate this intent
          </span>
          <Select
            value={agent}
            onValueChange={(value) => setAgent(value as typeof agent)}
          >
            <SelectTrigger className="w-32" aria-label={`Executor ${node.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shell">shell</SelectItem>
              <SelectItem value="codex">codex</SelectItem>
              <SelectItem value="claude">claude</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void outlineActions.run(node.id, agent).then((ok) => {
                if (ok) setRunOpen(false);
              })
            }
          >
            Start run
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRunOpen(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

export function OutlinePane() {
  const view = useAtomRef(outlineAtom);
  const error = useAtomRef(outlineErrorAtom);
  const busy = useAtomRef(outlineBusyAtom);
  useEffect(() => {
    void refreshOutline();
    const timer = window.setInterval(() => void refreshOutline(), 1500);
    return () => window.clearInterval(timer);
  }, []);
  const add = async (parent: string | null, after?: string) => {
    const id = `n${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const ok = await outlineActions.apply([
      new InsertOperation({
        type: "insert",
        parent,
        after,
        node: new NodeDraft({ id, text: "", done: false })
      })
    ]);
    if (ok)
      window.requestAnimationFrame(() =>
        document
          .querySelector<HTMLInputElement>(`[aria-label="Edit ${id}"]`)
          ?.focus()
      );
  };
  const proposals =
    view?.snapshot.proposals.filter((p) => p.pending.length) ?? [];
  const availableIds = new Set([
    ...(view?.snapshot.nodes.map((node) => node.id) ?? []),
    ...proposals.flatMap((proposal) =>
      proposal.batch.operations
        .filter(
          (op) => op.type === "insert" && proposal.pending.includes(opId(op))
        )
        .map(opId)
    )
  ]);
  const unplaced = proposals.flatMap((proposal) =>
    proposal.pending.flatMap((nodeId) => {
      const operations = proposal.batch.operations.filter(
        (op) => opId(op) === nodeId
      );
      const first = operations[0];
      const missing =
        first.type === "insert" || first.type === "move"
          ? first.parent !== null && !availableIds.has(first.parent)
          : !availableIds.has(nodeId);
      return missing ? [{ proposal, nodeId, operations }] : [];
    })
  );
  const renderChildren = (
    parent: string | null,
    ancestors = new Set<string>()
  ): React.ReactNode => {
    if (!view || (parent && ancestors.has(parent))) return null;
    const visited = new Set(ancestors);
    if (parent) visited.add(parent);
    const entries: Array<{
      id: string;
      node?: Node;
      proposal?: Proposal;
      op?: OutlineOperation;
    }> = view.snapshot.nodes
      .filter((n) => n.parent === parent)
      .map((node) => ({ id: node.id, node }));
    for (const proposal of proposals)
      for (const op of proposal.batch.operations) {
        if (
          (op.type !== "insert" && op.type !== "move") ||
          op.parent !== parent ||
          !proposal.pending.includes(opId(op))
        )
          continue;
        const entry = { id: opId(op), proposal, op };
        const index =
          op.after === undefined
            ? entries.length
            : op.after === null
              ? 0
              : entries.findIndex((e) => e.id === op.after) + 1;
        entries.splice(index, 0, entry);
      }
    return entries.map((entry) => (
      <Fragment
        key={entry.proposal ? `${entry.proposal.id}-${entry.id}` : entry.id}
      >
        {entry.node ? (
          <>
            <NodeEditor node={entry.node} onAdd={add} />
            {proposals.map((p) => {
              const ops = p.batch.operations.filter(
                (op) =>
                  p.pending.includes(opId(op)) &&
                  opId(op) === entry.id &&
                  op.type !== "insert" &&
                  op.type !== "move"
              );
              return ops.length ? (
                <div key={p.id} className="ml-10">
                  <ProposalCard
                    proposal={p}
                    nodeId={entry.id}
                    operations={ops}
                  />
                </div>
              ) : null;
            })}
            <div className="ml-10">
              {view.runs
                .filter((r) => r.nodeId === entry.id)
                .map((run) => (
                  <RunPanel key={run.id} run={run} />
                ))}
            </div>
          </>
        ) : (
          <div className="ml-10">
            <ProposalCard
              proposal={entry.proposal!}
              nodeId={entry.id}
              operations={entry.proposal!.batch.operations.filter(
                (op) => opId(op) === entry.id
              )}
            />
          </div>
        )}
        {(!entry.op || entry.op.type === "insert") && (
          <div className="ml-6 border-l border-border/60 pl-3">
            {renderChildren(entry.id, visited)}
          </div>
        )}
      </Fragment>
    ));
  };
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl px-5 py-10 md:px-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
              Intent / execution / thought history
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {view?.projectDir.split("/").at(-1) ?? "Your outline"}
            </h1>
            <p className="mt-2 text-xs text-muted-foreground">
              Humans author intent. Agents execute and propose.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline">
              revision {view?.snapshot.revision ?? "—"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !view}
              onClick={() => void add(null)}
            >
              <PlusIcon />
              Add bullet
            </Button>
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-xs text-destructive"
          >
            {error}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                outlineErrorAtom.set(undefined);
                void refreshOutline();
              }}
            >
              Retry
            </Button>
            {!view && (
              <p className="mt-2">
                Run threadvm init in this project, then threadvm open.
              </p>
            )}
          </div>
        )}
        {proposals.map((p) => (
          <div
            key={p.id}
            className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-status-blocked/30 bg-status-blocked/5 px-4 py-3 text-xs"
          >
            <span className="text-status-blocked">
              {p.pending.length} proposed node
              {p.pending.length === 1 ? "" : "s"}
            </span>
            <span className="text-muted-foreground">{p.id.slice(0, 8)}</span>
            <span className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void outlineActions.review(p.id, "accept")}
            >
              Accept batch
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void outlineActions.review(p.id, "reject")}
            >
              Reject batch
            </Button>
          </div>
        ))}
        <div className="my-6">{renderChildren(null)}</div>
        {unplaced.length > 0 && (
          <section className="my-6">
            <p className="text-xs text-status-blocked">
              These proposal targets were removed. Review or reject the
              remaining changes.
            </p>
            {unplaced.map((entry) => (
              <ProposalCard
                key={`${entry.proposal.id}-${entry.nodeId}`}
                {...entry}
              />
            ))}
          </section>
        )}
        {view && !view.snapshot.nodes.length && (
          <div className="rounded-lg border border-dashed border-border px-8 py-12 text-center">
            <h2 className="text-lg">Give your next idea a place to grow.</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Start with a bullet. Break it down, then delegate a node when it
              is ready.
            </p>
            <Button className="mt-6" onClick={() => void add(null)}>
              Create first bullet
            </Button>
          </div>
        )}
        <div className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
          <span>Enter · next bullet</span>
          <span>Tab / Shift-Tab · indent / outdent</span>
          <span>Alt + ↑ / ↓ · reorder</span>
          <span>/run + Enter · delegate</span>
          <span className="ml-auto">
            {view?.runs.filter((r) => r.status === "running").length ?? 0}{" "}
            running
          </span>
        </div>
      </div>
    </div>
  );
}
