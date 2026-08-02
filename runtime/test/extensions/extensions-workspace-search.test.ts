/**
 * test/extensions/extensions-workspace-search.test.ts – Tests for the workspace-search extension.
 *
 * Verifies search_workspace tool indexes workspace files and returns
 * matching results with correct scope filtering and pagination.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import fs from "node:fs/promises";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { initDatabase } from "../../src/db.js";
import { withChatContext } from "../../src/core/chat-context.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";

describe("workspace-search extension", () => {
  let ws: ReturnType<typeof createTempWorkspace>;
  let restoreEnv: (() => void) | null = null;

  beforeEach(() => {
    ws = createTempWorkspace("piclaw-workspace-search-");
    restoreEnv = setEnv({
      PICLAW_WORKSPACE: ws.workspace,
      PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data,
    });
    initDatabase();
  });

  afterEach(() => {
    restoreEnv?.();
    restoreEnv = null;
    ws.cleanup();
  });

  async function seedWorkspace() {
    const notesDir = path.join(ws.workspace, "notes");
    const skillsDir = path.join(ws.workspace, ".pi", "skills", "demo");
    await fs.mkdir(notesDir, { recursive: true });
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(notesDir, "alpha.md"), "Alpha note about kittens.");
    await fs.writeFile(path.join(skillsDir, "SKILL.md"), "Demo skill that mentions kittens and puppies.");
  }

  async function getSearchExtension() {
    const { workspaceSearch } = await import(`../../src/extensions/workspace-search.js?t=${Date.now()}-${Math.random().toString(36).slice(2)}`) as typeof import("../../src/extensions/workspace-search.js");
    const fake = createFakeExtensionApi();
    workspaceSearch(fake.api);
    return fake;
  }

  async function getSearchTool() {
    const fake = await getSearchExtension();
    return fake.tools.get("search_workspace")!;
  }

  async function executeWithContext(tool: any, params: Record<string, unknown>) {
    return withChatContext("web:test", "web", () => tool.execute("c1", params));
  }

  test("registers search_workspace tool", async () => {
    const fake = await getSearchExtension();
    const tool = fake.tools.get("search_workspace");
    const refreshTool = fake.tools.get("refresh_workspace_index");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("search_workspace");
    expect(refreshTool?.name).toBe("refresh_workspace_index");
  });

  test("does not register a blocking session_start indexing hook", async () => {
    await seedWorkspace();
    const fake = await getSearchExtension();
    const sessionStart = fake.handlers.find((entry) => entry.event === "session_start");
    expect(sessionStart).toBeUndefined();
  });

  test("indexes notes + skills and returns matches", async () => {
    await seedWorkspace();
    const tool = await getSearchTool();
    const result = await executeWithContext(tool, { query: "kittens", refresh: true });
    expect(result.details.count).toBe(2);
    expect(result.content[0].text).toContain("notes/alpha.md");
    expect(result.content[0].text).toContain(".pi/skills/demo/SKILL.md");
  });

  test("handles dotted, metric, hyphenated, and path identifiers plus scoped LIKE fallback", async () => {
    const notesDir = path.join(ws.workspace, "notes");
    const skillsDir = path.join(ws.workspace, ".pi", "skills", "demo");
    await fs.mkdir(notesDir, { recursive: true });
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(
      path.join(notesDir, "infra.md"),
      [
        "Host sigma.local sends graphite through telegraf.",
        "Metric hosts.orangepi6plus.cpu.usage_idle stayed high.",
        "Package pi-side-agents referenced workspace/tmp/files.",
      ].join("\n"),
    );
    await fs.writeFile(path.join(skillsDir, "SKILL.md"), "Skill notes also mention sigma.local but should not match notes-only fallback scope.");

    const tool = await getSearchTool();
    await executeWithContext(tool, { query: "sigma.local", refresh: true, scope: "notes" });

    for (const query of [
      "sigma.local",
      "sigma.local sigma telegraf graphite",
      "hosts.orangepi6plus.cpu.usage_idle",
      "pi-side-agents",
      "workspace/tmp/files",
      "sigma.local AND",
    ]) {
      const result = await executeWithContext(tool, { query, scope: "notes" });
      expect(result.details.count).toBe(1);
      expect(result.details.results[0].path).toBe("notes/infra.md");
      expect(result.content[0].text).toContain("notes/infra.md");
      expect(result.content[0].text).not.toContain(".pi/skills/demo/SKILL.md");
    }
  });

  test("search_workspace does not block on indexing by default", async () => {
    await seedWorkspace();
    const workspaceSearchMod = await import("../../src/workspace-search.js") as typeof import("../../src/workspace-search.js");
    const requests: Array<{ scope?: string; max_kb?: number }> = [];
    workspaceSearchMod.setBackgroundWorkspaceIndexRefreshRequesterForTests((params) => {
      requests.push({ scope: params?.scope as string | undefined, max_kb: params?.max_kb });
    });

    try {
      const tool = await getSearchTool();
      const result = await executeWithContext(tool, { query: "kittens", scope: "notes" });
      expect(result.details.count).toBe(0);
      expect(requests).toEqual([{ scope: "notes", max_kb: undefined }]);
    } finally {
      workspaceSearchMod.setBackgroundWorkspaceIndexRefreshRequesterForTests(null);
    }
  });

  test("scope filters to notes or skills", async () => {
    await seedWorkspace();
    const tool = await getSearchTool();

    const notesOnly = await executeWithContext(tool, { query: "kittens", scope: "notes", refresh: true });
    expect(notesOnly.details.count).toBe(1);
    expect(notesOnly.content[0].text).toContain("notes/alpha.md");

    const skillsOnly = await executeWithContext(tool, { query: "kittens", scope: "skills", refresh: true });
    expect(skillsOnly.details.count).toBe(1);
    expect(skillsOnly.content[0].text).toContain(".pi/skills/demo/SKILL.md");
  });

  test("aggressively cleans up deleted files", async () => {
    await seedWorkspace();
    const tool = await getSearchTool();
    const first = await executeWithContext(tool, { query: "kittens", refresh: true });
    expect(first.details.count).toBe(2);

    await fs.rm(path.join(ws.workspace, "notes", "alpha.md"));
    const second = await executeWithContext(tool, { query: "kittens", refresh: true, scope: "notes" });
    expect(second.details.count).toBe(0);
  });

  test("skips oversized files and removes stale entries", async () => {
    const notesDir = path.join(ws.workspace, "notes");
    await fs.mkdir(notesDir, { recursive: true });
    const bigContent = "x".repeat(40 * 1024);
    await fs.writeFile(path.join(notesDir, "big.md"), bigContent);

    const tool = await getSearchTool();
    const first = await executeWithContext(tool, { query: "x", refresh: true, max_kb: 10 });
    expect(first.details.count).toBe(0);

    const smallContent = "tiny kittens";
    await fs.writeFile(path.join(notesDir, "big.md"), smallContent);
    const second = await executeWithContext(tool, { query: "kittens", refresh: true, max_kb: 10 });
    expect(second.details.count).toBe(1);
    expect(second.content[0].text).toContain("notes/big.md");
  });

  test("paginates results with offset", async () => {
    const notesDir = path.join(ws.workspace, "notes");
    await fs.mkdir(notesDir, { recursive: true });
    await fs.writeFile(path.join(notesDir, "first.md"), "kittens kittens kittens kittens kittens");
    await fs.writeFile(path.join(notesDir, "second.md"), "kittens kittens kittens");
    await fs.writeFile(path.join(notesDir, "third.md"), "kittens");

    const tool = await getSearchTool();
    const first = await executeWithContext(tool, { query: "kittens", refresh: true, limit: 1, offset: 0 });
    const second = await executeWithContext(tool, { query: "kittens", refresh: false, limit: 1, offset: 1 });

    expect(first.details.count).toBe(1);
    expect(second.details.count).toBe(1);
    expect(second.details.results[0].path).not.toBe(first.details.results[0].path);
  });

  test("respects configured FTS roots", async () => {
    const docsDir = path.join(ws.workspace, "docs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, "guide.md"), "custom root token");
    const restore = setEnv({ PICLAW_WORKSPACE_SEARCH_ROOTS: "docs" });

    try {
      const tool = await getSearchTool();
      const result = await executeWithContext(tool, { query: "token", refresh: true, scope: "all" });
      expect(result.details.count).toBe(1);
      expect(result.content[0].text).toContain("docs/guide.md");
    } finally {
      restore();
    }
  });

  test("refresh indexes large file sets", async () => {
    const notesDir = path.join(ws.workspace, "notes");
    await fs.mkdir(notesDir, { recursive: true });

    const tool = await getSearchTool();
    await fs.writeFile(path.join(notesDir, "seed.md"), "kittens seed");
    await executeWithContext(tool, { query: "kittens", refresh: true });

    const files = Array.from({ length: 60 }, (_, i) => `file-${i}.md`);
    await Promise.all(
      files.map((file, i) => fs.writeFile(path.join(notesDir, file), `kittens batch ${i}`))
    );

    const result = await executeWithContext(tool, { query: "batch", refresh: true, limit: 50 });
    expect(result.details.count).toBe(50);
    expect(result.content[0].text).toContain("notes/file-");
  });

  test("indexes extra file extensions from config", async () => {
    const notesDir = path.join(ws.workspace, "notes");
    await fs.mkdir(notesDir, { recursive: true });

    // .csv is now in DEFAULT_EXTS, so it should be indexed without extra config
    await fs.writeFile(path.join(notesDir, "data.csv"), "name,value\nkittens,42");
    // .vtt is not in defaults — needs PICLAW_WORKSPACE_SEARCH_EXTENSIONS
    await fs.writeFile(path.join(notesDir, "transcript.vtt"), "WEBVTT\n\n00:00.000 --> 00:01.000\nkittens are cute");

    // Without extra config, csv is found but vtt is not
    const tool = await getSearchTool();
    const csvResult = await executeWithContext(tool, { query: "kittens", refresh: true, scope: "all" });
    expect(csvResult.content[0].text).toContain("data.csv");
    expect(csvResult.content[0].text).not.toContain("transcript.vtt");

    // With extra extensions configured, vtt is also found
    const restore = setEnv({ PICLAW_WORKSPACE_SEARCH_EXTENSIONS: ".vtt" });
    try {
      const { workspaceSearch } = await import(`../../src/extensions/workspace-search.js?t=${Date.now()}-${Math.random().toString(36).slice(2)}`) as typeof import("../../src/extensions/workspace-search.js");
      const fake = createFakeExtensionApi();
      workspaceSearch(fake.api);
      const searchTool = fake.tools.get("search_workspace");
      const vttResult = await executeWithContext(searchTool, { query: "kittens", refresh: true, scope: "all" });
      expect(vttResult.content[0].text).toContain("transcript.vtt");
    } finally {
      restore();
    }
  });
});
