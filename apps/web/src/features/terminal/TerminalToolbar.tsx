import { useEffect, useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import {
  ChevronRightIcon,
  CircleIcon,
  ClockIcon,
  ClipboardCopyIcon,
  GitBranchIcon,
  ServerIcon,
  RotateCcwIcon,
  TerminalIcon,
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
}

const formatSessionAge = (createdAt: number, now: number) => {
  const elapsedSeconds = Math.max(0, Math.floor((now - createdAt) / 1_000));
  const days = Math.floor(elapsedSeconds / 86_400);
  const hours = Math.floor((elapsedSeconds % 86_400) / 3_600);
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return "<1m";
};

const sessionStatusClass: Record<TerminalSessionState["status"], string> = {
  detached: "text-muted-foreground",
  connecting: "text-status-blocked",
  attached: "text-status-attached",
  disconnected: "text-status-failed",
  exited: "text-muted-foreground"
};

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

const BreadcrumbItem = ({
  icon: Icon,
  children,
  value
}: {
  readonly icon?: typeof GitBranchIcon;
  readonly children?: ReactNode;
  readonly value: string | undefined;
}) =>
  value ? (
    <span className="flex min-w-0 items-center gap-1.5">
      {Icon ? <Icon className="size-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{children ?? value}</span>
    </span>
  ) : null;

const WorkbenchButton = ({
  children,
  className,
  ...props
}: ComponentProps<typeof Button>) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    className={cn(
      "h-7 rounded-none px-2 text-[11px] text-workbench-muted hover:bg-workbench-hover hover:text-workbench-foreground",
      className
    )}
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
  onCopyPendingClipboard
}: TerminalToolbarProps) {
  const [now, setNow] = useState(() => Date.now());
  const primaryLabel =
    session.status === "disconnected" || session.connection
      ? "Reconnect"
      : "Attach Terminal";
  const pendingClipboard = clipboardNotice?.status === "pending";
  const selectedState = selected?.state ?? "unknown";
  const sessionAge = useMemo(
    () =>
      session.connection
        ? formatSessionAge(session.connection.createdAt, now)
        : undefined,
    [now, session.connection]
  );

  useEffect(() => {
    if (!session.connection) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [session.connection]);

  return (
    <header className="flex min-h-0 flex-col border-b border-workbench-border bg-workbench-background text-workbench-foreground">
      <div className="flex h-9 min-w-0 items-center border-b border-workbench-border">
        <div className="flex h-full max-w-[min(52vw,460px)] min-w-0 items-center gap-2 border-r border-t-2 border-workbench-border border-t-workbench-accent bg-workbench-tab px-3 text-xs">
          <TerminalIcon className="size-3.5 shrink-0 text-workbench-icon" />
          <span className="truncate font-medium">
            {selected?.name ?? "terminal"}
          </span>
          <CircleIcon
            className={cn(
              "size-2 shrink-0 fill-current",
              sessionStatusClass[session.status]
            )}
            aria-hidden="true"
          />
        </div>

        <div className="min-w-0 flex-1" />

        <div className="flex h-full shrink-0 items-center">
          {pendingClipboard ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <WorkbenchButton onClick={onCopyPendingClipboard}>
                  <ClipboardCopyIcon data-icon="inline-start" />
                  Copy
                </WorkbenchButton>
              </TooltipTrigger>
              <TooltipContent>Copy terminal clipboard payload</TooltipContent>
            </Tooltip>
          ) : null}
          <WorkbenchButton
            disabled={!selected || session.status === "connecting"}
            onClick={() => onAttach(false)}
            className="text-workbench-foreground"
          >
            <UnplugIcon data-icon="inline-start" />
            {primaryLabel}
          </WorkbenchButton>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 rounded-none text-workbench-muted hover:bg-workbench-hover hover:text-workbench-foreground"
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
      </div>

      <div className="flex h-7 min-w-0 items-center justify-between gap-3 bg-workbench-tab px-3 text-[11px] text-workbench-muted">
        <div className="flex min-w-0 items-center gap-1.5">
          <BreadcrumbItem value="ThreadVM">ThreadVM</BreadcrumbItem>
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
          <BreadcrumbItem value={selected?.project}> 
            {selected?.project}
          </BreadcrumbItem>
          {selected?.project ? (
            <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
          ) : null}
          <BreadcrumbItem value={selected?.name}>
            <span className="text-workbench-foreground">
              {selected?.name ?? "terminal"}
            </span>
          </BreadcrumbItem>
          {selected?.branch ? (
            <>
              <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
              <BreadcrumbItem icon={GitBranchIcon} value={selected.branch} />
            </>
          ) : null}
        </div>
        <div className="hidden min-w-0 shrink-0 items-center gap-3 sm:flex">
          <span className="flex items-center gap-1.5 capitalize">
            <CircleIcon
              className={cn("size-2 fill-current", vmStateClass[selectedState])}
              aria-hidden="true"
            />
            {selected?.state ?? "unknown"}
          </span>
          <span className={cn("capitalize", sessionStatusClass[session.status])}>
            {session.status}
          </span>
          {sessionAge ? (
            <span className="flex items-center gap-1.5">
              <ClockIcon className="size-3" aria-hidden="true" />
              {sessionAge}
            </span>
          ) : null}
          {selected?.host ? (
            <span className="flex max-w-56 items-center gap-1.5 truncate">
              <ServerIcon className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{selected.host}</span>
            </span>
          ) : null}
          {selected?.ports.length ? (
            <span>
              {selected.ports.length} port{selected.ports.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
