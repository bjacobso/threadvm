import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useSelectedThreadVm } from "@/state/atoms";
import { ThreadVmStateBadge } from "../threadvms/ThreadVmStateBadge";
import { LifecycleActions } from "./LifecycleActions";
import { MetadataTable } from "./MetadataTable";
import { PortLinks } from "./PortLinks";

export function InspectorPanel() {
  const selected = useSelectedThreadVm();

  return (
    <aside className="flex h-full w-full min-h-0 min-w-0 flex-col border-l bg-sidebar text-sidebar-foreground">
      <header className="px-4 py-4">
        <h2 className="text-sm font-semibold">Inspector</h2>
      </header>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <ThreadVmStateBadge state={selected.state} />
                <Badge variant="outline">{selected.source}</Badge>
              </div>
              <MetadataTable
                rows={[
                  ["Host", selected.host],
                  ["Project", selected.project ?? "unknown"],
                  ["Branch", selected.branch ?? "unknown"],
                  ["Source", selected.source],
                  ["Ports", <PortLinks ports={selected.ports} />],
                  [
                    "Raw",
                    <span className="whitespace-pre-wrap">{selected.raw ?? "none"}</span>
                  ]
                ]}
              />
              <Separator />
              <LifecycleActions threadVm={selected} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a ThreadVM.</p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
