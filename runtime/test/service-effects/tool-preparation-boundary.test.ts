import "../helpers.js";

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

import { describe, expect, test } from "bun:test";
import ts from "typescript";

import { TOOL_PREPARATION_MANIFEST } from "../../src/service-effects/tool-preparation/manifest.js";
import {
  inventoryRepositoryToolFamilies,
  readRepositorySourceTree,
} from "./fixtures/repository-tool-family-oracle.js";

const runtimeRoot = resolve(import.meta.dir, "../..");
const packageRoot = resolve(runtimeRoot, "..");
const latentRoot = resolve(runtimeRoot, "src/service-effects/tool-preparation");
const latentPrefix = "src/service-effects/tool-preparation/";

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function stringArray(source: string, constant: string): string[] {
  const match = source.match(new RegExp(`const\\s+${constant}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`));
  if (!match) throw new Error(`missing ${constant}`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1]);
}

function moduleSpecifiers(file: string, source: string): readonly string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const output: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      output.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") {
        output.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return Object.freeze(output);
}

function resolveModule(from: string, specifier: string, files: Readonly<Record<string, string>>): string | null {
  if (!specifier.startsWith(".")) return null;
  const raw = resolve(dirname(resolve(runtimeRoot, from)), specifier);
  const relativeRaw = relative(runtimeRoot, raw).replaceAll("\\", "/");
  const candidates = [
    relativeRaw,
    relativeRaw.replace(/\.(?:mjs|cjs|js)$/, ".ts"),
    `${relativeRaw}.ts`,
    `${relativeRaw}/index.ts`,
  ];
  return candidates.find((candidate) => Object.hasOwn(files, candidate)) ?? null;
}

function importGraph(files: Readonly<Record<string, string>>): ReadonlyMap<string, readonly string[]> {
  const graph = new Map<string, readonly string[]>();
  for (const [file, source] of Object.entries(files)) {
    graph.set(file, Object.freeze(moduleSpecifiers(file, source).flatMap((specifier) => {
      const resolved = resolveModule(file, specifier, files);
      return resolved ? [resolved] : [];
    })));
  }
  return graph;
}

function reachable(graph: ReadonlyMap<string, readonly string[]>, root: string): readonly string[] {
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...(graph.get(file) ?? []));
  }
  return Object.freeze([...seen].sort());
}

describe("WP-3C static import graph and inert top-level boundary", () => {
  test("has no direct, dynamic, require, re-export, alias or package-export edge into latent preparation", () => {
    const tree = readRepositorySourceTree();
    const violations: string[] = [];
    for (const [file, source] of Object.entries(tree.files)) {
      if (file.startsWith(latentPrefix)) continue;
      for (const specifier of moduleSpecifiers(file, source)) {
        const resolved = resolveModule(file, specifier, tree.files);
        if (specifier.includes("service-effects/tool-preparation") || resolved?.startsWith(latentPrefix)) {
          violations.push(`${file} -> ${specifier}`);
        }
      }
    }
    const packageJson = readFileSync(resolve(packageRoot, "package.json"), "utf8");
    expect(violations).toEqual([]);
    expect(packageJson).not.toContain("tool-preparation");
  });

  test("latent modules are transitively unreachable from the production entrypoint", () => {
    const tree = readRepositorySourceTree();
    const graph = importGraph(tree.files);
    const productionReachable = reachable(graph, "src/index.ts");
    expect(productionReachable.filter((file) => file.startsWith(latentPrefix))).toEqual([]);
  });

  test("test oracles have no production-implementation imports", () => {
    const oraclePaths = [
      "test/service-effects/fixtures/addon-package-tree-oracle.ts",
      "test/service-effects/fixtures/mcp-metadata-oracle.ts",
      "test/service-effects/fixtures/protected-observer.ts",
      "test/service-effects/fixtures/repository-tool-family-oracle.ts",
    ];
    for (const file of oraclePaths) {
      const source = readFileSync(resolve(runtimeRoot, file), "utf8");
      expect(moduleSpecifiers(file, source).filter((specifier) => specifier.startsWith(".") || specifier.includes("pi-mcp-adapter"))).toEqual([]);
    }
  });

  test("has no root/subtree barrel and no top-level activation or I/O form", () => {
    expect(existsSync(resolve(latentRoot, "index.ts"))).toBeFalse();
    const forbiddenText = [
      /\.registerTool\s*\(/,
      /setActiveTools\s*\(/,
      /create(?:Read|Write|Edit|Bash)Tool\s*\(/,
      /set(?:Interval|Timeout)\s*\(/,
      /Bun\.serve\s*\(/,
      /(?:process|Bun)\.env/,
      /from\s+["'][^"']*(?:node:fs|db|keychain|ssh-core|mcp-adapter)[^"']*["']/,
    ];
    const violations: string[] = [];
    for (const path of walk(latentRoot)) {
      const source = readFileSync(path, "utf8");
      const file = relative(runtimeRoot, path).replaceAll("\\", "/");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      for (const statement of ast.statements) {
        if (ts.isExpressionStatement(statement) || ts.isForStatement(statement) || ts.isForOfStatement(statement) || ts.isWhileStatement(statement)) {
          violations.push(`${file} has top-level ${ts.SyntaxKind[statement.kind]}`);
        }
      }
      for (const pattern of forbiddenText) {
        if (pattern.test(source)) violations.push(`${file} matched ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("WP-3C active-composition snapshots", () => {
  test("default and Windows activation declarations remain byte-for-byte semantic snapshots", () => {
    const source = readFileSync(resolve(runtimeRoot, "src/extensions/tool-activation.ts"), "utf8");
    expect(stringArray(source, "DEFAULT_ACTIVE_TOOL_NAMES")).toEqual([
      "read", "bash", "powershell", "edit", "write", "list_tools", "activate_tools", "reset_active_tools",
      "attach_file", "messages", "chat", "keychain", "exit_process", "session_status",
    ]);
    expect(stringArray(source, "WINDOWS_DEFAULT_ACTIVE_TOOL_NAMES")).toEqual(["bun_run"]);
  });

  // Six full source-as-data AST compositions are intentionally bounded above Bun's default timeout.
  test("models Linux, Windows and gated production compositions without execution", () => {
    const tree = readRepositorySourceTree();
    const withoutLatent = Object.freeze({
      files: Object.freeze(Object.fromEntries(Object.entries(tree.files).filter(([file]) => !file.startsWith(latentPrefix)))),
    });
    const configurations = [
      { platform: "linux" as const, enabledEnv: new Set<string>() },
      { platform: "win32" as const, enabledEnv: new Set<string>() },
      { platform: "linux" as const, enabledEnv: new Set(["PICLAW_ENABLE_M365_EXPERIMENTAL"]) },
    ];
    const withLatent = configurations.map((config) => inventoryRepositoryToolFamilies(tree, config));
    const withoutLatentInventories = configurations.map((config) => inventoryRepositoryToolFamilies(withoutLatent, config));
    const [linux, windows, gated] = withLatent;
    for (const [index, inventory] of withLatent.entries()) {
      expect(inventory.names).toEqual(withoutLatentInventories[index].names);
    }
    const m365Names = TOOL_PREPARATION_MANIFEST.filter((row) => row.toolName.startsWith("m365_")).map((row) => row.toolName);

    expect(linux.names).not.toContain("powershell");
    expect(windows.names).toContain("powershell");
    expect(m365Names.every((name) => !linux.names.includes(name))).toBeTrue();
    expect(m365Names.every((name) => !windows.names.includes(name))).toBeTrue();
    expect(m365Names.every((name) => gated.names.includes(name))).toBeTrue();
    expect(linux.unresolvedRegistrations).toEqual([]);
    expect(windows.unresolvedRegistrations).toEqual([]);
    expect(gated.unresolvedRegistrations).toEqual([]);
  }, 15_000);
});
