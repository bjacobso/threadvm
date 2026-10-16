import { OutlinePane } from "@/features/outline/OutlinePane";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useEffect, useState } from "react";
import { PanelRightOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InspectorPanel } from "@/features/inspector/InspectorPanel";
import { ProjectRegistryDialog } from "@/features/projects/ProjectRegistryDialog";
import { TerminalPane } from "@/features/terminal/TerminalPane";
import { NewThreadVmDialog } from "@/features/threadvms/NewThreadVmDialog";
import { ThreadVmCommandPalette } from "@/features/threadvms/ThreadVmCommandPalette";
import { ThreadVmList } from "@/features/threadvms/ThreadVmList";
import { cn } from "@/lib/utils";
import {
  focusedPanelAtom,
  loadProjectConfigAtom,
  provisioningStreamAtom,
  reconciliationStreamAtom,
  refreshThreadVmsAtom,
  useAtomRef,
  useSelectedThreadVm,
} from "@/state/atoms";

type FocusedPanel = "inventory" | "terminal" | "inspector";

const panelFrame = (panel: FocusedPanel, focusedPanel: FocusedPanel) =>
  cn(
    "size-full min-h-0 min-w-0 outline-none",
    panel === focusedPanel && "ring-1 ring-inset ring-ring/50",
  );

function VmInventoryApp() {
  const selected = useSelectedThreadVm();
  const focusedPanel = useAtomRef(focusedPanelAtom);
  const [commandOpen, setCommandOpen] = useState(false);
  const [newThreadVmOpen, setNewThreadVmOpen] = useState(false);
  const [projectRegistryOpen, setProjectRegistryOpen] = useState(false);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);
  const markFocusedPanel = (panel: FocusedPanel) => {
    focusedPanelAtom.set(panel);
  };

  useEffect(() => {
    void loadProjectConfigAtom.run();
    void refreshThreadVmsAtom.run();
    const stopReconciliationStream = reconciliationStreamAtom.start();

    return () => stopReconciliationStream();
  }, []);

  useEffect(() => {
    const stopProvisioningStream = provisioningStreamAtom.start(selected?.id);

    return () => stopProvisioningStream();
  }, [selected?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      setCommandOpen((open) => !open);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <TooltipProvider>
      <main className="relative h-full min-h-0 bg-background text-foreground">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize="18%" minSize="14%" maxSize="28%">
            <div
              className={panelFrame("inventory", focusedPanel)}
              onFocusCapture={() => markFocusedPanel("inventory")}
              onPointerDownCapture={() => markFocusedPanel("inventory")}
            >
              <ThreadVmList
                onOpenQuickSwitch={() => setCommandOpen(true)}
                onOpenNewThreadVm={() => setNewThreadVmOpen(true)}
                onOpenProjectRegistry={() => setProjectRegistryOpen(true)}
              />
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="62%" minSize="36%">
            <div
              className={panelFrame("terminal", focusedPanel)}
              onFocusCapture={() => markFocusedPanel("terminal")}
              onPointerDownCapture={() => markFocusedPanel("terminal")}
            >
              <TerminalPane selected={selected} />
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="20%" minSize="16%" maxSize="30%">
            <div
              className={panelFrame("inspector", focusedPanel)}
              onFocusCapture={() => markFocusedPanel("inspector")}
              onPointerDownCapture={() => markFocusedPanel("inspector")}
            >
              <InspectorPanel />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="absolute top-3 right-3 xl:hidden"
          onClick={() => {
            markFocusedPanel("inspector");
            setInspectorSheetOpen(true);
          }}
          aria-label="Open inspector"
        >
          <PanelRightOpenIcon />
        </Button>
      </main>
      <Sheet open={inspectorSheetOpen} onOpenChange={setInspectorSheetOpen}>
        <SheetContent side="right" className="w-[min(92vw,420px)] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Inspector</SheetTitle>
            <SheetDescription>
              ThreadVM metadata, port checks, actions, and logs.
            </SheetDescription>
          </SheetHeader>
          <InspectorPanel />
        </SheetContent>
      </Sheet>
      <ThreadVmCommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
      />
      <NewThreadVmDialog
        open={newThreadVmOpen}
        onOpenChange={setNewThreadVmOpen}
      />
      <ProjectRegistryDialog
        open={projectRegistryOpen}
        onOpenChange={setProjectRegistryOpen}
      />
    </TooltipProvider>
  );
}

export function App() {
  const localRun = /^\/terminal\/([A-Za-z0-9_-]+)$/.exec(
    window.location.pathname,
  )?.[1];
  if (localRun)
    return (
      <TooltipProvider>
        <div className="h-svh bg-background text-foreground">
          <TerminalPane
            autoAttach
            selected={{
              id: `run-${localRun}`,
              name: "Local run",
              host: "localhost",
              state: "running",
              source: "cache",
              ports: [],
            }}
          />
        </div>
        <Toaster />
      </TooltipProvider>
    );
  return (
    <Tabs
      defaultValue={
        window.location.pathname === "/inventory" ? "inventory" : "outline"
      }
      className="h-svh gap-0 bg-background text-foreground"
    >
      <header className="flex h-14 shrink-0 items-center gap-8 border-b border-border px-6">
        <span className="text-sm font-semibold tracking-tight">
          ThreadVM
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            /
          </span>
        </span>
        <TabsList variant="line">
          <TabsTrigger value="outline">Outline</TabsTrigger>
          <TabsTrigger value="inventory">VM inventory</TabsTrigger>
        </TabsList>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
          Local directory · durable thinking
        </span>
      </header>
      <TabsContent value="outline" className="min-h-0 overflow-hidden">
        <TooltipProvider>
          <OutlinePane />
        </TooltipProvider>
      </TabsContent>
      <TabsContent value="inventory" className="min-h-0 overflow-hidden">
        <VmInventoryApp />
      </TabsContent>
      <Toaster richColors position="bottom-right" />
    </Tabs>
  );
}
