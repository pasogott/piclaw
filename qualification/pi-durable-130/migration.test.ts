import "./src/test-guard.js";
import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SessionManager as LegacyManager } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { CompactionEntry, SystemEntry, defineDoc, type Conversation, type EntryId, type EntryDraft, type ConversationId } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { BunSqliteDatabase } from "./src/bun-sqlite.js";
import { context, openFixture } from "./src/fixture.js";

// Resolve ONLY the public current SDK export from root dependencies, never its internals.
// The current package has an import-only export; createRequire.resolve cannot resolve it.
const legacy = await import("@earendil-works/pi-coding-agent");
const { SessionManager, convertToLlm, buildSessionContext, sessionEntryToContextMessages } = legacy;
type Fixture = Awaited<ReturnType<typeof openFixture>>;
type ObjectValue = Record<string, unknown>;
function object(value: unknown): asserts value is ObjectValue {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "object required");
}
function keys(value: ObjectValue, allowed: string[]) {
  assert(Object.keys(value).every(key => allowed.includes(key)), "unsupported fields");
}
function strings(value: ObjectValue, names: string[]) {
  assert(names.every(name => typeof value[name] === "string"), "string required");
}
function finite(value: unknown) { assert(typeof value === "number" && Number.isFinite(value), "number required"); }
function blocks(content: unknown, assistant = false) {
  assert(Array.isArray(content), "content array required");
  for (const block of content) {
    object(block);
    if (block.type === "text") {
      keys(block, ["type", "text", "textSignature"]); strings(block, ["text"]);
      if (block.textSignature !== undefined) strings(block, ["textSignature"]);
    } else if (block.type === "image" && !assistant) {
      keys(block, ["type", "data", "mimeType"]); strings(block, ["data", "mimeType"]);
    } else if (block.type === "toolCall" && assistant) {
      keys(block, ["type", "id", "name", "arguments"]); strings(block, ["id", "name"]); object(block.arguments);
    } else assert.fail("unsupported content block");
  }
}
// Narrow qualification schema, deliberately NOT a blanket legacy-message cast.
function message(value: unknown): asserts value is Message {
  object(value); finite(value.timestamp);
  if (value.role === "user") {
    keys(value, ["role", "content", "timestamp"]);
    if (typeof value.content !== "string") blocks(value.content);
  } else if (value.role === "assistant") {
    keys(value, ["role", "content", "api", "provider", "model", "usage", "stopReason", "timestamp"]);
    strings(value, ["api", "provider", "model"]); blocks(value.content, true);
    assert(["stop", "length", "toolUse"].includes(String(value.stopReason)), "unfinished/cancelled assistant");
    object(value.usage); keys(value.usage, ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cost"]);
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) finite(value.usage[key]);
    object(value.usage.cost); keys(value.usage.cost, ["input", "output", "cacheRead", "cacheWrite", "total"]);
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) finite(value.usage.cost[key]);
  } else if (value.role === "toolResult") {
    keys(value, ["role", "toolCallId", "toolName", "content", "isError", "timestamp", "details"]);
    strings(value, ["toolCallId", "toolName"]); blocks(value.content); assert(typeof value.isError === "boolean");
  } else assert.fail("unsupported message role (including system baseline)");
}

type LegacyHistory = { chatJid: string; branchId: string; metadataRef: string; requestId: string; jsonl: string };
type Mapping = { sourceEntryId: string; durableEntryId: number };
type Manifest = { binding: null | { schemaVersion: number; sourceHash: string; chatJid: string; branchId: string;
  metadataRef: string; requestId: string; sourceSessionId: string; engineConversationId: number; entries: Mapping[] } };
const ImportManifest = defineDoc<Manifest>({ kind: "app.legacy-import", version: 1, scope: "conversation",
  history: "latest", fork: "initial", initial: () => ({ binding: null }) });

// Bounded H5 test helper only. NO production migration runner or live sessions directory.
function prepare(input: LegacyHistory) {
  for (const key of ["chatJid", "branchId", "metadataRef", "requestId"] as const) assert(input[key].length > 0);
  // Strict parsing: current SDK parseSessionEntries intentionally skips malformed lines, unacceptable here.
  const [header, ...entries]: unknown[] = input.jsonl.trim().split("\n").map(line => JSON.parse(line));
  object(header); keys(header, ["type", "version", "id", "timestamp", "cwd"]);
  assert(header.type === "session" && header.version === 3); strings(header, ["id", "timestamp", "cwd"]);
  assert(entries.length > 0 && entries.length <= 10, "bounded fixture only (1..10 records)");
  let parent: string | null = null;
  const ids = new Set<string>(), calls = new Set<string>();
  const pending: { id: string; name: string }[] = [];
  const drafts: EntryDraft[] = [];
  for (const entry of entries) {
    object(entry); strings(entry, ["type", "id", "timestamp"]);
    assert(Number.isFinite(Date.parse(entry.timestamp as string)), "invalid timestamp");
    assert(!ids.has(entry.id as string) && entry.parentId === parent, "non-contiguous branch/duplicate ID");
    parent = entry.id as string; ids.add(parent);
    let model: Message[] | undefined;
    if (entry.type === "message") {
      keys(entry, ["type", "id", "parentId", "timestamp", "message"]); message(entry.message);
      const msg = entry.message;
      if (msg.role === "toolResult") {
        const call = pending.shift();
        assert(call && call.id === msg.toolCallId && call.name === msg.toolName, "orphan/out-of-order tool result");
      } else {
        assert(pending.length === 0, "inflight tools");
        if (msg.role === "assistant") {
          for (const call of msg.content) if (call.type === "toolCall") {
            assert(!calls.has(call.id), "duplicate tool call"); calls.add(call.id); pending.push({ id: call.id, name: call.name });
          }
          assert((msg.stopReason === "toolUse") === (pending.length > 0), "inconsistent tool stop reason");
        }
      }
      model = [msg];
    } else if (entry.type === "custom") {
      keys(entry, ["type", "id", "parentId", "timestamp", "customType", "data"]);
      strings(entry, ["customType"]);
      assert(entry.customType === "qualification.display", "unsupported extension state");
    } else assert.fail(`unsupported record: ${entry.type}`);
    // Raw JSON retained exactly; host source IDs are metadata, never durable record IDs.
    drafts.push({ kind: "app.legacy", data: JSON.parse(JSON.stringify(entry)), ...(model ? { model } : {}) });
  }
  assert(pending.length === 0, "inflight tools");
  return { drafts, sourceSessionId: header.id as string,
    sourceHash: createHash("sha256").update(JSON.stringify({ chatJid: input.chatJid, branchId: input.branchId,
      metadataRef: input.metadataRef, requestId: input.requestId, jsonl: input.jsonl })).digest("hex") };
}
async function importCopied(f: Fixture, input: LegacyHistory, interruptedAfter?: number, conversationId: ConversationId = f.root.id) {
  const prepared = prepare(input); // Reject whole affected scope BEFORE any write.
  return f.root.commit(async tx => {
    const doc = await tx.doc(ImportManifest, conversationId);
    if (doc.binding) {
      assert(doc.binding.sourceHash === prepared.sourceHash, "import binding/content conflict");
      return JSON.parse(JSON.stringify(doc.binding)) as NonNullable<Manifest["binding"]>;
    }
    assert((await tx.scanEntries({ conversationId }, 1)).items.length === 0, "target must be empty");
    const entries: Mapping[] = [];
    for (const draft of prepared.drafts) {
      const appended = await tx.appendEntry(conversationId, draft);
      const raw = draft.data as { id: string };
      entries.push({ sourceEntryId: raw.id, durableEntryId: appended.id });
      if (entries.length === interruptedAfter) throw new Error("synthetic interrupted commit");
    }
    const binding = { schemaVersion: 1, sourceHash: prepared.sourceHash, chatJid: input.chatJid, branchId: input.branchId,
      metadataRef: input.metadataRef, requestId: input.requestId, sourceSessionId: prepared.sourceSessionId,
      engineConversationId: conversationId, entries };
    doc.binding = binding;
    return binding;
  }, context);
}
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function assistant(tool = false): Parameters<LegacyManager["appendMessage"]>[0] {
  return { role: "assistant", api: "openai-completions", provider: "qualification", model: "synthetic", usage,
    stopReason: tool ? "toolUse" : "stop", timestamp: 1001,
    content: tool ? [{ type: "toolCall", id: "copied-call", name: "host_effect", arguments: { value: "synthetic" } }]
      : [{ type: "text", text: "Completed historical answer", textSignature: "opaque-synthetic-signature" }] };
}
function copied(manager: LegacyManager): LegacyHistory {
  // Same serializer as the current SDK JSONL writer: one JSON record per line.
  return { chatJid: "web:existing-synthetic-chat", branchId: "existing-main", metadataRef: "synthetic:host-metadata/1",
    requestId: "legacy-import:existing-main:v1", jsonl: [manager.getHeader(), ...manager.getEntries()].map(x => JSON.stringify(x)).join("\n") + "\n" };
}
function representative() {
  const manager = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!, { id: "qualification-existing-session" });
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "Existing attachment" },
    { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }], timestamp: 1000 });
  manager.appendMessage(assistant(true));
  manager.appendMessage({ role: "toolResult", toolCallId: "copied-call", toolName: "host_effect",
    content: [{ type: "text", text: "historically completed" }], details: { reference: "synthetic:completed/1" }, isError: false, timestamp: 1002 });
  manager.appendCustomEntry("qualification.display", { text: "Existing display-only metadata", attachmentRef: "synthetic:attachment/1" });
  manager.appendMessage(assistant());
  return manager;
}
async function using(run: (f: Fixture) => Promise<void>) {
  const f = await openFixture({ acquired: true });
  try { await run(f); } finally { await f.close(); }
}
async function empty(f: Fixture) {
  expect((await f.root.entries({}, 100, undefined, context)).items).toEqual([]);
  expect(await f.harness.snapshot(ImportManifest, f.root.id, context)).toBeUndefined();
  expect(f.host.modelCalls).toBe(0); expect(f.host.effects).toBe(0);
}

describe("H5 bounded copied existing-history qualification (not production migration)", () => {
  test("current public SDK is 1.2.0; 5 copied records retain IDs, attachments, exact context and execute nothing", () => using(async f => {
    const pkg = await Bun.file(new URL("../../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url)).json();
    expect(pkg.version).toBe("1.2.0");
    expect(import.meta.resolve("@earendil-works/pi-coding-agent")).toBe(new URL(
      "../../node_modules/@earendil-works/pi-coding-agent/dist/index.js", import.meta.url).href);
    const manager = representative(), input = copied(manager), original = input.jsonl;
    const restored = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!, undefined, input.jsonl.trim().split("\n").map(line => JSON.parse(line)));
    expect(restored.buildSessionContext()).toEqual(manager.buildSessionContext());
    const manifest = await importCopied(f, input);
    const view = await f.root.context(context);
    expect(view.messages).toEqual(JSON.parse(JSON.stringify(convertToLlm(manager.buildSessionContext().messages))));
    expect(view.entries.map(e => e.data)).toEqual(JSON.parse(JSON.stringify(manager.getEntries())));
    expect(manifest.entries.map(e => e.sourceEntryId)).toEqual(manager.getEntries().map(e => e.id));
    expect(manifest.entries.every(e => typeof e.durableEntryId === "number")).toBe(true);
    expect(manifest.chatJid).toBe(input.chatJid); expect(manifest.engineConversationId).toBe(f.root.id);
    expect(await Promise.all([importCopied(f, input), importCopied(f, input)])).toEqual([manifest, manifest]);
    for (const key of ["chatJid", "branchId", "metadataRef", "requestId"] as const) {
      await expect(importCopied(f, { ...input, [key]: "changed-binding" })).rejects.toThrow("content conflict");
    }
    expect((await f.root.entries({}, 100, undefined, context)).items).toHaveLength(5);
    await expect(importCopied(f, { ...input, jsonl: input.jsonl.replace("Existing attachment", "changed") })).rejects.toThrow("content conflict");
    expect(input.jsonl).toBe(original);
    expect(await f.harness.inspect(context)).toEqual({ scheduling: "paused", tasks: [], submissions: [] });
    expect(f.host.effects).toBe(0); expect(f.host.modelCalls).toBe(0); expect(f.host.credentialLookups).toBe(0);
  }));
  test("callback interruption rolls back transcript AND manifest; retry has no duplicates", () => using(async f => {
    const input = copied(representative());
    await expect(importCopied(f, input, 3)).rejects.toThrow("interrupted commit");
    await empty(f);
    const manifest = await importCopied(f, input);
    expect(await importCopied(f, input)).toEqual(manifest);
    expect((await f.root.context(context)).entries).toHaveLength(5);
  }));
  test("SQLite close/reopen keeps identity mapping and lost acknowledgement replay idempotent", async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "legacy-copy-"));
    const path = join(dir, "candidate.sqlite");
    const open = () => openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path)));
    let f = await open();
    try {
      const input = copied(representative());
      await expect(importCopied(f, input, 3)).rejects.toThrow("interrupted commit");
      await f.close(); f = await open();
      await empty(f);
      const receipt = await importCopied(f, input);
      await f.close(); f = await open();
      expect(await importCopied(f, input)).toEqual(receipt);
      expect((await f.root.context(context)).entries).toHaveLength(5);
      expect(f.host.effects).toBe(0); expect(f.host.modelCalls).toBe(0);
    } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
  });
  for (const state of ["pending", "aborted", "error", "deferred"] as const) {
    test(`reject ${state} assistant before writing, never replay`, () => using(async f => {
      const input = copied(representative());
      input.jsonl = input.jsonl.replace('"stopReason":"stop"', `"stopReason":"${state}"`);
      await expect(importCopied(f, input)).rejects.toThrow("unfinished/cancelled"); await empty(f);
    }));
  }
  for (const variant of ["inflight", "orphan", "unknown-block", "malformed", "unknown-record", "bound", "duplicate"] as const) {
    test(`reject ${variant} whole scope without truncation`, () => using(async f => {
      const input = copied(representative());
      const records = input.jsonl.trim().split("\n").map(line => JSON.parse(line));
      if (variant === "inflight") records.splice(3);
      if (variant === "orphan") records[3].message.toolCallId = "no-such-call";
      if (variant === "unknown-block") records[1].message.content.push({ type: "inference", data: "unsupported" });
      if (variant === "unknown-record") records[4].type = "future-record";
      if (variant === "bound") while (records.length <= 11) records.push(records.at(-1));
      if (variant === "duplicate") records[4].id = records[1].id;
      input.jsonl = records.map(x => JSON.stringify(x)).join("\n") + (variant === "malformed" ? "\n{broken" : "");
      await expect(importCopied(f, input)).rejects.toThrow(); await empty(f);
    }));
  }
  for (const gap of ["system", "compaction", "deep-branch", "context-edit", "custom-message", "extension-state"] as const) {
    test(`NOT QUALIFIED: ${gap} explicitly rejected; unrelated conversation remains usable`, () => using(async f => {
      const manager = representative();
      if (gap === "system") manager.appendMessage({ role: "system", content: "baseline", timestamp: 1003 });
      if (gap === "compaction") manager.appendCompaction("Existing custom summary, NOT regenerated", manager.getEntries()[3]!.id, 500, { custom: true }, true);
      if (gap === "deep-branch") { manager.branch(manager.getEntries()[1]!.id); manager.appendMessage(assistant()); }
      if (gap === "context-edit") manager.appendContextEdit(manager.getEntries()[0]!.id, null);
      if (gap === "custom-message") manager.appendCustomMessageEntry("injected", "existing context", true);
      if (gap === "extension-state") manager.appendCustomEntry("unknown-extension", { enabled: true });
      await expect(importCopied(f, copied(manager))).rejects.toThrow(); await empty(f);
      const other = await f.harness.createConversation({ ownership: { kind: "ownerless" } }, context);
      await importCopied(f, { ...copied(representative()), chatJid: "web:other-existing-chat" }, undefined, other.id);
      expect((await other.context(context)).entries).toHaveLength(5);
      expect((await f.root.context(context)).entries).toHaveLength(0);
    }));
  }
});

// Independent advanced fixture lane. The original fail-closed importer above is unchanged.
// Public Pi120 generates the JSONL; a temporary copy is reloaded through its public reader.
// This is a <=10-record, selected-path experiment, NOT a tree importer or migration runner.
type AdvancedBinding = { chatJid: string; branchId: string; sourceSessionId: string;
  engineConversationId: number; sourceLeafId: string | null; sourceHash: string;
  topology: { id: string; parentId: string | null }[]; entries: Mapping[] };
const AdvancedManifest = defineDoc<{ binding: AdvancedBinding | null }>({ kind: "app.advanced-import", version: 1,
  scope: "conversation", history: "latest", fork: "initial", initial: () => ({ binding: null }) });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function advancedFixture(compact = false) {
  const manager = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!, { id: "qualification-advanced" });
  manager.appendMessage({ role: "system", content: "Known original synthetic baseline", timestamp: 2000 });
  manager.appendMessage({ role: "user", content: "Original question", timestamp: 2001 });
  manager.appendMessage(assistant());
  if (compact) manager.appendCompaction("EXACT supplied summary: retain this punctuation!", manager.getEntries()[1]!.id,
    123, { original: "qualification-only" }, true);
  manager.appendMessage({ role: "user", content: "After checkpoint", timestamp: 2002 });
  return manager;
}
async function copiedAdvanced(manager: LegacyManager, run: (copy: LegacyManager, jsonl: string) => Promise<void>) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "advanced-copy-"));
  try {
    const path = join(dir, "synthetic.jsonl"), text = copied(manager).jsonl;
    await Bun.write(path, text);
    const opened = SessionManager.open(path, dir);
    expect(opened.buildSessionContext()).toEqual(manager.buildSessionContext());
    // Mutate only a detached public in-memory copy when generating branch continuations.
    const copy = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!, undefined,
      [opened.getHeader()!, ...opened.getEntries()]);
    await run(copy, text);
    expect(await Bun.file(path).text()).toBe(text);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function appendAdvanced(f: Fixture, manager: LegacyManager, text: string, branchId: string,
  conversation: Conversation = f.root, selected = manager.getBranch(), inherited = new Map<string, EntryId>()) {
  assert(manager.getEntries().length <= 10, "advanced fixture bound, not a production limit");
  // Validate entire selected batch before writing; never silently flatten an unsupported record.
  for (const entry of selected) {
    assert(entry.type === "message" || entry.type === "compaction", `advanced unsupported: ${entry.type}`);
    if (entry.type === "message") {
      if (entry.message.role === "system") {
        assert(typeof entry.message.content === "string", "only known string baseline qualified");
      } else message(entry.message);
    }
  }
  const pathIds = new Set(manager.getBranch().map(e => e.id));
  const mapping = new Map([...inherited].filter(([id]) => pathIds.has(id)));
  await conversation.commit(async tx => {
    for (const entry of selected) {
      // Raw source identity/topology are audit data, not engine IDs and not duplicate model messages.
      const audit = await tx.appendEntry(conversation.id, { kind: "app.advanced-source", data: JSON.parse(JSON.stringify(entry)) });
      let at = audit.id;
      if (entry.type === "message") {
        const model = json(convertToLlm(sessionEntryToContextMessages(entry)));
        const record = entry.message.role === "system"
          ? await tx.appendEntry(SystemEntry, conversation.id, { model })
          : await tx.appendEntry(conversation.id, { kind: "app.advanced-message", model });
        at = record.id;
      } else if (entry.type === "compaction") {
        const kept = mapping.get(entry.firstKeptEntryId);
        assert(kept, "first kept entry must be mapped on this path");
        const projected = json(convertToLlm(sessionEntryToContextMessages(entry)));
        const record = await tx.appendEntry(CompactionEntry, conversation.id, {
          head: kept, data: { reason: "manual" }, model: projected.filter(m => m.role !== "system"),
        });
        at = record.id;
        // Real positional baseline AFTER head; it is taken only from the original compaction checkpoint.
        const baseline = projected.filter(m => m.role === "system");
        if (baseline.length) at = (await tx.appendEntry(SystemEntry, conversation.id, { model: baseline })).id;
      }
      mapping.set(entry.id, at);
    }
    const doc = await tx.doc(AdvancedManifest, conversation.id);
    doc.binding = { chatJid: "web:advanced-synthetic", branchId, sourceSessionId: manager.getSessionId(),
      engineConversationId: conversation.id, sourceLeafId: manager.getLeafId(),
      sourceHash: createHash("sha256").update(text).digest("hex"),
      topology: manager.getEntries().map(e => ({ id: e.id, parentId: e.parentId })),
      entries: [...mapping].map(([sourceEntryId, durableEntryId]) => ({ sourceEntryId, durableEntryId })) };
  }, context);
  return mapping;
}
async function equivalent(f: Fixture, manager: LegacyManager, conversation: Conversation = f.root) {
  const original = buildSessionContext(manager.getEntries(), manager.getLeafId());
  expect(original).toEqual(manager.buildSessionContext());
  const view = await conversation.context(context);
  expect(view.messages).toEqual(json(convertToLlm(original.messages)));
  expect(view.messages.filter(m => m.role === "system")).toHaveLength(1);
  expect(f.host.modelCalls).toBe(0); expect(f.host.effects).toBe(0); expect(f.host.credentialLookups).toBe(0);
  const inspection = await f.harness.inspect(context);
  expect(inspection.tasks).toEqual([]); expect(inspection.submissions).toEqual([]);
}

describe("H5 advanced actual public context qualification, independent of rejected legacy importer", () => {
  test("known original system baseline: copied JSONL and actual durable model context, no double messages", () => using(async f => {
    await copiedAdvanced(advancedFixture(), async (manager, text) => {
      await appendAdvanced(f, manager, text, "original-main"); await equivalent(f, manager);
      expect((await f.root.context(context)).messages).toHaveLength(4);
    });
  }));
  test("compaction: exact provided summary and checkpoint baseline precede retained history", () => using(async f => {
    await copiedAdvanced(advancedFixture(true), async (manager, text) => {
      await appendAdvanced(f, manager, text, "original-compacted"); await equivalent(f, manager);
      const view = await f.root.context(context);
      expect(view.head?.kind).toBe(CompactionEntry.kind);
      expect(JSON.stringify(view.messages)).toContain("EXACT supplied summary: retain this punctuation!");
      const audit = (await f.root.entries({ order: "ascending" }, 100, undefined, context)).items
        .filter(e => e.kind === "app.advanced-source").map(e => e.data);
      expect(audit).toEqual(JSON.parse(JSON.stringify(manager.getEntries())));
    });
  }));
  test("two public forks at original entries derive distinct branch contexts and typed host identities", () => using(async f => {
    const source = advancedFixture(true);
    await copiedAdvanced(source, async (manager, text) => {
      const mapping = await appendAdvanced(f, manager, text, "host-main");
      const mainContext = json((await f.root.context(context)).messages);
      for (const [index, branchId] of [[1, "host-before-compaction"], [3, "host-after-compaction"]] as const) {
        const sourceAt = manager.getEntries()[index]!;
        const at = mapping.get(sourceAt.id)!;
        const fork = await f.root.fork(at, { ownership: { kind: "ownerless" } }, context);
        manager.branch(sourceAt.id);
        expect((await fork.context(context)).messages).toEqual(json(convertToLlm(manager.buildSessionContext().messages)));
        const id = manager.appendMessage({ role: "user", content: branchId, timestamp: 2003 });
        await appendAdvanced(f, manager, copied(manager).jsonl, branchId, fork, [manager.getEntry(id)!], mapping);
        await equivalent(f, manager, fork);
        const binding = (await f.harness.snapshot(AdvancedManifest, fork.id, context))!.binding!;
        expect(binding.branchId).toBe(branchId); expect(binding.engineConversationId).toBe(fork.id);
        expect(binding.entries.map(e => e.sourceEntryId)).toEqual(manager.getBranch().map(e => e.id));
        expect(binding.topology).toEqual(manager.getEntries().map(e => ({ id: e.id, parentId: e.parentId })));
      }
      expect((await f.root.context(context)).messages).toEqual(mainContext);
      expect((await f.harness.snapshot(AdvancedManifest, f.root.id, context))!.binding!.branchId).toBe("host-main");
    });
  }));
  test("public reset removes prior system baseline; known replacement baseline is not inferred", () => using(async f => {
    const manager = advancedFixture();
    await appendAdvanced(f, manager, copied(manager).jsonl, "before-reset");
    await f.root.reset(undefined, context);
    expect((await f.root.context(context)).messages).toEqual([]);
    const replacement = advancedFixture();
    await appendAdvanced(f, replacement, copied(replacement).jsonl, "explicit-after-reset");
    await equivalent(f, replacement);
  }));
  test("SQLite reopened compaction retains actual context and typed manifest", async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "advanced-sqlite-"));
    const open = () => openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(join(dir, "copy.sqlite"))));
    let f = await open();
    try {
      const manager = advancedFixture(true);
      await appendAdvanced(f, manager, copied(manager).jsonl, "sqlite-original");
      const binding = await f.harness.snapshot(AdvancedManifest, f.root.id, context);
      await f.close(); f = await open();
      await equivalent(f, manager);
      expect(await f.harness.snapshot(AdvancedManifest, f.root.id, context)).toEqual(binding);
    } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
  });
  test("BLOCKED: missing host-only baseline cannot be recovered from JSONL; no invented system context", () => using(async f => {
    const manager = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!);
    manager.appendMessage({ role: "user", content: "No persisted system baseline", timestamp: 2000 });
    const knownHostBaseline = { source: "explicit synthetic host fixture, not JSONL", systemPrompt: "External host instructions" };
    expect(manager.buildSessionContext().messages.some(m => m.role === "system")).toBe(false);
    await appendAdvanced(f, manager, copied(manager).jsonl, "missing-host-baseline");
    const view = await f.root.context(context);
    expect(view.messages).toEqual(json(convertToLlm(manager.buildSessionContext().messages)));
    expect(JSON.stringify(view.messages)).not.toContain(knownHostBaseline.systemPrompt);
    // Exact JSONL-only equality is NOT full host/model-context qualification in this case.
    expect(view.messages.some(m => m.role === "system")).toBe(false);
  }));
});
