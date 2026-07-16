import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ThreadVmModel,
  ThreadVmPlanResponseModel
} from "@threadvm/shared/domain";
import {
  AlertCircleIcon,
  FileTextIcon,
  RefreshCwIcon,
  TerminalIcon
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { threadVmApi } from "@/state/apiClient";
import { MarkdownViewer } from "./MarkdownViewer";

type PlanState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "loaded"; readonly response: ThreadVmPlanResponseModel }
  | { readonly status: "failed"; readonly error: string };

interface PlanPaneProps {
  readonly selected: ThreadVmModel | undefined;
  readonly active: boolean;
  readonly onOpenTerminal: () => void;
}

export function PlanPane({
  selected,
  active,
  onOpenTerminal
}: PlanPaneProps) {
  const [state, setState] = useState<PlanState>({ status: "idle" });
  const requestRef = useRef(0);
  const selectedId = selected?.id;

  const loadPlan = useCallback(async () => {
    if (!selectedId) {
      setState({ status: "idle" });
      return;
    }

    const request = requestRef.current + 1;
    requestRef.current = request;
    setState({ status: "loading" });
    try {
      const response = await threadVmApi.readPlan(selectedId);
      if (requestRef.current === request) {
        setState({ status: "loaded", response });
      }
    } catch (cause) {
      if (requestRef.current === request) {
        setState({
          status: "failed",
          error: cause instanceof Error ? cause.message : String(cause)
        });
      }
    }
  }, [selectedId]);

  useEffect(() => {
    if (active) {
      void loadPlan();
    }
  }, [active, loadPlan]);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  const response = state.status === "loaded" ? state.response : undefined;
  const observedAt = response
    ? new Date(response.observedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      })
    : undefined;

  return (
    <section className="grid size-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
      <header className="flex h-14 min-w-0 items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">PLAN.md</h2>
          <p className="truncate text-xs text-muted-foreground">
            {response?.path ?? selected?.name ?? "Choose a workspace"}
          </p>
        </div>
        {observedAt ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Updated {observedAt}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!selected || state.status === "loading"}
          onClick={() => void loadPlan()}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Refresh
        </Button>
      </header>

      <div className="min-h-0 min-w-0 px-3 pt-2 pb-3">
        <div className="size-full min-h-0 overflow-hidden rounded-xl border border-border/75">
          {state.status === "loading" ? (
            <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6 sm:p-10">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : null}

          {state.status === "failed" ? (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Couldn&apos;t load PLAN.md</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          {state.status === "idle" ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileTextIcon />
                </EmptyMedia>
                <EmptyTitle>Choose a workspace</EmptyTitle>
                <EmptyDescription>
                  Select a ThreadVM to view its PLAN.md.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}

          {response && !response.exists ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileTextIcon />
                </EmptyMedia>
                <EmptyTitle>No PLAN.md yet</EmptyTitle>
                <EmptyDescription>
                  Create {response.path} from the workspace terminal, then refresh.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" variant="outline" onClick={onOpenTerminal}>
                  <TerminalIcon data-icon="inline-start" />
                  Open terminal
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {response?.exists && response.content.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileTextIcon />
                </EmptyMedia>
                <EmptyTitle>PLAN.md is empty</EmptyTitle>
                <EmptyDescription>
                  Add a plan from the workspace terminal and refresh this view.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" variant="outline" onClick={onOpenTerminal}>
                  <TerminalIcon data-icon="inline-start" />
                  Open terminal
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {response?.exists && response.content.length > 0 ? (
            <ScrollArea className="size-full">
              <div className="mx-auto max-w-4xl p-6 sm:p-10">
                <MarkdownViewer content={response.content} />
              </div>
            </ScrollArea>
          ) : null}
        </div>
      </div>
    </section>
  );
}
