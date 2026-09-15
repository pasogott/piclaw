import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contractPath = resolve(import.meta.dir, "../../../tests/e2e/features/canonical/canonical-ux.feature");
const expectedHash = "a08a623880c6f327bc051edc51bb2bbff2959aed86421b5227e61d5a92fc2441";

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
    "Render model-generated SVG inline",
    "unsafe elements and attributes are removed",
  ]) {
    expect(contract).toContain(topic);
  }

  expect(contract).toContain("@safety-deviation");
  expect(contract).toContain("visual equality must not be achieved by enabling an unsafe action");
});
