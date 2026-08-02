import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const settingsDir = join(import.meta.dir, "../../web/src/components/settings");

for (const file of ["general.ts", "sessions.ts", "workspace.ts"]) {
  test(`${file} does not discard autosave while a number stepper retains focus`, () => {
    const source = readFileSync(join(settingsDir, file), "utf8");
    expect(source).not.toContain("active.closest?.('.settings-number-stepper')");
    expect(source).not.toContain("document.activeElement");
  });
}

test("general and session settings surface failed autosaves instead of retaining local-only values", () => {
  for (const file of ["general.ts", "sessions.ts"]) {
    const source = readFileSync(join(settingsDir, file), "utf8");
    expect(source).toContain("throw new Error(payload?.error");
    expect(source).toContain("setStatus?.(String(error?.message || error), 'error')");
  }
});

test("number stepper commits typed values on blur and button nudges immediately", () => {
  const source = readFileSync(join(settingsDir, "number-stepper.ts"), "utf8");
  expect(source).toContain("onBlur=${(e) => commit(e.target.value)}");
  expect(source).toContain("onClick=${() => nudge(-1)}");
  expect(source).toContain("onClick=${() => nudge(1)}");
  expect(source).toContain("onChange?.(next)");
});
