import { Context, Effect, Layer } from "effect";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  HarnessConfigError,
  readHarnessConfig,
  resolveHarnessConfig,
  type ResolvedHarnessConfig
} from "../config/HarnessConfig.js";
import { Project, type ProjectModel } from "../domain/schema.js";

interface RawProjectsFile {
  readonly projects?: Record<string, Omit<ProjectModel, "id">>;
}

type WritableProjectFile = {
  projects: Record<string, Omit<ProjectModel, "id">>;
};

export class ConfigError {
  readonly _tag = "ConfigError";

  constructor(readonly message: string, readonly cause?: unknown) {}
}

export class ConfigService extends Context.Service<
  ConfigService,
  {
    readonly listProjects: Effect.Effect<ReadonlyArray<Project>, ConfigError>;
    readonly getProject: (id: string) => Effect.Effect<Project, ConfigError>;
    readonly saveProject: (
      id: string,
      project: Project
    ) => Effect.Effect<ReadonlyArray<Project>, ConfigError>;
    readonly deleteProject: (
      id: string
    ) => Effect.Effect<ReadonlyArray<Project>, ConfigError>;
  }
>()("ConfigService") {}

const isNodeError = (cause: unknown): cause is NodeJS.ErrnoException =>
  cause instanceof Error && "code" in cause;

const omitUndefined = <A>(value: A): A => {
  if (Array.isArray(value)) {
    return value.map((item) => omitUndefined(item)) as A;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, omitUndefined(item)])
    ) as A;
  }
  return value;
};

const projectToRaw = (project: Project): Omit<ProjectModel, "id"> => {
  const { id: _id, ...rawProject } = project;
  return omitUndefined(rawProject);
};

const projectsFromRaw = (raw: RawProjectsFile): ReadonlyArray<Project> =>
  Object.entries(raw.projects ?? {}).map(([id, project]) => {
    const rawProject = project as Omit<ProjectModel, "id">;
    return new Project({ id, ...rawProject });
  });

const rawFromProjects = (
  projects: ReadonlyArray<Project>
): WritableProjectFile => ({
  projects: Object.fromEntries(
    projects.map((project) => [project.id, projectToRaw(project)])
  )
});

const projectFromHarnessConfig = (resolved: ResolvedHarnessConfig) => {
  const config = resolved.config;
  const primaryRepository =
    config.repositories.find((repository) => repository.branch.mode === "task") ??
    config.repositories[0];
  if (!primaryRepository) {
    throw new ConfigError("Harness config must contain at least one repository");
  }

  const repositoryWorkdir = posix.join(
    config.workspace.root,
    primaryRepository.path
  );
  const workspaceCwd =
    posix.relative(repositoryWorkdir, config.workspace.root) || ".";

  return new Project({
    id: config.project.id,
    repo: primaryRepository.url,
    defaultBranch: primaryRepository.defaultBranch,
    baseDevbox: config.base.name,
    image: config.workspace.sourceImage,
    workdir: repositoryWorkdir,
    workspaceRoot: config.workspace.root,
    branchPrefix:
      primaryRepository.branch.mode === "task"
        ? primaryRepository.branch.prefix
        : undefined,
    bootstrap: [],
    dev: {
      command: config.tasks.dev.command,
      cwd: workspaceCwd,
      ports: config.tasks.dev.ports.map((port) => port.port)
    },
    herdr: {
      install: "manual",
      sessionPrefix: config.terminal.sessionPrefix
    },
    agents: config.agents,
    configKind: "harness"
  });
};

export const ConfigServiceLive = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const projectDirectory = process.env.THREADVM_PROJECT_DIR ?? process.cwd();
    const resolvedHarnessConfig = yield* Effect.tryPromise({
      try: () =>
        resolveHarnessConfig({
          cwd: projectDirectory,
          environmentPath: process.env.HARNESS_CONFIG
        }),
      catch: (cause) =>
        new ConfigError(
          cause instanceof HarnessConfigError
            ? cause.message
            : "Failed to resolve Harness config",
          cause
        )
    });

    const legacyConfigPath =
      process.env.THREADVM_PROJECTS_FILE ??
      fileURLToPath(
        new URL("../../../../examples/single-project/projects.yaml", import.meta.url)
      );

    const readRawProjects = Effect.tryPromise({
      try: () => readFile(legacyConfigPath, "utf8"),
      catch: (cause) => {
        if (isNodeError(cause) && cause.code === "ENOENT") {
          return new ConfigError("Project config file does not exist", cause);
        }
        return new ConfigError(
          `Failed to read project config at ${legacyConfigPath}`,
          cause
        );
      }
    }).pipe(
      Effect.map((contents) => YAML.parse(contents) as RawProjectsFile),
      Effect.catch((error) => {
        if (
          error instanceof ConfigError &&
          error.message === "Project config file does not exist"
        ) {
          return Effect.succeed({ projects: {} } satisfies RawProjectsFile);
        }
        return Effect.fail(error);
      }),
      Effect.catch((error) => {
        if (error instanceof ConfigError) {
          return Effect.fail(error);
        }
        return Effect.fail(
          new ConfigError(
            `Failed to parse project config at ${legacyConfigPath}`,
            error
          )
        );
      })
    );

    const readHarnessProjects = resolvedHarnessConfig
      ? Effect.tryPromise({
          try: () =>
            readHarnessConfig(
              resolvedHarnessConfig.path,
              resolvedHarnessConfig.source
            ),
          catch: (cause) =>
            new ConfigError(
              cause instanceof HarnessConfigError
                ? cause.message
                : "Failed to read Harness config",
              cause
            )
        }).pipe(Effect.map((resolved) => [projectFromHarnessConfig(resolved)]))
      : undefined;

    const readProjects =
      readHarnessProjects ?? readRawProjects.pipe(Effect.map(projectsFromRaw));

    const writeProjects = (projects: ReadonlyArray<Project>) =>
      resolvedHarnessConfig
        ? Effect.fail(
            new ConfigError(
              `Project ${resolvedHarnessConfig.config.project.id} is managed by ${resolvedHarnessConfig.path}; edit that file directly`
            )
          )
        : Effect.tryPromise({
            try: async () => {
              await mkdir(dirname(legacyConfigPath), { recursive: true });
              await writeFile(
                legacyConfigPath,
                YAML.stringify(rawFromProjects(projects), {
                  lineWidth: 0,
                  sortMapEntries: true
                }),
                "utf8"
              );
            },
            catch: (cause) =>
              new ConfigError(
                `Failed to write project config at ${legacyConfigPath}`,
                cause
              )
          }).pipe(Effect.andThen(Effect.succeed(projects)));

    const getProject = (id: string) =>
      Effect.flatMap(readProjects, (projects) => {
        const project = projects.find((candidate) => candidate.id === id);
        return project
          ? Effect.succeed(project)
          : Effect.fail(new ConfigError(`Unknown project: ${id}`));
      });

    const saveProject = (id: string, project: Project) =>
      Effect.gen(function* () {
        if (id !== project.id) {
          return yield* Effect.fail(
            new ConfigError(
              `Project id mismatch: path id '${id}' does not match payload id '${project.id}'`
            )
          );
        }
        const projects = yield* readProjects;
        const withoutExisting = projects.filter((candidate) => candidate.id !== id);
        return yield* writeProjects(
          [...withoutExisting, project].sort((left, right) =>
            left.id.localeCompare(right.id)
          )
        );
      });

    const deleteProject = (id: string) =>
      Effect.gen(function* () {
        const projects = yield* readProjects;
        const nextProjects = projects.filter((project) => project.id !== id);
        if (nextProjects.length === projects.length) {
          return yield* Effect.fail(new ConfigError(`Unknown project: ${id}`));
        }
        return yield* writeProjects(nextProjects);
      });

    return { listProjects: readProjects, getProject, saveProject, deleteProject } as const;
  })
);
