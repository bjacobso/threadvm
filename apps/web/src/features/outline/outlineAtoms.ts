import { AtomRef } from "effect/unstable/reactivity";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { ThreadVmApi } from "@threadvm/shared/api";
import {
  OperationBatch,
  ReviewRequest,
  StartRunRequest,
  type OutlineView,
  type OutlineOperation
} from "@threadvm/shared/domain";
export { useAtomRef } from "@/state/atoms";

export const outlineAtom = AtomRef.make<OutlineView | undefined>(undefined);
export const outlineErrorAtom = AtomRef.make<string | undefined>(undefined);
export const outlineBusyAtom = AtomRef.make(false);
const client = Effect.runPromise(
  HttpApiClient.make(ThreadVmApi, { baseUrl: window.location.origin }).pipe(
    Effect.provide(FetchHttpClient.layer)
  )
);
const errorText = (cause: unknown): string => {
  if (cause && typeof cause === "object" && "detail" in cause)
    return String(cause.detail);
  return cause instanceof Error ? cause.message : JSON.stringify(cause);
};
let reading: Promise<void> | undefined;
export const refreshOutline = (): Promise<void> => {
  if (reading) return reading;
  reading = (async () => {
    try {
      outlineAtom.set(await Effect.runPromise((await client).outline.read()));
    } catch (cause) {
      outlineErrorAtom.set(errorText(cause));
    } finally {
      reading = undefined;
    }
  })();
  return reading;
};
let mutations: Promise<unknown> = Promise.resolve();
let queued = 0;
export const outlineActions = {
  async perform(work: () => Promise<unknown>) {
    queued++;
    outlineBusyAtom.set(true);
    const result = mutations.then(async () => {
      outlineErrorAtom.set(undefined);
      try {
        await work();
        if (reading) await reading;
        await refreshOutline();
        return true;
      } catch (cause) {
        outlineErrorAtom.set(errorText(cause));
        return false;
      } finally {
        queued--;
        outlineBusyAtom.set(queued > 0);
      }
    });
    mutations = result;
    return result;
  },
  async apply(
    operations: ReadonlyArray<OutlineOperation>,
    baseRevision?: number
  ) {
    const revision = baseRevision ?? outlineAtom.value?.snapshot.revision;
    if (revision === undefined) return false;
    return this.perform(async () =>
      Effect.runPromise(
        (await client).outline.apply({
          payload: new OperationBatch({ baseRevision: revision, operations })
        })
      )
    );
  },
  async review(
    proposalId: string,
    decision: "accept" | "reject",
    nodeIds?: ReadonlyArray<string>
  ) {
    return this.perform(async () =>
      Effect.runPromise(
        (await client).outline.review({
          payload: new ReviewRequest({ proposalId, decision, nodeIds })
        })
      )
    );
  },
  async run(nodeId: string, agent: "codex" | "claude" | "shell") {
    return this.perform(async () =>
      Effect.runPromise(
        (await client).outline.run({
          payload: new StartRunRequest({ nodeId, agent })
        })
      )
    );
  }
};
