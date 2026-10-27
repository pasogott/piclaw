import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const testsRoot = resolve(import.meta.dir, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("only automatic-recovery.test.ts uses automatic-recovery compatibility barrel", () => {
  const files = walk(testsRoot);
  const importers = files
    .filter((file) => new Bun.Transpiler({ loader: "ts" })
      .scanImports(readFileSync(file, "utf8").replace(/^#![^\n]*\n/, ""))
      .some((specifier) => specifier.kind === "import-statement"
        && specifier.path.includes("automatic-recovery.js")))
    .map((file) => file.slice(testsRoot.length + 1).replaceAll("\\", "/"))
    .sort();

  expect(importers).toEqual(["agent-pool/automatic-recovery.test.ts"]);
});
