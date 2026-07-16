import { Schema } from "effect";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve } from "node:path";
import YAML from "yaml";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const Identifier = NonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
);
const PortNumber = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 65_535 })
);

export class HarnessProjectConfig extends Schema.Class<HarnessProjectConfig>(
  "HarnessProjectConfig"
)({
  id: Identifier,
  displayName: NonEmptyString
}) {}

export class HarnessWorkspaceConfig extends Schema.Class<HarnessWorkspaceConfig>(
  "HarnessWorkspaceConfig"
)({
  root: NonEmptyString,
  sourceImage: NonEmptyString
}) {}

export class HarnessBaseConfig extends Schema.Class<HarnessBaseConfig>(
  "HarnessBaseConfig"
)({
  name: Identifier,
  bootstrap: Schema.Struct({
    provider: Schema.Literals(["mise"]),
    config: NonEmptyString,
    trust: Schema.Boolean,
    command: NonEmptyString
  }),
  setup: Schema.Struct({
    command: NonEmptyString,
    verify: NonEmptyString,
    auth: Schema.Array(
      Schema.Literals(["github", "codex", "claude"])
    ).check(Schema.isMinLength(1))
  })
}) {}

export class HarnessRepositoryConfig extends Schema.Class<HarnessRepositoryConfig>(
  "HarnessRepositoryConfig"
)({
  id: Identifier,
  url: NonEmptyString,
  path: NonEmptyString,
  defaultBranch: NonEmptyString,
  branch: Schema.Struct({
    mode: Schema.Literals(["task", "default"]),
    prefix: Schema.optional(NonEmptyString)
  })
}) {}

export class HarnessTasksConfig extends Schema.Class<HarnessTasksConfig>(
  "HarnessTasksConfig"
)({
  afterClone: Schema.Array(NonEmptyString),
  dev: Schema.Struct({
    command: NonEmptyString,
    ports: Schema.Array(
      Schema.Struct({
        label: NonEmptyString,
        port: PortNumber
      })
    )
  })
}) {}

export class HarnessConfig extends Schema.Class<HarnessConfig>("HarnessConfig")({
  version: Schema.Literals([1]),
  project: HarnessProjectConfig,
  workspace: HarnessWorkspaceConfig,
  base: HarnessBaseConfig,
  repositories: Schema.Array(HarnessRepositoryConfig).check(Schema.isMinLength(1)),
  tasks: HarnessTasksConfig,
  terminal: Schema.Struct({
    sessionPrefix: Identifier
  }),
  agents: Schema.Struct({
    default: NonEmptyString,
    panes: Schema.Array(
      Schema.Struct({
        label: NonEmptyString,
        command: NonEmptyString,
        cwd: Schema.optional(NonEmptyString)
      })
    )
  })
}) {}

export type HarnessConfigModel = typeof HarnessConfig.Type;
export type HarnessConfigSource = "flag" | "environment" | "current-directory";

export interface ResolvedHarnessConfig {
  readonly path: string;
  readonly directory: string;
  readonly source: HarnessConfigSource;
  readonly config: HarnessConfig;
}

export interface ResolveHarnessConfigOptions {
  readonly cwd: string;
  readonly explicitPath?: string;
  readonly environmentPath?: string;
}

export class HarnessConfigError extends Error {
  readonly _tag = "HarnessConfigError";

  constructor(
    message: string,
    readonly path?: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "HarnessConfigError";
  }
}

const decodeHarnessConfig = Schema.decodeUnknownPromise(HarnessConfig);

const exists = (path: string) =>
  access(path)
    .then(() => true)
    .catch(() => false);

const duplicateValues = (values: ReadonlyArray<string>) => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
};

const normalizedRepositoryPath = (value: string) => posix.normalize(value);

const pathsOverlap = (left: string, right: string) =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

const validateHarnessConfig = async (config: HarnessConfig, path: string) => {
  if (!posix.isAbsolute(config.workspace.root)) {
    throw new HarnessConfigError(
      "workspace.root must be an absolute POSIX path",
      path
    );
  }

  const duplicateRepositoryIds = duplicateValues(
    config.repositories.map((repository) => repository.id)
  );
  if (duplicateRepositoryIds.length > 0) {
    throw new HarnessConfigError(
      `repository ids must be unique: ${duplicateRepositoryIds.join(", ")}`,
      path
    );
  }

  const repositoryPaths = config.repositories.map((repository) => {
    const normalized = normalizedRepositoryPath(repository.path);
    if (
      posix.isAbsolute(repository.path) ||
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      throw new HarnessConfigError(
        `repository path must stay inside workspace.root: ${repository.path}`,
        path
      );
    }
    return { id: repository.id, path: normalized };
  });

  for (let index = 0; index < repositoryPaths.length; index += 1) {
    for (let other = index + 1; other < repositoryPaths.length; other += 1) {
      const left = repositoryPaths[index];
      const right = repositoryPaths[other];
      if (left && right && pathsOverlap(left.path, right.path)) {
        throw new HarnessConfigError(
          `repository paths overlap: ${left.id} (${left.path}) and ${right.id} (${right.path})`,
          path
        );
      }
    }
  }

  for (const repository of config.repositories) {
    if (repository.branch.mode === "task" && !repository.branch.prefix) {
      throw new HarnessConfigError(
        `task-branch repository requires branch.prefix: ${repository.id}`,
        path
      );
    }
  }

  const duplicateAuthTools = duplicateValues(config.base.setup.auth);
  if (duplicateAuthTools.length > 0) {
    throw new HarnessConfigError(
      `base.setup.auth entries must be unique: ${duplicateAuthTools.join(", ")}`,
      path
    );
  }

  const duplicatePortLabels = duplicateValues(
    config.tasks.dev.ports.map((port) => port.label)
  );
  const duplicatePorts = duplicateValues(
    config.tasks.dev.ports.map((port) => String(port.port))
  );
  if (duplicatePortLabels.length > 0 || duplicatePorts.length > 0) {
    throw new HarnessConfigError(
      "tasks.dev.ports must have unique labels and port numbers",
      path
    );
  }

  const configDirectory = dirname(path);
  if (isAbsolute(config.base.bootstrap.config)) {
    throw new HarnessConfigError(
      "base.bootstrap.config must be relative to the Harness config directory",
      path
    );
  }
  const bootstrapConfig = resolve(configDirectory, config.base.bootstrap.config);
  const bootstrapRelative = relative(configDirectory, bootstrapConfig);
  if (
    bootstrapRelative === ".." ||
    bootstrapRelative.startsWith("../") ||
    isAbsolute(bootstrapRelative)
  ) {
    throw new HarnessConfigError(
      "base.bootstrap.config must stay inside the Harness config directory",
      path
    );
  }
  if (!(await exists(bootstrapConfig))) {
    throw new HarnessConfigError(
      `base.bootstrap.config does not exist: ${bootstrapConfig}`,
      path
    );
  }
};

export const readHarnessConfig = async (
  path: string,
  source: HarnessConfigSource = "flag"
): Promise<ResolvedHarnessConfig> => {
  const absolutePath = resolve(path);
  let contents: string;
  try {
    contents = await readFile(absolutePath, "utf8");
  } catch (cause) {
    throw new HarnessConfigError(
      `failed to read Harness config: ${absolutePath}`,
      absolutePath,
      cause
    );
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(contents) as unknown;
  } catch (cause) {
    throw new HarnessConfigError(
      `failed to parse Harness config YAML: ${absolutePath}`,
      absolutePath,
      cause
    );
  }

  let config: HarnessConfig;
  try {
    config = await decodeHarnessConfig(parsed);
  } catch (cause) {
    throw new HarnessConfigError(
      `Harness config validation failed: ${absolutePath}\n${String(cause)}`,
      absolutePath,
      cause
    );
  }

  await validateHarnessConfig(config, absolutePath);
  return {
    path: absolutePath,
    directory: dirname(absolutePath),
    source,
    config
  };
};

export const resolveHarnessConfig = async (
  options: ResolveHarnessConfigOptions
): Promise<ResolvedHarnessConfig | undefined> => {
  const cwd = resolve(options.cwd);
  const requested = options.explicitPath?.trim();
  if (requested) {
    return await readHarnessConfig(
      isAbsolute(requested) ? requested : resolve(cwd, requested),
      "flag"
    );
  }

  const fromEnvironment = options.environmentPath?.trim();
  if (fromEnvironment) {
    return await readHarnessConfig(
      isAbsolute(fromEnvironment)
        ? fromEnvironment
        : resolve(cwd, fromEnvironment),
      "environment"
    );
  }

  for (const filename of ["harness.yaml", "harness.yml"] as const) {
    const candidate = resolve(cwd, filename);
    if (await exists(candidate)) {
      return await readHarnessConfig(candidate, "current-directory");
    }
  }

  return undefined;
};
