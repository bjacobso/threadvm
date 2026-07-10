import { RefreshCwIcon, ServerIcon } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from "@/components/ui/command";
import {
  projectConfigAtom,
  reconciliationAtom,
  refreshThreadVmsAtom,
  selectedThreadVmIdAtom,
  setSelectedThreadVmId,
  threadVmsAtom,
  useAtomRef
} from "./threadVmAtoms";
import { ThreadVmStateBadge } from "./ThreadVmStateBadge";

interface ThreadVmCommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ThreadVmCommandPalette({
  open,
  onOpenChange
}: ThreadVmCommandPaletteProps) {
  const threadVms = useAtomRef(threadVmsAtom);
  const selectedId = useAtomRef(selectedThreadVmIdAtom);
  const projectConfig = useAtomRef(projectConfigAtom);
  const reconciliation = useAtomRef(reconciliationAtom);
  const projectsById = new Map(
    projectConfig.projects.map((project) => [project.id, project])
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Switch ThreadVM"
      description="Search reflected exe.dev workspaces."
    >
      <Command>
        <CommandInput placeholder="Search ThreadVMs..." />
        <CommandList>
          <CommandEmpty>No ThreadVMs found.</CommandEmpty>
          <CommandGroup heading="Inventory">
            <CommandItem
              value="refresh inventory"
              disabled={reconciliation.status === "refreshing"}
              onSelect={() => {
                void refreshThreadVmsAtom.run();
                onOpenChange(false);
              }}
            >
              <RefreshCwIcon />
              <span>Refresh inventory</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="ThreadVMs">
            {threadVms.map((threadVm) => {
              const project =
                threadVm.project === undefined
                  ? undefined
                  : projectsById.get(threadVm.project);
              return (
                <CommandItem
                  key={threadVm.id}
                  value={[
                    threadVm.name,
                    threadVm.host,
                    threadVm.project,
                    threadVm.branch,
                    threadVm.source
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-checked={threadVm.id === selectedId}
                  onSelect={() => {
                    setSelectedThreadVmId(threadVm.id);
                    onOpenChange(false);
                  }}
                >
                  <ServerIcon />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium">{threadVm.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {threadVm.project ?? project?.id ?? "unknown project"} ·{" "}
                      {threadVm.branch ?? project?.defaultBranch ?? "unknown branch"}
                    </span>
                  </span>
                  <ThreadVmStateBadge state={threadVm.state} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
