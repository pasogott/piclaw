import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { extractModuleSpecifiers, findImportBoundaryViolations } from "../../scripts/check-import-boundaries.ts";

describe("check-import-boundaries", () => {
  test("extractModuleSpecifiers parses static, dynamic, and CommonJS imports", () => {
    const content = [
      "import x from 'a';",
      "export { y } from \"b\";",
      "const mod = await import('c');",
      "const legacy = require(\"d\");",
      "const dynamicLegacy = require(moduleName);",
    ].join("\n");

    expect(extractModuleSpecifiers(content)).toEqual(["a", "b", "c", "d"]);
  });

  test("findImportBoundaryViolations reports restricted extension imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "extensions"), { recursive: true });
      mkdirSync(join(dir, "src", "extensions"), { recursive: true });

      writeFileSync(join(dir, "extensions", "bad.ts"), "import x from '../node_modules/pkg';\n");
      writeFileSync(join(dir, "extensions", "bad2.ts"), "import x from '@earendil-works/pi-ai/dist/providers/x.js';\n");
      writeFileSync(join(dir, "extensions", "bad3.ts"), "import x from '../src/db/messages.js';\n");
      writeFileSync(
        join(dir, "src", "extensions", "helper.ts"),
        "import x from '@earendil-works/pi-ai/dist/api/openai-responses-shared.js';\n"
      );

      const violations = findImportBoundaryViolations(dir);
      expect(violations.length).toBe(4);
      expect(violations.some((v) => v.includes("node_modules relative import"))).toBeTrue();
      expect(violations.some((v) => v.includes("disallowed direct pi-ai dist import"))).toBeTrue();
      expect(violations.some((v) => v.includes("disallowed direct src import"))).toBeTrue();
      expect(violations.some((v) => v.includes("outside allowlist"))).toBeTrue();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("findImportBoundaryViolations allows bridge imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "extensions"), { recursive: true });
      mkdirSync(join(dir, "src", "extensions"), { recursive: true });

      writeFileSync(join(dir, "extensions", "ok.ts"), "import x from '../src/extensions/azure-openai-api.js';\n");
      writeFileSync(
        join(dir, "src", "extensions", "azure-openai-api.ts"),
        "import x from '@earendil-works/pi-ai/api/openai-responses-shared';\n"
      );

      expect(findImportBoundaryViolations(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("findImportBoundaryViolations keeps latent service effects unreachable from production core", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "src", "service-effects", "contracts"), { recursive: true });
      mkdirSync(join(dir, "src", "runtime"), { recursive: true });
      writeFileSync(
        join(dir, "src", "service-effects", "contracts", "common.ts"),
        "export const latent = true;\n",
      );
      writeFileSync(
        join(dir, "src", "service-effects", "contracts", "peer.ts"),
        "import { latent } from './common.js';\nconst peer = require('./common.js');\nexport { latent, peer };\n",
      );
      writeFileSync(
        join(dir, "src", "runtime", "bad.ts"),
        "import { latent } from '../service-effects/contracts/common.js';\n",
      );
      writeFileSync(
        join(dir, "src", "runtime", "bad-require.ts"),
        "const latent = require('../service-effects/contracts/common.js');\n",
      );

      expect(findImportBoundaryViolations(dir)).toEqual([
        "src/runtime/bad-require.ts: production core cannot import latent service effects (../service-effects/contracts/common.js)",
        "src/runtime/bad.ts: production core cannot import latent service effects (../service-effects/contracts/common.js)",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("findImportBoundaryViolations ignores optional extension node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "extensions"), { recursive: true });
      symlinkSync(join(dir, "missing-extension-deps"), join(dir, "extensions", "node_modules"));
      writeFileSync(join(dir, "extensions", "ok.ts"), "import x from './local.js';\n");

      expect(findImportBoundaryViolations(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
