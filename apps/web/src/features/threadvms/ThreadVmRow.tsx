import type { ThreadVmModel } from "@threadvm/shared/domain";
import {
  ClipboardCopyIcon,
  ExternalLinkIcon,
  MoreVerticalIcon,
  RadarIcon
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ThreadVmStateBadge } from "./ThreadVmStateBadge";
import { firstPreviewUrl } from "./threadVmActions";

interface ThreadVmRowProps {
  readonly threadVm: ThreadVmModel;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onCheckPorts: () => void;
  readonly onCopyHost: () => void;
  readonly onOpenPreview: () => void;
}

export function ThreadVmRow({
  threadVm,
  selected,
  onSelect,
  onCheckPorts,
  onCopyHost,
  onOpenPreview
}: ThreadVmRowProps) {
  const portHint = threadVm.ports[0]
    ? `${threadVm.ports[0].label}:${threadVm.ports[0].port}`
    : threadVm.source;
  const previewUrl = firstPreviewUrl(threadVm);

  return (
    <div
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-md border border-border/60",
        selected && "border-ring bg-sidebar-accent text-sidebar-accent-foreground"
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "h-auto min-w-0 justify-start rounded-none border-0 px-2.5 py-2 text-left",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-full rounded-none border-l border-border/60"
            aria-label={`Open actions for ${threadVm.name}`}
          >
            <MoreVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onCopyHost}>
              <ClipboardCopyIcon data-icon="inline-start" />
              Copy Host
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={previewUrl === undefined}
              onClick={onOpenPreview}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              Open Preview
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={threadVm.ports.length === 0}
              onClick={onCheckPorts}
            >
              <RadarIcon data-icon="inline-start" />
              Check Ports
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
