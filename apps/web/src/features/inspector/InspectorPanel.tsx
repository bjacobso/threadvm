import { FileTextIcon, RefreshCwIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  devLogActionAtom,
  devLogAtom,
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

export function InspectorPanel() {
  const selected = useSelectedThreadVm();
  const devLog = useAtomRef(devLogAtom);
  const provisioningStream = useAtomRef(provisioningStreamStateAtom);
  const streamMatchesSelection =
    selected !== undefined && provisioningStream.threadVmId === selected.id;
  const devLogMatchesSelection =
    selected !== undefined && devLog.threadVmId === selected.id;
  const loadingDevLog =
    devLog.status === "loading" && devLog.threadVmId === selected?.id;

  return (
    <aside className="flex h-full w-full min-h-0 min-w-0 flex-col border-l bg-sidebar text-sidebar-foreground">
      <header className="px-4 py-4">
        <h2 className="text-sm font-semibold">Inspector</h2>
      </header>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <ThreadVmStateBadge state={selected.state} />
                <Badge variant="outline">{selected.source}</Badge>
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
                  ["Tags", selected.tags?.length ? selected.tags.join(", ") : "none"],
                  ["Ports", <PortLinks ports={selected.ports} />],
                  ["Metadata", selected.metadataPath ?? "unknown"],
                  ["Dev log", selected.devLogPath ?? "unknown"],
                  ["Dev pid", selected.devPidPath ?? "unknown"],
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
                  ],
                  [
                    "Raw",
                    <span className="whitespace-pre-wrap">{selected.raw ?? "none"}</span>
                  ]
                ]}
              />
              <Separator />
              <LifecycleActions threadVm={selected} />
              <Separator />
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold">Dev Log</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selected.devLogPath || loadingDevLog}
                    onClick={() => void devLogActionAtom.load(selected.id)}
                  >
                    <RefreshCwIcon data-icon="inline-start" />
                    {loadingDevLog ? "Loading..." : "Refresh"}
                  </Button>
                </div>
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
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a ThreadVM.</p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
