import type { ThreadVmModel } from "@threadvm/shared/domain";
import { cn } from "@/lib/utils";

const stateClass = (state: ThreadVmModel["state"]) => {
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
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-[10px] uppercase tracking-normal",
        stateClass(state)
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      {state}
    </span>
  );
}
