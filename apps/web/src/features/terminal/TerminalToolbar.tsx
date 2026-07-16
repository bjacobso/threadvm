import type { ComponentProps } from "react";
import {
  CircleIcon,
  ClipboardCopyIcon,
  GitBranchIcon,
  PanelRightIcon,
  RotateCcwIcon,
  UnplugIcon
} from "lucide-react";
import type { ThreadVmModel } from "@threadvm/shared/domain";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ClipboardNotice, TerminalSessionState } from "./terminalAtoms";

interface TerminalToolbarProps {
  readonly selected: ThreadVmModel | undefined;
  readonly session: TerminalSessionState;
  readonly clipboardNotice: ClipboardNotice | undefined;
  readonly onAttach: (restart?: boolean) => void;
  readonly onCopyPendingClipboard: () => void;
  readonly onOpenDetails: () => void;
}

const vmStateClass: Record<ThreadVmModel["state"], string> = {
  discovering: "text-status-blocked",
  creating: "text-status-blocked",
  bootstrapping: "text-status-blocked",
  ready: "text-status-running",
  running: "text-status-running",
  blocked: "text-status-blocked",
  stopped: "text-muted-foreground",
  failed: "text-status-failed",
  destroying: "text-status-failed",
  unknown: "text-muted-foreground"
};

const ToolbarButton = ({
  children,
  className,
  ...props
}: ComponentProps<typeof Button>) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    className={cn("text-muted-foreground", className)}
    {...props}
  >
    {children}
  </Button>
);

export function TerminalToolbar({
  selected,
  session,
  clipboardNotice,
  onAttach,
  onCopyPendingClipboard,
  onOpenDetails
}: TerminalToolbarProps) {
  const primaryLabel =
    session.status === "disconnected" || session.connection
      ? "Reconnect"
      : "Connect";
  const pendingClipboard = clipboardNotice?.status === "pending";
  const selectedState = selected?.state ?? "unknown";

  return (
    <header className="flex h-14 min-w-0 items-center gap-3 bg-background px-4 text-foreground">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-medium">
              {selected?.name ?? "Pick a task"}
            </h2>
            {selected ? (
              <CircleIcon
                className={cn(
                  "size-2 shrink-0 fill-current",
                  vmStateClass[selectedState]
                )}
                aria-hidden="true"
              />
            ) : null}
          </div>
          {selected ? (
            <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              <span className="truncate">{selected.project ?? "Workspace"}</span>
              {selected.branch ? (
                <>
                  <span aria-hidden="true">·</span>
                  <GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{selected.branch}</span>
                </>
              ) : null}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Choose one from the sidebar to get started.
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {pendingClipboard ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton onClick={onCopyPendingClipboard}>
                <ClipboardCopyIcon data-icon="inline-start" />
                Copy
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>Copy terminal clipboard payload</TooltipContent>
          </Tooltip>
        ) : null}
        <ToolbarButton onClick={onOpenDetails}>
          <PanelRightIcon data-icon="inline-start" />
          Details
        </ToolbarButton>
        <ToolbarButton
          disabled={!selected || session.status === "connecting"}
          onClick={() => onAttach(false)}
          className="text-foreground"
        >
          <UnplugIcon data-icon="inline-start" />
          {primaryLabel}
        </ToolbarButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!selected || session.status === "connecting"}
              onClick={() => onAttach(true)}
              aria-label="Restart terminal session"
            >
              <RotateCcwIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Restart terminal session</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
