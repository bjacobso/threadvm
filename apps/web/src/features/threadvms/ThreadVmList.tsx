import { PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
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
  refreshThreadVmsAtom,
  selectedThreadVmIdAtom,
  setSelectedThreadVmId,
  threadVmsAtom,
  useAtomRef
} from "@/state/atoms";
import { ThreadVmRow } from "./ThreadVmRow";

interface ThreadVmListProps {
  readonly onOpenQuickSwitch: () => void;
  readonly onOpenNewThreadVm: () => void;
}

export function ThreadVmList({
  onOpenQuickSwitch,
  onOpenNewThreadVm
}: ThreadVmListProps) {
  const threadVms = useAtomRef(threadVmsAtom);
  const selectedId = useAtomRef(selectedThreadVmIdAtom);
  const loading = useAtomRef(inventoryLoadingAtom);
  const error = useAtomRef(inventoryErrorAtom);

  return (
    <aside className="flex h-full w-full min-h-0 min-w-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">ThreadVM</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            exe.dev reflected workspaces
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
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
                variant="outline"
                size="icon-sm"
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
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void refreshThreadVmsAtom.run()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive" className="m-3">
          <AlertTitle>Refresh failed</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-1.5 p-2">
          {loading && threadVms.length === 0
            ? Array.from({ length: 7 }).map((_, index) => (
                <Skeleton key={index} className="h-14 rounded-md" />
              ))
            : threadVms.map((threadVm) => (
                <ThreadVmRow
                  key={threadVm.id}
                  threadVm={threadVm}
                  selected={threadVm.id === selectedId}
                  onSelect={() => setSelectedThreadVmId(threadVm.id)}
                />
              ))}
        </nav>
      </ScrollArea>
    </aside>
  );
}
