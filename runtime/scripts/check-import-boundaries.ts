#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ENTRY_EXTENSIONS_DIR = "extensions";
const SRC_EXTENSIONS_DIR = "src/extensions";

const ALLOWED_ENTRY_SRC_IMPORT_PREFIX = "../src/extensions/";
const LATENT_SERVICE_EFFECTS_DIR = "src/service-effects";
const SERVICE_EFFECTS_TESTING_DIR = "src/service-effects/testing";

function walkFiles(baseDir: string, suffix: string): string[] {
  if (!existsSync(baseDir)) return [];
  const out: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
      } else if (stats.isFile() && full.endsWith(suffix)) {
        out.push(full);
      }
    }
  };

  walk(baseDir);
  return out;
}

export function extractModuleSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const staticImportRegex = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportRegex = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  const requireRegex = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

  for (const regex of [staticImportRegex, dynamicImportRegex, requireRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function importsLatentServiceEffects(specifier: string): boolean {
  return /(?:^|\/)service-effects(?:\/|$)/.test(specifier);
}

function importsServiceEffectsTesting(specifier: string): boolean {
  return /(?:^|\/)service-effects\/testing(?:\/|$)/.test(specifier) ||
    /(?:^|\/)testing(?:\/|$)/.test(specifier);
}

export function findImportBoundaryViolations(projectDir: string): string[] {
  const violations: string[] = [];
  const entryFiles = walkFiles(join(projectDir, ENTRY_EXTENSIONS_DIR), ".ts");
  const srcBridgeFiles = walkFiles(join(projectDir, SRC_EXTENSIONS_DIR), ".ts");
  const productionFiles = walkFiles(join(projectDir, "src"), ".ts");

  for (const file of entryFiles) {
    const rel = relative(projectDir, file);
    const specifiers = extractModuleSpecifiers(readFileSync(file, "utf8"));

    for (const specifier of specifiers) {
      if (specifier.includes("../node_modules/")) {
        violations.push(`${rel}: disallowed node_modules relative import (${specifier})`);
      }
      if (specifier.startsWith("@earendil-works/pi-ai/dist/")) {
        violations.push(`${rel}: disallowed direct pi-ai dist import (${specifier})`);
      }
      if (specifier.startsWith("../src/") && !specifier.startsWith(ALLOWED_ENTRY_SRC_IMPORT_PREFIX)) {
        violations.push(`${rel}: disallowed direct src import (${specifier})`);
      }
    }
  }

  for (const file of srcBridgeFiles) {
    const rel = relative(projectDir, file);
    const specifiers = extractModuleSpecifiers(readFileSync(file, "utf8"));
    for (const specifier of specifiers) {
      if (specifier.startsWith("@earendil-works/pi-ai/dist/")) {
        violations.push(`${rel}: disallowed pi-ai dist import outside allowlist (${specifier})`);
      }
    }
  }

  for (const file of productionFiles) {
    const rel = relative(projectDir, file);
    const inServiceEffects = rel === LATENT_SERVICE_EFFECTS_DIR || rel.startsWith(`${LATENT_SERVICE_EFFECTS_DIR}/`);
    const inServiceEffectsTesting = rel === SERVICE_EFFECTS_TESTING_DIR || rel.startsWith(`${SERVICE_EFFECTS_TESTING_DIR}/`);
    const specifiers = extractModuleSpecifiers(readFileSync(file, "utf8"));
    for (const specifier of specifiers) {
      if (!inServiceEffects && importsLatentServiceEffects(specifier)) {
        violations.push(`${rel}: production core cannot import latent service effects (${specifier})`);
      }
      if (inServiceEffects && !inServiceEffectsTesting && importsServiceEffectsTesting(specifier)) {
        violations.push(`${rel}: service-effects production layer cannot import testing (${specifier})`);
      }
    }
  }

  return violations.sort();
}

if (import.meta.main) {
  const violations = findImportBoundaryViolations(process.cwd());
  if (violations.length > 0) {
    console.error("[import-boundaries] detected violations:");
    for (const violation of violations) {
      console.error(` - ${violation}`);
    }
    process.exit(1);
  }

  console.log("[import-boundaries] ok");
}
