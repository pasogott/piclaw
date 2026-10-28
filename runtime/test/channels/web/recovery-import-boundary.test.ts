import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const recoveryPath = resolve(import.meta.dir, "../../../src/channels/web/runtime/recovery.ts");

test("web recovery runtime does not reference legacy rollback helpers", () => {
  const source = readFileSync(recoveryPath, "utf8");
  expect(source).not.toContain("rollbackInflightRun");
  expect(source).not.toContain("clearInflightMarker");
  expect(source).not.toContain("getInflightRuns");
  expect(source).not.toContain("getPreflightRuns");
  expect(source).toContain("resumePendingChats");
});
