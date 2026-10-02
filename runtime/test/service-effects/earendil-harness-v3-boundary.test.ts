import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectModuleSpecifiers } from "./fixtures/typescript-syntax-oracle.js";
import { readRepositorySourceTree } from "./fixtures/repository-tool-family-oracle.js";

const root = resolve(import.meta.dir, "../../..");
const fixture = resolve(root, "historical/earendil-0.99.1");
const manifest = JSON.parse(readFileSync(resolve(fixture, "manifest.json"), "utf8"));
const latent = "src/service-effects/earendil-harness-v3-compatibility/";

describe("1.0.0 runtime / historical Harness boundary", () => {
  test("keeps the exact inactive evidence outside runtime dependency resolution", () => {
    expect(manifest.version).toBe("0.99.1");
    expect(manifest.sourceCommit).toBe("eea4816484ff80a917b43ed33cd93ea55eaf2948");
    expect(manifest.gitHead).toBe("d86654abb8862e201933517d6f1fce9f88dd117f");
    expect(manifest.tests).toHaveLength(45);
    expect(new Set(manifest.tests).size).toBe(45);
    expect(createHash("sha256").update(JSON.stringify(manifest.tests)).digest("hex")).toBe("246a1e0b03e4f89f7874a50a0f25072077de51d095a7a0b76736eaf70798b4cd");
    expect(manifest.tests.every((path: string) => (path.startsWith("test/service-effects/") || path.startsWith("test/agent-control/")) && path.endsWith(".test.ts"))).toBeTrue();
    const expectedArchive = "5e83b74bd25e0843cf3a080ae778dd160750c435979ba62cd813e90773447b53";
    expect(manifest.archive).toBe("source.tar.gz");
    expect(manifest.archiveSha256).toBe(expectedArchive);
    expect(createHash("sha256").update(readFileSync(resolve(fixture, "source.tar.gz"))).digest("hex")).toBe(expectedArchive);
    for (const path of ["runtime/src/service-effects/current-piclaw/local-execution-env.ts", `${"runtime/"}${latent}direct-assignments.ts`, `${"runtime/"}${latent}preparation-contract.ts`]) {
      expect(manifest.retiredFiles[path]).toMatch(/^[a-f0-9]{64}$/);
      expect(Bun.file(resolve(root, path)).size).toBe(0);
    }
  });

  test("production cannot import retired contracts, old SDK subpaths or experimental durable", () => {
    const tree = readRepositorySourceTree();
    expect(Object.keys(tree.files).filter(path => path.startsWith(latent))).toEqual([`${latent}manifest.ts`]);
    const incoming: string[] = [];
    for (const [path, source] of Object.entries(tree.files)) {
      if (!path.endsWith(".ts")) continue;
      for (const specifier of collectModuleSpecifiers(path, source)) {
        if (/historical\/|earendil-harness-v3-compatibility|pi-durable|pi-agent-core\/(?:node|harness|experimental)/.test(specifier)) incoming.push(`${path}: ${specifier}`);
      }
    }
    expect(incoming).toEqual([]);
    const dependencies = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(JSON.stringify(dependencies.dependencies)).not.toContain("pi-durable");
    expect(JSON.stringify(dependencies.dependencies)).not.toContain("0.99.1");
    expect(readFileSync(resolve(root, "runtime/src/agent-pool/session.ts"), "utf8")).not.toMatch(/AgentHarness|Pico3/);
  });
});
