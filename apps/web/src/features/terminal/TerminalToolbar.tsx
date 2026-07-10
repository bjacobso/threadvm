import { RotateCcwIcon, UnplugIcon } from "lucide-react";
import type { ThreadVmModel } from "@threadvm/shared/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import type { TerminalSessionState } from "@/state/atoms";

interface TerminalToolbarProps {
  readonly selected: ThreadVmModel | undefined;
  readonly session: TerminalSessionState;
  readonly onAttach: (restart?: boolean) => void;
}

export function TerminalToolbar({
  selected,
  session,
  onAttach
}: TerminalToolbarProps) {
  const primaryLabel =
    session.status === "disconnected" || session.attach
      ? "Reconnect"
      : "Attach Terminal";

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
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
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

