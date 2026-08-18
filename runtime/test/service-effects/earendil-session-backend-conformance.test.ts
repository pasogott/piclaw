import { describe, expect, test } from "bun:test";

import { createSessionBackendConformance } from "@earendil-works/pi-agent-core/session/testing";

import { EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST } from "../../src/service-effects/earendil-harness-v3-compatibility/manifest.js";
import {
  createEarendilJsonlSessionFixture,
  createEarendilMemorySessionFixture,
} from "./fixtures/earendil-session-backend-fixtures.js";

const BACKENDS = [
  ["Memory", createEarendilMemorySessionFixture],
  ["JSONL", createEarendilJsonlSessionFixture],
] as const;

for (const [backend, factory] of BACKENDS) {
  const cases = createSessionBackendConformance(factory);
  describe(`Earendil 0.84.1 ${backend} unchanged public conformance`, () => {
    test("retains the exact accepted 29-case catalogue", () => {
      const catalogue = cases.map(({ group, name }) => ({ group, name }));
      const catalogueJson = `${JSON.stringify(catalogue, null, 2)}\n`;
      const digest = new Bun.CryptoHasher("sha256").update(catalogueJson).digest("hex");
      const baseline = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[0];
      expect(cases).toHaveLength(29);
      expect(baseline.conformance.caseCount).toBe(29);
      expect(digest).toBe("5b95af47d991cf4011f7fe42c6229779860d4ec5a5977cc16e7cf654ba170d96");
      expect(digest).toBe(baseline.conformance.catalogueSha256);
    });

    for (const testCase of cases) {
      test(`${testCase.group} / ${testCase.name}`, () => testCase.run());
    }
  });
}

test("keeps SQLite explicitly unsupported under the repository Bun runtime", () => {
  const baseline = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[0];
  const candidate = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[1];
  expect(baseline.conformance.sqlite).toBe("unsupported");
  expect(baseline.conformance.sqliteReason).toBe("package_not_installed");
  expect(candidate.conformance.sqlite).toBe("unsupported");
  expect(candidate.conformance.sqliteReason).toBe("bun_node_sqlite_unavailable");
});
