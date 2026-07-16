import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import {
  SidebarInset,
  SidebarProvider
} from "@/components/ui/sidebar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InspectorPanel } from "@/features/inspector/InspectorPanel";
import { ProjectRegistryDialog } from "@/features/projects/ProjectRegistryDialog";
import { NewThreadVmDialog } from "@/features/threadvms/NewThreadVmDialog";
import { ThreadVmCommandPalette } from "@/features/threadvms/ThreadVmCommandPalette";
import { ThreadVmList } from "@/features/threadvms/ThreadVmList";
import { WorkspacePane } from "@/features/workspace/WorkspacePane";
import {
  focusedPanelAtom,
  loadProjectConfigAtom,
  provisioningStreamAtom,
  reconciliationStreamAtom,
  refreshThreadVmsAtom,
  useSelectedThreadVm
} from "@/state/atoms";

type FocusedPanel = "inventory" | "terminal";

export function App() {
  const selected = useSelectedThreadVm();
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
      <SidebarProvider
        className="h-svh min-h-0 bg-background text-foreground"
        style={
          {
            "--sidebar-width": "280px",
            "--sidebar-width-mobile": "18rem"
          } as React.CSSProperties
        }
      >
        <div
          className="contents"
          onFocusCapture={() => markFocusedPanel("inventory")}
          onPointerDownCapture={() => markFocusedPanel("inventory")}
        >
          <ThreadVmList
            onOpenQuickSwitch={() => setCommandOpen(true)}
            onOpenNewThreadVm={() => setNewThreadVmOpen(true)}
            onOpenProjectRegistry={() => setProjectRegistryOpen(true)}
          />
        </div>
        <SidebarInset className="h-svh min-h-0 min-w-0 overflow-hidden">
          <div
            className="size-full min-h-0 min-w-0 outline-none"
            onFocusCapture={() => markFocusedPanel("terminal")}
            onPointerDownCapture={() => markFocusedPanel("terminal")}
          >
            <WorkspacePane
              selected={selected}
              onOpenDetails={() => {
                setInspectorSheetOpen(true);
              }}
            />
          </div>
        </SidebarInset>
      </SidebarProvider>
      <Sheet open={inspectorSheetOpen} onOpenChange={setInspectorSheetOpen}>
        <SheetContent side="right" className="w-[min(92vw,420px)] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Workspace details</SheetTitle>
            <SheetDescription>
              Status, previews, actions, and logs for this workspace.
            </SheetDescription>
          </SheetHeader>
          <InspectorPanel />
        </SheetContent>
      </Sheet>
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
