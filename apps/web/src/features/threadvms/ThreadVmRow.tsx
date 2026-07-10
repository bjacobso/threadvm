import type { ThreadVmModel } from "@threadvm/shared/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThreadVmStateBadge } from "./ThreadVmStateBadge";

interface ThreadVmRowProps {
  readonly threadVm: ThreadVmModel;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

export function ThreadVmRow({ threadVm, selected, onSelect }: ThreadVmRowProps) {
  const portHint = threadVm.ports[0]
    ? `${threadVm.ports[0].label}:${threadVm.ports[0].port}`
    : threadVm.source;

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "h-auto w-full justify-start rounded-md border border-border/60 px-2.5 py-2 text-left",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        selected && "border-ring bg-sidebar-accent text-sidebar-accent-foreground"
      )}
    >
      <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{threadVm.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {threadVm.branch ?? threadVm.project ?? "unknown"}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          {threadVm.pinned ? <Badge variant="outline">pinned</Badge> : null}
          <ThreadVmStateBadge state={threadVm.state} />
          <span className="max-w-24 truncate text-[0.68rem] text-muted-foreground">
            {portHint}
          </span>
        </span>
      </span>
    </Button>
  );
}
