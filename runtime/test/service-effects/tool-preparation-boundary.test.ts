import "../helpers.js";

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

import { describe, expect, test } from "bun:test";

const runtimeRoot = resolve(import.meta.dir, "../..");
const packageRoot = resolve(runtimeRoot, "..");
const latentRoot = resolve(runtimeRoot, "src/service-effects/tool-preparation");

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map((match) => match[1]);
}

function stringArray(source: string, constant: string): string[] {
  const match = source.match(new RegExp(`const\\s+${constant}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`));
  if (!match) throw new Error(`missing ${constant}`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1]);
}

describe("WP-3C latent import and registration boundary", () => {
  test("production core has no import of the latent tool-preparation package", () => {
    const productionRoot = resolve(runtimeRoot, "src");
    const violations: string[] = [];
    for (const path of walk(productionRoot)) {
      if (path.startsWith(resolve(runtimeRoot, "src/service-effects"))) continue;
      for (const specifier of importSpecifiers(readFileSync(path, "utf8"))) {
        if (specifier.includes("service-effects/tool-preparation")) {
          violations.push(`${relative(runtimeRoot, path)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("has no root or subtree barrel export", () => {
    expect(existsSync(resolve(latentRoot, "index.ts"))).toBeFalse();
    for (const path of [resolve(runtimeRoot, "src/index.ts"), resolve(packageRoot, "package.json")]) {
      expect(readFileSync(path, "utf8")).not.toContain("tool-preparation");
    }
  });

  test("latent production files contain data and pure validation only", () => {
    const forbidden = [
      /\.registerTool\s*\(/,
      /setActiveTools\s*\(/,
      /create(?:Read|Write|Edit|Bash)Tool\s*\(/,
      /set(?:Interval|Timeout)\s*\(/,
      /Bun\.serve\s*\(/,
      /from\s+["'][^"']*(?:db|keychain|ssh-core|mcp-adapter)[^"']*["']/,
    ];
    const violations: string[] = [];
    for (const path of walk(latentRoot)) {
      const source = readFileSync(path, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(source)) violations.push(`${relative(runtimeRoot, path)} matched ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("default and Windows baseline declarations remain unchanged", () => {
    const source = readFileSync(resolve(runtimeRoot, "src/extensions/tool-activation.ts"), "utf8");
    expect(stringArray(source, "DEFAULT_ACTIVE_TOOL_NAMES")).toEqual([
      "read",
      "bash",
      "powershell",
      "edit",
      "write",
      "list_tools",
      "activate_tools",
      "reset_active_tools",
      "attach_file",
      "messages",
      "chat",
      "keychain",
      "exit_process",
      "session_status",
    ]);
    expect(stringArray(source, "WINDOWS_DEFAULT_ACTIVE_TOOL_NAMES")).toEqual(["bun_run"]);
  });
});
