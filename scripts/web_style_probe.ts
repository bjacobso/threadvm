import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const webSourceRoot = path.join(repoRoot, "apps/web/src");

const ignoredDirs = new Set(["dist", "node_modules"]);

const sourceFiles = async (dir: string): Promise<Array<string>> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return ignoredDirs.has(entry.name) ? [] : [sourceFiles(fullPath)];
      }
      return fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")
        ? [[fullPath]]
        : [];
    })
  );
  return files.flat();
};

const rawColorPattern =
  /#[0-9a-fA-F]{3,8}|\b(?:bg|text|border|ring|outline|decoration|from|via|to|fill|stroke)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:\/[0-9]{1,3}|-[0-9]{1,3}(?:\/[0-9]{1,3})?)?\b/;

const checkFile = async (file: string): Promise<Array<Violation>> => {
  const source = await readFile(file, "utf8");
  return source
    .split("\n")
    .flatMap((text, index) =>
      rawColorPattern.test(text)
        ? [
            {
              file,
              line: index + 1,
              text: text.trim(),
              reason: "use semantic shadcn/Tailwind tokens instead of raw colors"
            }
          ]
        : []
    );
};

const files = await sourceFiles(webSourceRoot);
const violations = (await Promise.all(files.map(checkFile))).flat();

if (violations.length > 0) {
  console.error("web style probe failed");
  for (const violation of violations) {
    console.error(
      `- ${path.relative(repoRoot, violation.file)}:${violation.line}: ${violation.reason}`
    );
    console.error(`  ${violation.text}`);
  }
  process.exitCode = 1;
} else {
  console.log(`web style probe ok (${files.length} files)`);
}
