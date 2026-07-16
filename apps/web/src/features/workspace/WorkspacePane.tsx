import { useEffect, useState } from "react";
import type { ThreadVmModel } from "@threadvm/shared/domain";
import { FileTextIcon, TerminalIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/components/ui/tabs";
import { PlanPane } from "@/features/plan/PlanPane";
import { TerminalPane } from "@/features/terminal/TerminalPane";
import { cn } from "@/lib/utils";
import { readStored, writeStored } from "@/state/storage";

type WorkspaceView = "terminal" | "plan";

interface WorkspacePaneProps {
  readonly selected: ThreadVmModel | undefined;
  readonly onOpenDetails: () => void;
}

const viewKey = (threadVmId: string) =>
  `threadvm.workspaceView.${threadVmId}`;

const storedView = (threadVmId: string | undefined): WorkspaceView => {
  if (!threadVmId) {
    return "terminal";
  }
  return readStored(viewKey(threadVmId)) === "plan" ? "plan" : "terminal";
};

export function WorkspacePane({
  selected,
  onOpenDetails
}: WorkspacePaneProps) {
  const [view, setView] = useState<WorkspaceView>(() => storedView(selected?.id));

  useEffect(() => {
    setView(storedView(selected?.id));
  }, [selected?.id]);

  const selectView = (value: string) => {
    const nextView: WorkspaceView = value === "plan" ? "plan" : "terminal";
    setView(nextView);
    if (selected) {
      writeStored(viewKey(selected.id), nextView);
    }
  };

  return (
    <Tabs
      value={view}
      onValueChange={selectView}
      className="grid size-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-0"
    >
      <div className="flex h-9 items-center gap-2 border-b px-3">
        <SidebarTrigger className="shrink-0 text-muted-foreground" />
        <Separator orientation="vertical" className="h-4 self-auto" />
        <TabsList variant="line" className="h-9">
          <TabsTrigger value="terminal">
            <TerminalIcon data-icon="inline-start" />
            Terminal
          </TabsTrigger>
          <TabsTrigger value="plan" disabled={!selected}>
            <FileTextIcon data-icon="inline-start" />
            Plan
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent
        value="terminal"
        forceMount
        className={cn("min-h-0 min-w-0", view !== "terminal" && "hidden")}
      >
        <TerminalPane selected={selected} onOpenDetails={onOpenDetails} />
      </TabsContent>
      <TabsContent
        value="plan"
        forceMount
        className={cn("min-h-0 min-w-0", view !== "plan" && "hidden")}
      >
        <PlanPane
          key={selected?.id ?? "no-workspace"}
          selected={selected}
          active={view === "plan"}
          onOpenTerminal={() => selectView("terminal")}
        />
      </TabsContent>
    </Tabs>
  );
}
