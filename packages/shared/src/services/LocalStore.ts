import { Context, Effect, Layer, Schema } from "effect";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  ThreadVmMetadata,
  ThreadVmMetadataFile,
  type ThreadVmMetadataModel
} from "../domain/schema.js";

export class LocalStoreError {
  readonly _tag = "LocalStoreError";

  constructor(readonly message: string, readonly cause?: unknown) {}
}

export class LocalStore extends Context.Service<
  LocalStore,
  {
    readonly listThreadVmMetadata: Effect.Effect<
      ReadonlyArray<ThreadVmMetadata>,
      LocalStoreError
    >;
    readonly getThreadVmMetadata: (
      id: string
    ) => Effect.Effect<ThreadVmMetadata | undefined, LocalStoreError>;
    readonly upsertThreadVmMetadata: (
      metadata: ThreadVmMetadata
    ) => Effect.Effect<void, LocalStoreError>;
    readonly removeThreadVmMetadata: (
      id: string
    ) => Effect.Effect<void, LocalStoreError>;
  }
>()("LocalStore") {}

const emptyStore = () => new ThreadVmMetadataFile({ threadVms: {} });

const isMissingFile = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === "ENOENT";

export const LocalStoreLive = Layer.effect(
  LocalStore,
  Effect.sync(() => {
    const storePath =
      process.env.THREADVM_STORE_FILE ?? join(homedir(), ".threadvm", "store.json");

    const decodeStore = Schema.decodeUnknownEffect(ThreadVmMetadataFile);

    const readStore = Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(storePath, "utf8");
        } catch (cause) {
          if (isMissingFile(cause)) {
            return JSON.stringify(emptyStore());
          }
          throw cause;
        }
      },
      catch: (cause) =>
        new LocalStoreError(`Failed to read local store at ${storePath}`, cause)
    }).pipe(
      Effect.flatMap((contents) =>
        Effect.try({
          try: () => JSON.parse(contents) as unknown,
          catch: (cause) =>
            new LocalStoreError(`Failed to parse local store at ${storePath}`, cause)
        })
      ),
      Effect.flatMap((parsed) =>
        decodeStore(parsed).pipe(
          Effect.mapError(
            (cause) =>
              new LocalStoreError(
                `Failed to validate local store at ${storePath}`,
                cause
              )
          )
        )
      )
    );

    const writeStore = (store: ThreadVmMetadataFile) =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(storePath), { recursive: true });
          await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
        },
        catch: (cause) =>
          new LocalStoreError(`Failed to write local store at ${storePath}`, cause)
      });

    const listThreadVmMetadata = readStore.pipe(
      Effect.map((store) => Object.values(store.threadVms))
    );

    const getThreadVmMetadata = (id: string) =>
      readStore.pipe(Effect.map((store) => store.threadVms[id]));

    const upsertThreadVmMetadata = (metadata: ThreadVmMetadata) =>
      readStore.pipe(
        Effect.flatMap((store) =>
          writeStore(
            new ThreadVmMetadataFile({
              threadVms: {
                ...store.threadVms,
                [metadata.id]: metadata as ThreadVmMetadataModel
              }
            })
          )
        )
      );

    const removeThreadVmMetadata = (id: string) =>
      readStore.pipe(
        Effect.flatMap((store) => {
          const { [id]: _removed, ...threadVms } = store.threadVms;
          return writeStore(new ThreadVmMetadataFile({ threadVms }));
        })
      );

    return {
      listThreadVmMetadata,
      getThreadVmMetadata,
      upsertThreadVmMetadata,
      removeThreadVmMetadata
    } as const;
  })
);
