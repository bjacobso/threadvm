import type { ThreadVmModel } from "@threadvm/shared/domain";

export function PortLinks({ ports }: { readonly ports: ThreadVmModel["ports"] }) {
  if (ports.length === 0) {
    return <span className="text-muted-foreground">none</span>;
  }

  return (
    <span className="flex flex-col gap-1">
      {ports.map((port) => (
        <a
          key={`${port.label}-${port.port}`}
          href={port.url}
          className="truncate text-foreground underline-offset-4 hover:underline"
        >
          {port.label}:{port.port}
        </a>
      ))}
    </span>
  );
}

