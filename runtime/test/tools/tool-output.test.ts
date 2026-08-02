/**
 * test/tools/tool-output.test.ts – Tests for tool output persistence.
 *
 * Verifies writeToolOutput() stores files to disk and records metadata
 * in the database, and that outputs are retrievable by ID.
 */

import { expect, test, afterEach } from "bun:test";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { getTestWorkspace, setEnv } from "../helpers.js";

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

test("save and search tool output", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const toolOutput = await import("../../src/tool-output.js");
  const text = "hello world\nthis is a test\nsearchable content";
  const saved = toolOutput.saveToolOutput(text, { source: "test" });

  expect(existsSync(saved.path)).toBe(true);
  expect(saved.path).toMatch(/tool-output\/\d{4}-\d{2}\/\d{2}\/out[-_]/);
  expect(saved.lineCount).toBe(3);

  const snippets = toolOutput.searchToolOutput(saved.id, "searchable", 5);
  expect(snippets.length).toBeGreaterThan(0);

  const none = toolOutput.searchToolOutput(saved.id, "missingword", 5);
  expect(none.length).toBe(0);

  const empty = toolOutput.searchToolOutput(saved.id, "", 5);
  expect(empty.length).toBe(0);
});

test("searchToolOutput handles dotted, metric, hyphenated, and path identifiers", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const toolOutput = await import("../../src/tool-output.js");
  const saved = toolOutput.saveToolOutput([
    "Host sigma.local sends graphite through telegraf.",
    "Metric hosts.orangepi6plus.cpu.usage_idle stayed high under pi-side-agents.",
    "Path referenced: workspace/tmp/files.",
  ].join("\n"), { source: "test" });

  expect(toolOutput.searchToolOutput(saved.id, "sigma.local sigma telegraf graphite", 5).length).toBeGreaterThan(0);
  expect(toolOutput.searchToolOutput(saved.id, "hosts.orangepi6plus.cpu.usage_idle", 5).length).toBeGreaterThan(0);
  expect(toolOutput.searchToolOutput(saved.id, "pi-side-agents", 5).length).toBeGreaterThan(0);
  expect(toolOutput.searchToolOutput(saved.id, "workspace/tmp/files", 5).length).toBeGreaterThan(0);
});

test("saveToolOutput uses createdAt for deterministic date-sharded paths", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const toolOutput = await import("../../src/tool-output.js");
  const saved = toolOutput.saveToolOutput("deterministic output", {
    id: "out_deterministic_path_test",
    createdAt: "2026-03-04T05:06:07.000Z",
  });

  expect(saved.path).toEndWith(join("tool-output", "2026-03", "04", "out_deterministic_path_test.log"));
  expect(readFileSync(saved.path, "utf8")).toBe("deterministic output");
});

test("migrateFlatToolOutputsToDateShards moves legacy flat files and updates DB paths", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const id = "out_flat_migration_test";
  const createdAt = "2026-02-03T04:05:06.000Z";
  const flatPath = join(ws.data, "tool-output", `${id}.log`);
  mkdirSync(dirname(flatPath), { recursive: true });
  writeFileSync(flatPath, "legacy flat output", "utf8");
  db.storeToolOutput({
    id,
    created_at: createdAt,
    source: "test",
    size_bytes: 18,
    line_count: 1,
    summary: "legacy flat output",
    path: flatPath,
  });

  const toolOutput = await import("../../src/tool-output.js");
  expect(toolOutput.migrateFlatToolOutputsToDateShards()).toBeGreaterThanOrEqual(1);

  const migrated = toolOutput.getToolOutput(id)!;
  expect(migrated.path).toEndWith(join("tool-output", "2026-02", "03", `${id}.log`));
  expect(existsSync(flatPath)).toBe(false);
  expect(readFileSync(migrated.path, "utf8")).toBe("legacy flat output");
});

test("prune removes old outputs and their FTS rows", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const toolOutput = await import("../../src/tool-output.js");
  const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  const saved = toolOutput.saveToolOutput("old output with searchable marker", { createdAt: oldDate });
  expect(existsSync(saved.path)).toBe(true);
  expect(toolOutput.searchToolOutput(saved.id, "marker", 5).length).toBeGreaterThan(0);

  const removed = toolOutput.pruneToolOutputs(4 * 60 * 60 * 1000);
  expect(removed).toBeGreaterThan(0);
  expect(existsSync(saved.path)).toBe(false);
  expect(toolOutput.searchToolOutput(saved.id, "marker", 5)).toEqual([]);
});

test("prune keeps compatibility with existing flat tool-output paths", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const id = "out_flat_prune_test";
  const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const flatPath = join(ws.data, "tool-output", `${id}.log`);
  mkdirSync(dirname(flatPath), { recursive: true });
  writeFileSync(flatPath, "old flat output", "utf8");
  db.storeToolOutput({
    id,
    created_at: oldDate,
    source: "test",
    size_bytes: 15,
    line_count: 1,
    summary: "old flat output",
    path: flatPath,
  });

  const toolOutput = await import("../../src/tool-output.js");
  expect(toolOutput.pruneToolOutputs(30 * 24 * 60 * 60 * 1000)).toBeGreaterThanOrEqual(1);
  expect(existsSync(flatPath)).toBe(false);
  expect(toolOutput.getToolOutput(id)).toBeFalsy();
});

test("pruneToolOutputFiles removes old orphaned flat and sharded files", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const toolOutput = await import("../../src/tool-output.js");
  const oldFlat = join(ws.data, "tool-output", "orphan-flat.log");
  const oldSharded = join(ws.data, "tool-output", "2026-01", "01", "orphan-sharded.log");
  const freshOrphan = join(ws.data, "tool-output", "fresh-orphan.log");
  mkdirSync(dirname(oldFlat), { recursive: true });
  mkdirSync(dirname(oldSharded), { recursive: true });
  writeFileSync(oldFlat, "old flat", "utf8");
  writeFileSync(oldSharded, "old sharded", "utf8");
  writeFileSync(freshOrphan, "fresh", "utf8");

  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  utimesSync(oldFlat, old, old);
  utimesSync(oldSharded, old, old);

  expect(toolOutput.pruneToolOutputFiles(30 * 24 * 60 * 60 * 1000)).toBeGreaterThanOrEqual(2);
  expect(existsSync(oldFlat)).toBe(false);
  expect(existsSync(oldSharded)).toBe(false);
  expect(existsSync(freshOrphan)).toBe(true);
  rmSync(freshOrphan, { force: true });
});

test("chunkText hard-splits long lines at the configured chunk size", async () => {
  const toolOutput = await import("../../src/tool-output.js");
  const text = `prefix-${"x".repeat(12)}-suffix`;

  const chunks = toolOutput.chunkText(text, 8);

  expect(chunks).toEqual([
    "prefix-x",
    "xxxxxxxx",
    "xxx-suff",
    "ix",
  ]);
  expect(Math.max(...chunks.map((chunk: string) => chunk.length))).toBe(8);
  expect(chunks.join("")).toBe(text);
});

test("chunkText preserves newline separators, including a trailing newline", async () => {
  const toolOutput = await import("../../src/tool-output.js");
  const text = "alpha\nbeta\n";

  const chunks = toolOutput.chunkText(text, 7);

  expect(chunks).toEqual(["alpha\n", "beta\n"]);
  expect(chunks.join("")).toBe(text);
});
