import type { ThreadVmModel } from "@threadvm/shared/domain";
import {
  ClipboardCopyIcon,
  ExternalLinkIcon,
  MoreVerticalIcon,
  PinIcon,
  RadarIcon,
  MessageSquareIcon
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem
} from "@/components/ui/sidebar";
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
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        isActive={selected}
        tooltip={`${threadVm.name} - ${description}`}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="h-9 font-normal"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="relative flex w-4 shrink-0 justify-center">
            {threadVm.pinned ? (
              <PinIcon className="text-muted-foreground" />
            ) : (
              <MessageSquareIcon className="text-muted-foreground" />
            )}
            <ThreadVmStateDot
              state={threadVm.state}
              className="absolute -right-0.5 -bottom-0.5 ring-2 ring-sidebar"
            />
          </span>
          <span className="min-w-0 truncate">{threadVm.name}</span>
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground 2xl:inline">
            {description}
          </span>
        </span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            type="button"
            showOnHover
            className="text-muted-foreground data-[state=open]:opacity-100"
            aria-label={`Open actions for ${threadVm.name}`}
          >
            <MoreVerticalIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onCopyHost}>
              <ClipboardCopyIcon data-icon="inline-start" />
              Copy address
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={previewUrl === undefined}
              onClick={onOpenPreview}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              Open preview
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={threadVm.ports.length === 0}
              onClick={onCheckPorts}
            >
              <RadarIcon data-icon="inline-start" />
              Check ports
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
