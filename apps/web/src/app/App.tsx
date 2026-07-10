import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InspectorPanel } from "@/features/inspector/InspectorPanel";
import { TerminalPane } from "@/features/terminal/TerminalPane";
import { refreshThreadVms, ThreadVmList } from "@/features/threadvms/ThreadVmList";
import { useSelectedThreadVm } from "@/state/atoms";

export function App() {
  const selected = useSelectedThreadVm();

  useEffect(() => {
    void refreshThreadVms();
  }, []);

  return (
    <TooltipProvider>
      <main className="h-svh min-h-0 bg-background text-foreground">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize="18%" minSize="14%" maxSize="28%">
            <ThreadVmList />
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
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  );
}
