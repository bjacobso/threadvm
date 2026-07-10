import type { ThreadVmModel } from "@threadvm/shared/domain";
import { Badge } from "@/components/ui/badge";

const stateVariant = (
  state: ThreadVmModel["state"]
): "default" | "secondary" | "destructive" | "outline" => {
  switch (state) {
    case "running":
    case "ready":
      return "default";
    case "blocked":
    case "failed":
      return "destructive";
    case "stopped":
    case "destroying":
      return "outline";
    default:
      return "secondary";
  }
};

export function ThreadVmStateBadge({ state }: { readonly state: ThreadVmModel["state"] }) {
  return (
    <Badge variant={stateVariant(state)} className="text-[0.68rem] capitalize">
      {state}
    </Badge>
  );
}

