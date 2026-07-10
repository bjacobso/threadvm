import type { ThreadVmModel } from "@threadvm/shared/domain";
import {
  ClipboardCopyIcon,
  ExternalLinkIcon,
  MoreVerticalIcon,
  PinIcon,
  RadarIcon
} from "lucide-react";
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
        "group grid w-full grid-cols-[minmax(0,1fr)_auto] border-l-2 border-transparent",
        "text-workbench-foreground hover:bg-workbench-hover",
        selected && "border-l-workbench-accent bg-workbench-hover"
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "h-8 min-w-0 justify-start rounded-none border-0 px-2 py-0 text-left text-xs",
          "hover:bg-transparent hover:text-workbench-foreground"
        )}
      >
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <span className="flex min-w-0 items-center gap-2">
            {threadVm.pinned ? (
              <PinIcon className="size-3 shrink-0 text-workbench-muted" />
            ) : (
              <span className="size-3 shrink-0" />
            )}
            <span className="min-w-0">
              <span className="block truncate font-medium">{threadVm.name}</span>
              <span className="block truncate text-[10px] leading-none text-workbench-muted">
                {threadVm.branch ?? threadVm.project ?? "unknown"}
              </span>
            </span>
          </span>
          <span className="flex min-w-0 items-center justify-end gap-2">
            <ThreadVmStateBadge state={threadVm.state} />
            <span className="hidden max-w-16 truncate text-[10px] text-workbench-muted 2xl:inline">
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
            size="icon-xs"
            className="h-8 rounded-none text-workbench-muted opacity-0 hover:bg-workbench-hover hover:text-workbench-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
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
