import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(import.meta.dir, "../../src");

function staticImports(entry: string): string[] {
  const file = resolve(source, entry);
  return new Bun.Transpiler({ loader: "ts" })
    .scanImports(readFileSync(file, "utf8").replace(/^#![^\n]*\n/, ""))
    .filter((specifier) => specifier.kind === "import-statement")
    .map((specifier) => specifier.path);
}

for (const entry of ["dream.ts", "task-scheduler.ts", "runtime/message-loop.ts"]) {
  test(`${entry} imports recovery-summary and not automatic-recovery`, () => {
    const imports = staticImports(entry);
    expect(imports).toContain(entry === "runtime/message-loop.ts"
      ? "../agent-pool/recovery-summary.js"
      : "./agent-pool/recovery-summary.js");
    expect(imports).not.toContain(entry === "runtime/message-loop.ts"
      ? "../agent-pool/automatic-recovery.js"
      : "./agent-pool/automatic-recovery.js");
  });
}
