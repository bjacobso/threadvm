import { useEffect, useMemo, useState } from "react";
import { ClipboardCopyIcon, RotateCcwIcon, UnplugIcon } from "lucide-react";
import type { ThreadVmModel } from "@threadvm/shared/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import type { ClipboardNotice, TerminalSessionState } from "@/state/atoms";

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

export function TerminalToolbar({
  selected,
  session,
  clipboardNotice,
  onAttach,
  onCopyPendingClipboard
}: TerminalToolbarProps) {
  const [now, setNow] = useState(() => Date.now());
  const primaryLabel =
    session.status === "disconnected" || session.attach
      ? "Reconnect"
      : "Attach Terminal";
  const pendingClipboard = clipboardNotice?.status === "pending";
  const sessionAge = useMemo(
    () =>
      session.attach
        ? formatSessionAge(session.attach.createdAt, now)
        : undefined,
    [now, session.attach]
  );

  useEffect(() => {
    if (!session.attach) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [session.attach]);

  return (
    <div className="flex h-14 items-center justify-between gap-3 border-b bg-background px-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <strong className="truncate text-sm">
            {selected?.name ?? "No ThreadVM selected"}
          </strong>
          <Badge variant="secondary" className="capitalize">
            {session.status}
          </Badge>
          {session.attach ? (
            <Badge variant="outline">
              {session.attach.reused ? "reused" : "new"} session
            </Badge>
          ) : null}
          {sessionAge ? <Badge variant="outline">{sessionAge}</Badge> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {pendingClipboard ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCopyPendingClipboard}
              >
                <ClipboardCopyIcon data-icon="inline-start" />
                Copy
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy terminal clipboard payload</TooltipContent>
          </Tooltip>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!selected || session.status === "connecting"}
          onClick={() => onAttach(false)}
        >
          <UnplugIcon data-icon="inline-start" />
          {primaryLabel}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
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
    </div>
  );
}
