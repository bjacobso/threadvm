import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  HarnessConfigError,
  readHarnessConfig,
  resolveHarnessConfig
} from "../packages/shared/src/config/HarnessConfig.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const examplePath = join(repoRoot, "examples/multi-repo-mise/harness.yaml");

const rawConfig = (id: string) => ({
  version: 1,
  project: {
    id,
    displayName: `Project ${id}`
  },
  workspace: {
    root: `/work/${id}`,
    sourceImage: "exeuntu"
  },
  base: {
    name: `${id}-base`,
    bootstrap: {
      provider: "mise",
      config: "./mise.toml",
      trust: true,
      command: "mise bootstrap --yes"
    },
    setup: {
      command: "mise run base:setup",
      verify: "mise run base:check",
      auth: ["github", "codex", "claude"]
    }
  },
  repositories: [
    {
      id: "app",
      url: "https://github.com/acme/app.git",
      path: "app",
      defaultBranch: "main",
      branch: {
        mode: "task",
        prefix: "threadvm/"
      }
    }
  ],
  tasks: {
    afterClone: ["mise run workspace:prepare"],
    dev: {
      command: "mise run dev",
      ports: [{ label: "web", port: 3000 }]
    }
  },
  terminal: {
    sessionPrefix: "threadvm"
  },
  agents: {
    default: "codex",
    panes: [{ label: "agent", command: "codex" }]
  }
});

const writeConfig = async (path: string, value: unknown) => {
  await writeFile(path, YAML.stringify(value), "utf8");
};

const expectConfigError = async (
  work: Promise<unknown>,
  pattern: RegExp
) => {
  await assert.rejects(work, (cause: unknown) => {
    assert.ok(cause instanceof HarnessConfigError);
    assert.match(cause.message, pattern);
    return true;
  });
};

const example = await readHarnessConfig(examplePath);
assert.equal(example.config.project.id, "acme-platform");
assert.equal(example.config.repositories.length, 3);
assert.deepEqual(example.config.base.setup.auth, ["github", "codex", "claude"]);

const directory = await mkdtemp(join(tmpdir(), "threadvm-config-probe-"));
try {
  await writeFile(join(directory, "mise.toml"), "[tools]\nnode = \"24\"\n", "utf8");
  await writeConfig(join(directory, "harness.yaml"), rawConfig("from-cwd"));
  await writeConfig(join(directory, "environment.yaml"), rawConfig("from-env"));
  await writeConfig(join(directory, "explicit.yaml"), rawConfig("from-flag"));

  const fromCurrentDirectory = await resolveHarnessConfig({ cwd: directory });
  assert.equal(fromCurrentDirectory?.source, "current-directory");
  assert.equal(fromCurrentDirectory?.config.project.id, "from-cwd");

  const fromEnvironment = await resolveHarnessConfig({
    cwd: directory,
    environmentPath: "environment.yaml"
  });
  assert.equal(fromEnvironment?.source, "environment");
  assert.equal(fromEnvironment?.config.project.id, "from-env");

  const fromFlag = await resolveHarnessConfig({
    cwd: directory,
    explicitPath: "explicit.yaml",
    environmentPath: "environment.yaml"
  });
  assert.equal(fromFlag?.source, "flag");
  assert.equal(fromFlag?.config.project.id, "from-flag");

  const duplicateRepositories = rawConfig("duplicate-repositories");
  duplicateRepositories.repositories.push({
    ...duplicateRepositories.repositories[0]!,
    path: "other"
  });
  await writeConfig(join(directory, "duplicate.yaml"), duplicateRepositories);
  await expectConfigError(
    readHarnessConfig(join(directory, "duplicate.yaml")),
    /repository ids must be unique/
  );

  const overlappingRepositories = rawConfig("overlapping-repositories");
  overlappingRepositories.repositories.push({
    ...overlappingRepositories.repositories[0]!,
    id: "nested",
    path: "app/nested"
  });
  await writeConfig(join(directory, "overlap.yaml"), overlappingRepositories);
  await expectConfigError(
    readHarnessConfig(join(directory, "overlap.yaml")),
    /repository paths overlap/
  );

  const escapingBootstrap = rawConfig("escaping-bootstrap");
  escapingBootstrap.base.bootstrap.config = "../mise.toml";
  await writeConfig(join(directory, "escape.yaml"), escapingBootstrap);
  await expectConfigError(
    readHarnessConfig(join(directory, "escape.yaml")),
    /must stay inside/
  );

  const emptyDirectory = await mkdtemp(join(tmpdir(), "threadvm-empty-config-"));
  try {
    assert.equal(await resolveHarnessConfig({ cwd: emptyDirectory }), undefined);
  } finally {
    await rm(emptyDirectory, { recursive: true, force: true });
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("config probe passed");
