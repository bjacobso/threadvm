import type { ThreadVmModel } from "@threadvm/shared/domain";
import {
  ClipboardCopyIcon,
  ExternalLinkIcon,
  MoreVerticalIcon,
  PinIcon,
  RadarIcon,
  ServerIcon
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
import { ThreadVmStateDot } from "./ThreadVmStateBadge";
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
  const previewUrl = firstPreviewUrl(threadVm);
  const description = threadVm.branch ?? threadVm.project ?? threadVm.host;

  return (
    <div
      className={cn(
        "group grid h-5 w-full grid-cols-[minmax(0,1fr)_auto] border-l-2 border-transparent",
        "text-workbench-foreground hover:bg-workbench-hover",
        selected && "border-l-workbench-accent bg-workbench-hover"
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        title={`${threadVm.name} - ${description}`}
        className={cn(
          "h-5 min-w-0 justify-start rounded-none border-0 py-0 pr-2 pl-3 text-left text-[11px] font-normal",
          "hover:bg-transparent hover:text-workbench-foreground"
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="relative flex w-4 shrink-0 justify-center">
            {threadVm.pinned ? (
              <PinIcon className="size-2.5 text-workbench-muted" />
            ) : (
              <ServerIcon className="size-2.5 text-workbench-muted" />
            )}
            <ThreadVmStateDot
              state={threadVm.state}
              className="absolute -right-0.5 -bottom-0.5 ring-1 ring-workbench-background"
            />
          </span>
          <span className="min-w-0 truncate">{threadVm.name}</span>
          <span className="hidden min-w-0 truncate text-[10px] text-workbench-muted 2xl:inline">
            {description}
          </span>
        </span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="h-5 rounded-none text-workbench-muted opacity-0 hover:bg-workbench-hover hover:text-workbench-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
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
