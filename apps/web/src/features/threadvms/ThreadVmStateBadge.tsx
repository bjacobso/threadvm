import type { ThreadVmModel } from "@threadvm/shared/domain";
import { cn } from "@/lib/utils";

const stateDotClass = (state: ThreadVmModel["state"]) => {
  switch (state) {
    case "running":
    case "ready":
      return "text-status-running";
    case "blocked":
    case "destroying":
    case "failed":
      return "text-status-failed";
    case "stopped":
    case "unknown":
      return "text-muted-foreground";
    default:
      return "text-status-blocked";
  }
};

export function ThreadVmStateBadge({ state }: { readonly state: ThreadVmModel["state"] }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-current",
          stateDotClass(state)
        )}
      />
      {state}
    </span>
  );
}

export function ThreadVmStateDot({
  state,
  className
}: {
  readonly state: ThreadVmModel["state"];
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "size-1.5 rounded-full bg-current",
        stateDotClass(state),
        className
      )}
      title={state}
      aria-label={state}
    />
  );
}
