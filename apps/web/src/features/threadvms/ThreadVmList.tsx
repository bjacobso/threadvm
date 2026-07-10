import type React from "react";
import { toast } from "sonner";
import {
  FolderCogIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ServerIcon
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import {
  inventoryErrorAtom,
  inventoryLoadingAtom,
  portStatusActionAtom,
  refreshThreadVmsAtom,
  selectedThreadVmIdAtom,
  setSelectedThreadVmId,
  threadVmsAtom,
  useAtomRef
} from "./threadVmAtoms";
import { ThreadVmRow } from "./ThreadVmRow";
import { firstPreviewUrl, threadVmHostClipboardText } from "./threadVmActions";
import {
  nextThreadVmSelection,
  threadVmNavigationAction
} from "./threadVmNavigation";

interface ThreadVmListProps {
  readonly onOpenQuickSwitch: () => void;
  readonly onOpenNewThreadVm: () => void;
  readonly onOpenProjectRegistry: () => void;
}

export function ThreadVmList({
  onOpenQuickSwitch,
  onOpenNewThreadVm,
  onOpenProjectRegistry
}: ThreadVmListProps) {
  const threadVms = useAtomRef(threadVmsAtom);
  const selectedId = useAtomRef(selectedThreadVmIdAtom);
  const loading = useAtomRef(inventoryLoadingAtom);
  const error = useAtomRef(inventoryErrorAtom);
  const copyHost = async (threadVm: (typeof threadVms)[number]) => {
    try {
      await navigator.clipboard.writeText(threadVmHostClipboardText(threadVm));
      toast.success(`Copied ${threadVm.host}`);
    } catch {
      toast.error("Host copy failed");
    }
  };
  const openPreview = (threadVm: (typeof threadVms)[number]) => {
    const previewUrl = firstPreviewUrl(threadVm);
    if (!previewUrl) {
      return;
    }
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  };
  const checkPorts = (threadVm: (typeof threadVms)[number]) => {
    setSelectedThreadVmId(threadVm.id);
    void portStatusActionAtom.load(threadVm.id);
  };
  const navigateThreadVms = (event: React.KeyboardEvent<HTMLElement>) => {
    const action = threadVmNavigationAction(event);
    if (!action) {
      return;
    }

    const nextId = nextThreadVmSelection(
      threadVms.map((threadVm) => threadVm.id),
      selectedId,
      action
    );
    if (!nextId) {
      return;
    }

    event.preventDefault();
    setSelectedThreadVmId(nextId);
  };

  return (
    <aside className="flex h-full w-full min-h-0 min-w-0 flex-col border-r border-workbench-border bg-workbench-background text-workbench-foreground">
      <header className="flex h-9 items-center justify-between gap-2 border-b border-workbench-border bg-workbench-tab px-3">
        <div className="min-w-0">
          <h1 className="truncate text-xs font-semibold uppercase tracking-normal text-workbench-muted">
            Explorer
          </h1>
        </div>
        <div className="flex shrink-0 items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-none text-workbench-muted hover:bg-workbench-hover hover:text-workbench-foreground"
                onClick={onOpenNewThreadVm}
                aria-label="Create ThreadVM"
              >
                <PlusIcon data-icon="inline-start" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Create ThreadVM</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-none text-workbench-muted hover:bg-workbench-hover hover:text-workbench-foreground"
                onClick={onOpenProjectRegistry}
                aria-label="Open project registry"
              >
                <FolderCogIcon data-icon="inline-start" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open project registry</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-none text-workbench-muted hover:bg-workbench-hover hover:text-workbench-foreground"
                onClick={onOpenQuickSwitch}
                aria-label="Open ThreadVM switcher"
              >
                <SearchIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open ThreadVM switcher</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="rounded-none text-workbench-muted hover:bg-workbench-hover hover:text-workbench-foreground"
            disabled={loading}
            onClick={() => void refreshThreadVmsAtom.run()}
            aria-label="Refresh ThreadVMs"
          >
            <RefreshCwIcon />
          </Button>
        </div>
      </header>

      <div className="flex h-8 items-center gap-2 border-b border-workbench-border px-3 text-[11px] uppercase text-workbench-muted">
        <ServerIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate font-semibold">Harness</span>
        <span className="ml-auto text-[10px]">{threadVms.length}</span>
      </div>

      {error ? (
        <Alert variant="destructive" className="m-3">
          <AlertTitle>Refresh failed</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <nav
          className="flex flex-col py-1"
          onKeyDown={navigateThreadVms}
        >
          {loading && threadVms.length === 0
            ? Array.from({ length: 7 }).map((_, index) => (
                <Skeleton key={index} className="mx-2 my-1 h-7 rounded-sm" />
              ))
            : threadVms.map((threadVm) => (
                <ThreadVmRow
                  key={threadVm.id}
                  threadVm={threadVm}
                  selected={threadVm.id === selectedId}
                  onSelect={() => setSelectedThreadVmId(threadVm.id)}
                  onCheckPorts={() => checkPorts(threadVm)}
                  onCopyHost={() => void copyHost(threadVm)}
                  onOpenPreview={() => openPreview(threadVm)}
                />
              ))}
        </nav>
      </ScrollArea>
    </aside>
  );
}
