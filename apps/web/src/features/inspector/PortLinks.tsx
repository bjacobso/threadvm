import type {
  ThreadVmModel,
  ThreadVmPortStatusModel
} from "@threadvm/shared/domain";
import { cn } from "@/lib/utils";

const statusClass = (status: ThreadVmPortStatusModel["status"]) => {
  switch (status) {
    case "reachable":
      return "text-status-running";
    case "unreachable":
      return "text-status-failed";
    case "unknown":
      return "text-muted-foreground";
  }
};

export function PortLinks({
  ports,
  statuses
}: {
  readonly ports: ThreadVmModel["ports"];
  readonly statuses?: ReadonlyArray<ThreadVmPortStatusModel>;
}) {
  if (ports.length === 0) {
    return <span className="text-[11px] text-workbench-muted">none</span>;
  }

  const statusByPort = new Map(statuses?.map((status) => [status.port, status]));

  return (
    <span className="flex flex-col">
      {ports.map((port) => {
        const status = statusByPort.get(port.port);
        return (
          <span
            key={`${port.label}-${port.port}`}
            className="flex min-h-7 items-center gap-2 border-b border-workbench-border/70 text-[11px]"
          >
            <a
              href={port.url}
              className="min-w-0 truncate text-workbench-foreground underline-offset-4 hover:underline"
            >
              {port.label}:{port.port}
            </a>
            {status ? (
              <span
                className={cn(
                  "ml-auto flex items-center gap-1.5 text-[10px] uppercase",
                  statusClass(status.status)
                )}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {status.status}
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
