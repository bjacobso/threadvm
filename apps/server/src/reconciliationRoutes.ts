import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { Effect, Layer, Schedule, Stream } from "effect";
import { ThreadVmReconciliationEvent } from "@threadvm/shared/domain";
import { WorkspaceService } from "@threadvm/shared/services/WorkspaceService";

const encoder = new TextEncoder();

const encodeSse = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);

const reconciliationStreamRoute = HttpRouter.add(
  "GET",
  "/rpc/threadvms/reconcile",
  Effect.gen(function* () {
    const workspaces = yield* WorkspaceService;
    const snapshot = workspaces.listThreadVms.pipe(
      Effect.map(
        (threadVms) =>
          new ThreadVmReconciliationEvent({
            threadVms,
            observedAt: Date.now()
          })
      ),
      Effect.map((event) => encodeSse("snapshot", event)),
      Effect.catch((error) =>
        Effect.succeed(encodeSse("reconciliation-error", errorMessage(error)))
      )
    );

    const snapshots = Stream.fromEffectSchedule(
      snapshot,
      Schedule.spaced("5 seconds")
    );
    const heartbeat = Stream.make(encoder.encode(": heartbeat\n\n")).pipe(
      Stream.repeat(Schedule.spaced("15 seconds"))
    );

    return HttpServerResponse.stream(snapshots.pipe(Stream.merge(heartbeat)), {
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive"
      },
      contentType: "text/event-stream"
    });
  })
);

export const ReconciliationRoutesLive = Layer.mergeAll(reconciliationStreamRoute);
