import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contractPath = resolve(import.meta.dir, "../../../tests/e2e/features/canonical/canonical-ux.feature");
const expectedHash = "a3bad9d5df6f75f85d7b367989be7345175e137a5e10a9234d38a295c1c26d83";

test("canonical cross-port UX contract retains the vetted source and required topics", () => {
  const contract = readFileSync(contractPath, "utf8");
  expect(createHash("sha256").update(contract).digest("hex")).toBe(expectedHash);

  for (const topic of [
    "/skill:<name>",
    "no separate Skills group",
    "one session-scoped \"plan\" tool",
    "multiple explicit message IDs",
    "after-row or before-row window",
    "Copy message action",
    "Delete message action",
    "session picker",
    "model picker",
    "running glyph",
    "terminal glyph",
    "elapsed timer",
    "reduced-motion mode",
  ]) {
    expect(contract).toContain(topic);
  }

  expect(contract).toContain("@safety-deviation");
  expect(contract).toContain("visual equality must not be achieved by enabling an unsafe action");
});
