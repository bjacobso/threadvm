import type React from "react";
import {
  CircleIcon,
  FileTextIcon,
  GitBranchIcon,
  RefreshCwIcon,
  ServerIcon
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/components/ui/tabs";
import {
  devLogActionAtom,
  devLogAtom,
  portStatusActionAtom,
  portStatusAtom,
  provisioningStreamStateAtom,
  useAtomRef,
  useSelectedThreadVm
} from "@/state/atoms";
import { ThreadVmStateBadge } from "../threadvms/ThreadVmStateBadge";
import { LifecycleActions } from "./LifecycleActions";
import { MetadataTable } from "./MetadataTable";
import { PortLinks } from "./PortLinks";

const formatObservedAt = (observedAt: number | undefined) =>
  observedAt === undefined ? "pending" : new Date(observedAt).toLocaleTimeString();

const SectionHeader = ({
  title,
  children
}: {
  readonly title: string;
  readonly children?: React.ReactNode;
}) => (
  <div className="flex h-7 items-center justify-between gap-2 border-b border-workbench-border text-[11px] uppercase text-workbench-muted">
    <span className="font-semibold">{title}</span>
    {children ? <div className="flex items-center gap-1">{children}</div> : null}
  </div>
);

export function InspectorPanel() {
  const selected = useSelectedThreadVm();
  const devLog = useAtomRef(devLogAtom);
  const portStatus = useAtomRef(portStatusAtom);
  const provisioningStream = useAtomRef(provisioningStreamStateAtom);
  const streamMatchesSelection =
    selected !== undefined && provisioningStream.threadVmId === selected.id;
  const devLogMatchesSelection =
    selected !== undefined && devLog.threadVmId === selected.id;
  const loadingDevLog =
    devLog.status === "loading" && devLog.threadVmId === selected?.id;
  const portStatusMatchesSelection =
    selected !== undefined && portStatus.threadVmId === selected.id;
  const loadingPortStatus =
    portStatus.status === "loading" && portStatus.threadVmId === selected?.id;

  return (
    <aside className="flex h-full w-full min-h-0 min-w-0 flex-col border-l border-workbench-border bg-workbench-background text-workbench-foreground">
      <header className="flex h-9 items-center justify-between border-b border-workbench-border bg-workbench-tab px-3">
        <h2 className="truncate text-xs font-semibold uppercase tracking-normal text-workbench-muted">
          Inspector
        </h2>
      </header>
      <div className="flex h-10 min-w-0 items-center gap-2 border-b border-workbench-border px-3">
        {selected ? (
          <>
            <CircleIcon
              className="size-2.5 shrink-0 fill-current text-status-running"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{selected.name}</div>
              <div className="flex min-w-0 items-center gap-2 text-[10px] text-workbench-muted">
                <ServerIcon className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{selected.host}</span>
              </div>
            </div>
          </>
        ) : (
          <span className="text-xs text-workbench-muted">No ThreadVM selected</span>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <ThreadVmStateBadge state={selected.state} />
                <span className="text-workbench-muted">{selected.source}</span>
                {selected.branch ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-workbench-muted">
                    <GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{selected.branch}</span>
                  </span>
                ) : null}
                {streamMatchesSelection ? (
                  <Badge
                    variant={
                      provisioningStream.status === "failed"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    provisioning {provisioningStream.status}
                  </Badge>
                ) : null}
              </div>
              <Tabs defaultValue="overview" className="min-w-0">
                <TabsList variant="line" className="w-full justify-start">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="ports">Ports</TabsTrigger>
                  <TabsTrigger value="logs">Logs</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="flex flex-col gap-3">
                  <section>
                    <SectionHeader title="Properties" />
                  <MetadataTable
                    rows={[
                      ["Host", selected.host],
                      ["Project", selected.project ?? "unknown"],
                      ["Pinned", selected.pinned ? "yes" : "no"],
                      ["Branch", selected.branch ?? "unknown"],
                      ["Source", selected.source],
                      [
                        "Prompt",
                        selected.startingPrompt ? (
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm border border-border/60 bg-background/60 p-2 text-[10px] leading-snug text-muted-foreground">
                            {selected.startingPrompt}
                          </pre>
                        ) : (
                          "none"
                        )
                      ],
                      [
                        "Tags",
                        selected.tags?.length ? selected.tags.join(", ") : "none"
                      ],
                      ["Metadata", selected.metadataPath ?? "unknown"],
                      ["Dev log", selected.devLogPath ?? "unknown"],
                      ["Dev pid", selected.devPidPath ?? "unknown"],
                      [
                        "Raw",
                        <span className="whitespace-pre-wrap">
                          {selected.raw ?? "none"}
                        </span>
                      ]
                    ]}
                  />
                  </section>
                  <section className="flex flex-col gap-2">
                    <SectionHeader title="Lifecycle" />
                  <LifecycleActions threadVm={selected} />
                  </section>
                </TabsContent>

                <TabsContent value="ports" className="flex flex-col gap-3">
                  <section className="flex flex-col gap-2">
                    <SectionHeader title="Ports">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 rounded-none px-1.5 text-[11px] text-workbench-muted hover:bg-workbench-hover hover:text-workbench-foreground"
                      disabled={selected.ports.length === 0 || loadingPortStatus}
                      onClick={() => void portStatusActionAtom.load(selected.id)}
                    >
                      <RefreshCwIcon data-icon="inline-start" />
                      {loadingPortStatus ? "Checking..." : "Check"}
                    </Button>
                    </SectionHeader>
                  <PortLinks
                    ports={selected.ports}
                    statuses={
                      portStatusMatchesSelection
                        ? portStatus.response?.ports
                        : undefined
                    }
                  />
                  {portStatusMatchesSelection && portStatus.error ? (
                    <Alert variant="destructive">
                      <FileTextIcon />
                      <AlertTitle>Port check unavailable</AlertTitle>
                      <AlertDescription className="break-words">
                        {portStatus.error}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {portStatusMatchesSelection && portStatus.response ? (
                    <span className="text-xs text-muted-foreground">
                      observed {formatObservedAt(portStatus.response.observedAt)}
                    </span>
                  ) : null}
                  </section>
                </TabsContent>

                <TabsContent value="logs" className="flex flex-col gap-3">
                  <section>
                    <SectionHeader title="Provisioning" />
                  <MetadataTable
                    rows={[
                      [
                        "Stream",
                        streamMatchesSelection ? (
                          provisioningStream.error ? (
                            <span className="text-destructive">
                              {provisioningStream.error}
                            </span>
                          ) : (
                            formatObservedAt(provisioningStream.lastObservedAt)
                          )
                        ) : (
                          "idle"
                        )
                      ],
                      [
                        "Provisioning",
                        selected.lastProvisioningError ? (
                          <span className="text-destructive">
                            {selected.lastProvisioningError}
                          </span>
                        ) : (
                          "ok"
                        )
                      ],
                      [
                        "Steps",
                        selected.provisioningSteps?.length ? (
                          <ol className="flex flex-col gap-1">
                            {selected.provisioningSteps.map((step) => (
                              <li key={step.id} className="flex flex-col gap-0.5">
                                <span>{step.label}</span>
                                <span className="text-muted-foreground">
                                  {step.status}
                                  {step.message ? ` - ${step.message}` : ""}
                                </span>
                                {step.outputExcerpt ? (
                                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-sm border border-border/60 bg-background/60 p-2 text-[10px] leading-snug text-muted-foreground">
                                    {step.outputExcerpt}
                                  </pre>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          "none"
                        )
                      ]
                    ]}
                  />
                  </section>
                  <section className="flex flex-col gap-3">
                    <SectionHeader title="Dev Log">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 rounded-none px-1.5 text-[11px] text-workbench-muted hover:bg-workbench-hover hover:text-workbench-foreground"
                        disabled={!selected.devLogPath || loadingDevLog}
                        onClick={() => void devLogActionAtom.load(selected.id)}
                      >
                        <RefreshCwIcon data-icon="inline-start" />
                        {loadingDevLog ? "Loading..." : "Refresh"}
                      </Button>
                    </SectionHeader>
                    {devLogMatchesSelection && devLog.error ? (
                      <Alert variant="destructive">
                        <FileTextIcon />
                        <AlertTitle>Dev log unavailable</AlertTitle>
                        <AlertDescription className="break-words">
                          {devLog.error}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {devLogMatchesSelection && devLog.response ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{devLog.response.path}</span>
                          {devLog.response.truncated ? (
                            <Badge variant="outline">tail 32kb</Badge>
                          ) : null}
                        </div>
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-sm border border-border/60 bg-background/60 p-2 text-[10px] leading-snug text-muted-foreground">
                          {devLog.response.content || "Log is empty."}
                        </pre>
                      </div>
                    ) : null}
                  </section>
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a ThreadVM.</p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
