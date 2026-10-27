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

const cases: Array<{ entry: string; expected: string; legacy: string }> = [
  {
    entry: "agent-control/agent-control-helpers.ts",
    expected: "../agent-pool/recovery-classification.js",
    legacy: "../agent-pool/automatic-recovery.js",
  },
  {
    entry: "agent-pool/context-pressure-retry.ts",
    expected: "./recovery-classification.js",
    legacy: "./automatic-recovery.js",
  },
  {
    entry: "channels/web/sse/agent-events.ts",
    expected: "../../../agent-pool/recovery-classification.js",
    legacy: "../../../agent-pool/automatic-recovery.js",
  },
];

for (const { entry, expected, legacy } of cases) {
  test(`${entry} imports recovery-classification and not automatic-recovery`, () => {
    const imports = staticImports(entry);
    expect(imports).toContain(expected);
    expect(imports).not.toContain(legacy);
  });
}


test("native web no longer imports the retired opaque attempt classifier", () => {
  const imports = staticImports("channels/web/handlers/agent.ts");
  expect(imports).not.toContain("../../../agent-pool/recovery-classification.js");
  expect(imports).not.toContain("../../../agent-pool/automatic-recovery.js");
});
