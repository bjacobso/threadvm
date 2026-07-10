import { Context, Effect, Layer } from "effect";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { Project, type ProjectModel } from "../domain/schema.js";

interface RawProjectsFile {
  readonly projects?: Record<string, Omit<ProjectModel, "id">>;
}

export class ConfigError {
  readonly _tag = "ConfigError";

  constructor(readonly message: string, readonly cause?: unknown) {}
}

export class ConfigService extends Context.Service<
  ConfigService,
  {
    readonly listProjects: Effect.Effect<ReadonlyArray<Project>, ConfigError>;
    readonly getProject: (id: string) => Effect.Effect<Project, ConfigError>;
  }
>()("ConfigService") {}

export const ConfigServiceLive = Layer.effect(
  ConfigService,
  Effect.sync(() => {
    const configPath =
      process.env.THREADVM_PROJECTS_FILE ??
      fileURLToPath(new URL("../../../../examples/projects.yaml", import.meta.url));

    const readProjects = Effect.tryPromise({
      try: () => readFile(configPath, "utf8"),
      catch: (cause) =>
        new ConfigError(`Failed to read project config at ${configPath}`, cause)
    }).pipe(
      Effect.map((contents) => YAML.parse(contents) as RawProjectsFile),
      Effect.map((parsed) =>
        Object.entries(parsed.projects ?? {}).map(([id, project]) => {
          const rawProject = project as Omit<ProjectModel, "id">;
          return new Project({ id, ...rawProject });
        })
      ),
      Effect.catch((error) => {
        if (error instanceof ConfigError) {
          return Effect.fail(error);
        }
        return Effect.fail(
          new ConfigError(`Failed to parse project config at ${configPath}`, error)
        );
      })
    );

    const getProject = (id: string) =>
      Effect.flatMap(readProjects, (projects) => {
        const project = projects.find((candidate) => candidate.id === id);
        return project
          ? Effect.succeed(project)
          : Effect.fail(new ConfigError(`Unknown project: ${id}`));
      });

    return { listProjects: readProjects, getProject } as const;
  })
);
