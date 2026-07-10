import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InspectorPanel } from "@/features/inspector/InspectorPanel";
import { TerminalPane } from "@/features/terminal/TerminalPane";
import { NewThreadVmDialog } from "@/features/threadvms/NewThreadVmDialog";
import { ThreadVmCommandPalette } from "@/features/threadvms/ThreadVmCommandPalette";
import { ThreadVmList } from "@/features/threadvms/ThreadVmList";
import {
  loadProjectConfigAtom,
  reconciliationStreamAtom,
  refreshThreadVmsAtom,
  useSelectedThreadVm
} from "@/state/atoms";

export function App() {
  const selected = useSelectedThreadVm();
  const [commandOpen, setCommandOpen] = useState(false);
  const [newThreadVmOpen, setNewThreadVmOpen] = useState(false);

  useEffect(() => {
    void loadProjectConfigAtom.run();
    void refreshThreadVmsAtom.run();
    const stopReconciliationStream = reconciliationStreamAtom.start();

    return () => stopReconciliationStream();
  }, []);

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
            <ThreadVmList
              onOpenQuickSwitch={() => setCommandOpen(true)}
              onOpenNewThreadVm={() => setNewThreadVmOpen(true)}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="62%" minSize="36%">
            <TerminalPane selected={selected} />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="20%" minSize="16%" maxSize="30%">
            <InspectorPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
      <ThreadVmCommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <NewThreadVmDialog
        open={newThreadVmOpen}
        onOpenChange={setNewThreadVmOpen}
      />
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  );
}
