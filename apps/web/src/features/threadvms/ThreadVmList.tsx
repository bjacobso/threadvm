import type React from "react";
import { toast } from "sonner";
import {
  FolderIcon,
  Settings2Icon,
  SparklesIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail
} from "@/components/ui/sidebar";
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
  const projectGroups = Array.from(
    threadVms.reduce((groups, threadVm) => {
      const project = threadVm.project ?? "Other";
      const current = groups.get(project) ?? [];
      groups.set(project, [...current, threadVm]);
      return groups;
    }, new Map<string, Array<(typeof threadVms)[number]>>())
  );
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
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-1 p-2">
        <div className="flex h-10 items-center justify-between gap-2 px-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <SparklesIcon className="size-3.5" aria-hidden="true" />
            </span>
            <h1 className="truncate text-sm font-semibold">Harness</h1>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  onClick={onOpenProjectRegistry}
                  aria-label="Manage projects"
                >
                  <Settings2Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Manage projects</TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              disabled={loading}
              onClick={() => void refreshThreadVmsAtom.run()}
              aria-label="Refresh tasks"
            >
              <RefreshCwIcon />
            </Button>
          </div>
        </div>
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              className="h-9 bg-sidebar-accent px-3 font-normal hover:bg-sidebar-accent/80"
              onClick={onOpenNewThreadVm}
            >
              <PlusIcon />
              <span>New task</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              className="h-9 px-3 font-normal text-muted-foreground"
              onClick={onOpenQuickSwitch}
            >
              <SearchIcon />
              <span>Search tasks</span>
              <kbd className="ml-auto hidden text-[10px] text-muted-foreground/70 sm:inline">
                ⌘K
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {error ? (
        <Alert variant="destructive" className="m-2">
          <AlertTitle>Refresh failed</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}

      <SidebarContent>
        <nav
          className="flex flex-col gap-1 pb-4"
          onKeyDown={navigateThreadVms}
        >
          {loading && threadVms.length === 0
            ? (
                <SidebarGroup>
                  <SidebarMenu>
                    {Array.from({ length: 7 }).map((_, index) => (
                      <SidebarMenuItem key={index}>
                        <SidebarMenuSkeleton showIcon className="h-9" />
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroup>
              )
            : projectGroups.map(([project, projectThreadVms]) => (
                <SidebarGroup key={project} className="py-1">
                  <SidebarGroupLabel>
                    <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate font-medium">{project}</span>
                    <span className="ml-auto text-[10px]">
                      {projectThreadVms.length}
                    </span>
                  </SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu className="gap-0.5">
                    {projectThreadVms.map((threadVm) => (
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
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
