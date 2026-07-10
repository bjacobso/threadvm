import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "@/components/ui/resizable";
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
  useSelectedThreadVm
} from "@/state/atoms";

type FocusedPanel = "inventory" | "terminal" | "inspector";

const panelFrame = (panel: FocusedPanel, focusedPanel: FocusedPanel) =>
  cn(
    "size-full min-h-0 min-w-0 outline-none",
    panel === focusedPanel && "ring-1 ring-inset ring-ring/50"
  );

export function App() {
  const selected = useSelectedThreadVm();
  const focusedPanel = useAtomRef(focusedPanelAtom);
  const [commandOpen, setCommandOpen] = useState(false);
  const [newThreadVmOpen, setNewThreadVmOpen] = useState(false);
  const [projectRegistryOpen, setProjectRegistryOpen] = useState(false);
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
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) {
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
      <main className="h-svh min-h-0 bg-background text-foreground">
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
      </main>
      <ThreadVmCommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <NewThreadVmDialog
        open={newThreadVmOpen}
        onOpenChange={setNewThreadVmOpen}
      />
      <ProjectRegistryDialog
        open={projectRegistryOpen}
        onOpenChange={setProjectRegistryOpen}
      />
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  );
}
