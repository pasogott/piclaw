import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST } from "../../src/service-effects/earendil-harness-v3-compatibility/manifest.js";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(runtimeRoot, "..");
const modulesRoot = resolve(repositoryRoot, "node_modules");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be a record.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

async function readPackage(name: string): Promise<Record<string, unknown>> {
  return requireRecord(await Bun.file(resolve(modulesRoot, name, "package.json")).json(), `${name} package.json`);
}

function internalDependencies(manifest: Record<string, unknown>): readonly Readonly<{ name: string; range: string }>[] {
  const dependencies = manifest.dependencies === undefined ? {} : requireRecord(manifest.dependencies, "dependencies");
  return Object.keys(dependencies)
    .filter((name) => name.startsWith("@earendil-works/"))
    .sort()
    .map((name) => ({ name, range: requireString(dependencies[name], `${name} dependency range`) }));
}

function exportNames(manifest: Record<string, unknown>): readonly string[] {
  if (manifest.exports === undefined) return [];
  return Object.keys(requireRecord(manifest.exports, "exports")).sort();
}

function publicTarget(manifest: Record<string, unknown>, subpath: string, kind: "runtime" | "declaration"): string {
  const exportsMap = requireRecord(manifest.exports, "exports");
  const entry = requireRecord(exportsMap[subpath], `exports[${subpath}]`);
  return requireString(entry[kind === "runtime" ? "import" : "types"], `${subpath} ${kind} target`);
}

async function sha256(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

describe("Earendil release churn gate", () => {
  test("pins the repository and lockfile to the accepted coherent 0.84.1 family", async () => {
    const baseline = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[0];
    const rootManifest = requireRecord(await Bun.file(resolve(repositoryRoot, "package.json")).json(), "repository package.json");
    const rootDependencies = requireRecord(rootManifest.dependencies, "repository dependencies");
    for (const directName of [
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
    ]) {
      expect(rootDependencies[directName]).toBe("0.84.1");
    }

    const lock = await Bun.file(resolve(repositoryRoot, "bun.lock")).text();
    const candidate = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[1];
    for (const evidence of candidate.packages) expect(lock).not.toContain(`${evidence.name}@0.84.2`);
    for (const evidence of baseline.packages) {
      const packageEntry = `"${evidence.name}": ["${evidence.name}@0.84.1"`;
      if (evidence.installation === "not_installed") {
        expect(lock).not.toContain(packageEntry);
      } else {
        expect(lock).toContain(packageEntry);
        expect(lock).toContain(`"${evidence.integrity}"`);
      }
    }
  });

  test("matches installed public package manifests, export maps, engines, and internal ranges", async () => {
    const baseline = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[0];
    expect(baseline.packages).toHaveLength(9);
    for (const evidence of baseline.packages) {
      const directory = resolve(modulesRoot, evidence.name);
      if (evidence.installation === "not_installed") {
        expect(existsSync(directory)).toBe(false);
        continue;
      }
      const installed = await readPackage(evidence.name);
      expect(installed.name).toBe(evidence.name);
      expect(installed.version).toBe(evidence.version);
      expect(requireRecord(installed.engines, `${evidence.name} engines`).node).toBe(evidence.engine);
      expect(exportNames(installed)).toEqual(evidence.exports);
      expect(internalDependencies(installed)).toEqual(evidence.internalDependencies);
    }
  });

  test("matches baseline hashes only through package-declared public export targets", async () => {
    const baseline = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[0];
    for (const fingerprint of baseline.fingerprints) {
      if (fingerprint.subpath.startsWith("audit:")) continue;
      const installed = await readPackage(fingerprint.package);
      const target = publicTarget(installed, fingerprint.subpath, fingerprint.kind);
      const packageRoot = resolve(modulesRoot, fingerprint.package);
      expect(await sha256(resolve(packageRoot, target))).toBe(fingerprint.sha256);
    }
  });

  test("keeps 0.84.2 coordinates and fingerprints inert as rejected source-as-data evidence", () => {
    const candidate = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[1];
    expect(candidate).toMatchObject({
      role: "audited_candidate",
      tag: "v0.84.2",
      commit: "914cf1472e715297caa30db4b9535d534a9eb718",
      execution: "evidence_only",
    });
    expect(candidate.packages).toHaveLength(9);
    expect(candidate.packages.every((entry) => entry.version === "0.84.2" && entry.installation === "evidence_only")).toBe(true);
    expect(candidate.fingerprints.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);
    expect(candidate.conformance).toMatchObject({
      caseCount: 30,
      catalogueSha256: "46636aec941f7bbd5fcec6b3aec2b8e43518a0482a1b7f4fd4c1d5197e69f387",
      resultSha256: "f2c7e067e69daf3e730da4dcab2a0ca14bba31be462c81aa70af0ac10b43e504",
      memory: "audited_evidence_pass",
      jsonl: "audited_evidence_pass",
      sqlite: "unsupported",
    });
  });
});
