import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type WorkspaceName =
  | "@threadvm/cli"
  | "@threadvm/server"
  | "@threadvm/shared"
  | "@threadvm/web";

interface Workspace {
  readonly name: WorkspaceName;
  readonly root: string;
  readonly src: string;
}

interface ImportReference {
  readonly file: string;
  readonly specifier: string;
}

interface Violation {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

interface ArchitectureViolation {
  readonly file: string;
  readonly reason: string;
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const workspaces: ReadonlyArray<Workspace> = [
  {
    name: "@threadvm/web",
    root: path.join(repoRoot, "apps/web"),
    src: path.join(repoRoot, "apps/web/src")
  },
  {
    name: "@threadvm/server",
    root: path.join(repoRoot, "apps/server"),
    src: path.join(repoRoot, "apps/server/src")
  },
  {
    name: "@threadvm/cli",
    root: path.join(repoRoot, "apps/cli"),
    src: path.join(repoRoot, "apps/cli/src")
  },
  {
    name: "@threadvm/shared",
    root: path.join(repoRoot, "packages/shared"),
    src: path.join(repoRoot, "packages/shared/src")
  }
];

const allowedImports: Record<WorkspaceName, ReadonlySet<WorkspaceName>> = {
  "@threadvm/web": new Set(["@threadvm/shared"]),
  "@threadvm/server": new Set(["@threadvm/shared"]),
  "@threadvm/cli": new Set(["@threadvm/server", "@threadvm/shared"]),
  "@threadvm/shared": new Set()
};

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".css"];

const isSourceFile = (file: string) =>
  file.endsWith(".ts") || file.endsWith(".tsx");

const isIgnoredDir = (name: string) => name === "dist" || name === "node_modules";

const inside = (candidate: string, parent: string) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const findWorkspaceByFile = (file: string) =>
  workspaces.find((workspace) => inside(file, workspace.root));

const threadVmPackageName = (specifier: string): WorkspaceName | undefined => {
  if (!specifier.startsWith("@threadvm/")) {
    return undefined;
  }

  const [scope, name] = specifier.split("/");
  const packageName = `${scope}/${name}` as WorkspaceName;
  return workspaces.some((workspace) => workspace.name === packageName)
    ? packageName
    : undefined;
};

const readSourceFiles = async (dir: string): Promise<Array<string>> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return isIgnoredDir(entry.name) ? [] : [readSourceFiles(fullPath)];
      }
      return isSourceFile(fullPath) ? [[fullPath]] : [];
    })
  );

  return files.flat();
};

const importPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

const readImports = async (file: string): Promise<Array<ImportReference>> => {
  const source = await readFile(file, "utf8");
  const references: Array<ImportReference> = [];
  for (const match of source.matchAll(importPattern)) {
    references.push({
      file,
      specifier: match[1] ?? match[2]
    });
  }
  return references;
};

const exists = async (file: string) =>
  access(file)
    .then(() => true)
    .catch(() => false);

const resolveRelativeImport = async (fromFile: string, specifier: string) => {
  const rawTarget = path.resolve(path.dirname(fromFile), specifier);
  const hasExtension = path.extname(rawTarget) !== "";
  const candidates = hasExtension
    ? [rawTarget]
    : [
        rawTarget,
        ...sourceExtensions.map((extension) => `${rawTarget}${extension}`),
        ...sourceExtensions.map((extension) =>
          path.join(rawTarget, `index${extension}`)
        )
      ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return rawTarget;
};

const checkReference = async (
  reference: ImportReference
): Promise<Violation | undefined> => {
  const sourceWorkspace = findWorkspaceByFile(reference.file);
  if (!sourceWorkspace) {
    return undefined;
  }

  const internalPackage = threadVmPackageName(reference.specifier);
  if (internalPackage) {
    if (internalPackage === sourceWorkspace.name) {
      return undefined;
    }
    if (allowedImports[sourceWorkspace.name].has(internalPackage)) {
      return undefined;
    }
    return {
      ...reference,
      reason: `${sourceWorkspace.name} may not import ${internalPackage}`
    };
  }

  if (!reference.specifier.startsWith(".")) {
    return undefined;
  }

  const resolved = await resolveRelativeImport(reference.file, reference.specifier);
  const targetWorkspace = findWorkspaceByFile(resolved);
  if (!targetWorkspace) {
    return {
      ...reference,
      reason: "relative import resolves outside a known ThreadVM workspace"
    };
  }

  if (targetWorkspace.name === sourceWorkspace.name) {
    return undefined;
  }

  return {
    ...reference,
    reason: `cross-workspace relative import from ${sourceWorkspace.name} to ${targetWorkspace.name}; use a package import instead`
  };
};

const plannedFeatureAtomModules = [
  "apps/web/src/features/threadvms/threadVmAtoms.ts",
  "apps/web/src/features/terminal/terminalAtoms.ts"
] as const;

const featureStateEntryPoint = (file: string) => {
  const relative = path.relative(repoRoot, file);
  if (
    relative.startsWith("apps/web/src/features/threadvms/") &&
    relative !== "apps/web/src/features/threadvms/threadVmAtoms.ts"
  ) {
    return "./threadVmAtoms";
  }
  if (
    relative.startsWith("apps/web/src/features/terminal/") &&
    relative !== "apps/web/src/features/terminal/terminalAtoms.ts"
  ) {
    return "./terminalAtoms";
  }
  return undefined;
};

const checkFeatureAtomBoundaries = async (
  references: ReadonlyArray<ImportReference>
) => {
  const violations: Array<ArchitectureViolation> = [];

  for (const modulePath of plannedFeatureAtomModules) {
    if (!(await exists(path.join(repoRoot, modulePath)))) {
      violations.push({
        file: path.join(repoRoot, modulePath),
        reason: "planned feature atom module is missing"
      });
    }
  }

  for (const reference of references) {
    const expectedEntryPoint = featureStateEntryPoint(reference.file);
    if (
      expectedEntryPoint &&
      reference.specifier === "@/state/atoms"
    ) {
      violations.push({
        file: reference.file,
        reason: `feature state should be imported from ${expectedEntryPoint}, not @/state/atoms`
      });
    }
  }

  return violations;
};

const main = async () => {
  const sourceFiles = (
    await Promise.all(workspaces.map((workspace) => readSourceFiles(workspace.src)))
  ).flat();
  const references = (await Promise.all(sourceFiles.map(readImports))).flat();
  const violations = (
    await Promise.all(references.map(checkReference))
  ).filter((violation): violation is Violation => violation !== undefined);
  const architectureViolations = await checkFeatureAtomBoundaries(references);

  if (violations.length > 0 || architectureViolations.length > 0) {
    console.error("workspace boundary probe failed");
    for (const violation of violations) {
      console.error(
        `- ${path.relative(repoRoot, violation.file)} imports ${JSON.stringify(
          violation.specifier
        )}: ${violation.reason}`
      );
    }
    for (const violation of architectureViolations) {
      console.error(
        `- ${path.relative(repoRoot, violation.file)}: ${violation.reason}`
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `workspace boundary probe ok (${sourceFiles.length} files, ${references.length} imports)`
  );
};

await main();
