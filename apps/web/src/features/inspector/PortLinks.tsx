import type {
  ThreadVmModel,
  ThreadVmPortStatusModel
} from "@threadvm/shared/domain";
import { Badge } from "@/components/ui/badge";

const statusVariant = (status: ThreadVmPortStatusModel["status"]) => {
  switch (status) {
    case "reachable":
      return "secondary";
    case "unreachable":
      return "destructive";
    case "unknown":
      return "outline";
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
    return <span className="text-muted-foreground">none</span>;
  }

  const statusByPort = new Map(statuses?.map((status) => [status.port, status]));

  return (
    <span className="flex flex-col gap-1">
      {ports.map((port) => {
        const status = statusByPort.get(port.port);
        return (
          <span key={`${port.label}-${port.port}`} className="flex flex-wrap gap-2">
            <a
              href={port.url}
              className="truncate text-foreground underline-offset-4 hover:underline"
            >
              {port.label}:{port.port}
            </a>
            {status ? (
              <Badge variant={statusVariant(status.status)}>
                {status.status}
              </Badge>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
