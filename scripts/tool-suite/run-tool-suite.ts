import { promises as fs } from "node:fs";
import path from "node:path";

const STUB_PATTERNS = [
  "TODO(STUB)",
  ['throw new Error("', "Not implemented", '")'].join(""),
  "return null as any",
];
const IGNORE_DIRS = new Set(["node_modules", "dist", ".git"]);

async function collectFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const files = await collectFiles(root);
  const filesToScan = files.filter(
    (file) => !file.endsWith(path.join("scripts", "tool-suite", "run-tool-suite.ts")),
  );
  const violations: Array<{ file: string; pattern: string }> = [];

  for (const file of filesToScan) {
    const content = await fs.readFile(file, "utf8");
    for (const pattern of STUB_PATTERNS) {
      if (content.includes(pattern)) {
        violations.push({ file: path.relative(root, file), pattern });
      }
    }
  }

  if (violations.length > 0) {
    const lines = violations.map((violation) => `- ${violation.file}: ${violation.pattern}`).join("\n");
    throw new Error(`Stub marker check failed:\n${lines}`);
  }

  process.stdout.write("Stub marker check passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
