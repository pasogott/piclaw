#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const ALLOWLIST = new Set([
  "runtime/scripts/local-test-priority.ts", // the central launcher implementation
  "runtime/scripts/controlled-test-runner.ts", // nested Bun stages inherit the launcher root's niceness
  "runtime/test/features/run-feature-tests.ts", // nested feature subprocess inherits the launcher root's niceness
  "runtime/test/scripts/local-test-priority.test.ts", // launcher/audit fixtures intentionally mention raw runners
  "runtime/test/scripts/controlled-test-runner.test.ts", // invokes the controlled runner as a test fixture
]);
const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".sh", ".json"]);
const RAW_PATTERNS = [
  /\bbun\s+test\b/,
  /\b(?:bunx\s+)?playwright\s+test\b/,
  /["']test["']\s*,/,
];

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of ["package.json", "Makefile", "scripts/**/*", "runtime/scripts/**/*", "runtime/test/features/**/*", "tests/e2e/package.json"]) {
    const glob = new Bun.Glob(pattern);
    for await (const match of glob.scan({ cwd: ROOT, absolute: false, onlyFiles: true })) {
      const extension = match === "Makefile" ? ".sh" : match.slice(match.lastIndexOf("."));
      if (SOURCE_EXTENSIONS.has(extension)) files.push(match.replaceAll("\\", "/"));
    }
  }
  return [...new Set(files)].sort();
}

export async function auditLocalTestEntrypoints(): Promise<readonly string[]> {
  const violations: string[] = [];
  for (const path of await sourceFiles()) {
    if (ALLOWLIST.has(path)) continue;
    const lines = readFileSync(join(ROOT, path), "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*(?:#|\/\/|\*)/.test(line)) continue;
      const previousLine = lines[index - 1] ?? "";
      if (
        line.includes("local-test-priority") || line.includes("test:local") ||
        previousLine.includes("local-test-priority") || previousLine.includes("test:local")
      ) continue;
      if (RAW_PATTERNS.some((pattern) => pattern.test(line))) {
        violations.push(`${path}:${index + 1}:${line.trim()}`);
      }
    }
  }
  return violations;
}

if (import.meta.main) {
  const violations = await auditLocalTestEntrypoints();
  if (violations.length > 0) {
    process.stderr.write(`[local-test-entrypoints] raw local test invocation(s):\n${violations.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("[local-test-entrypoints] ok\n");
}
