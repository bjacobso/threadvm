import { RefreshCwIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  inventoryErrorAtom,
  inventoryLoadingAtom,
  selectedThreadVmIdAtom,
  setSelectedThreadVmId,
  threadVmsAtom,
  useAtomRef
} from "@/state/atoms";
import { threadVmApi } from "@/state/apiClient";
import { ThreadVmRow } from "./ThreadVmRow";

export const refreshThreadVms = async () => {
  inventoryLoadingAtom.set(true);
  inventoryErrorAtom.set(undefined);
  try {
    const nextThreadVms = await threadVmApi.listThreadVms();
    threadVmsAtom.set(nextThreadVms);
    const selectedId = selectedThreadVmIdAtom.value;
    const preferred = selectedId ?? nextThreadVms[0]?.id;
    setSelectedThreadVmId(
      nextThreadVms.some((threadVm) => threadVm.id === preferred)
        ? preferred
        : nextThreadVms[0]?.id
    );
  } catch (cause) {
    inventoryErrorAtom.set(cause instanceof Error ? cause.message : String(cause));
  } finally {
    inventoryLoadingAtom.set(false);
  }
};

export function ThreadVmList() {
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void refreshThreadVms()}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Refresh
        </Button>
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
