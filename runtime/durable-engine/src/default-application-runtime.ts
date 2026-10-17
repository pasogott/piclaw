import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { apply } from "@earendil-works/chord/delta";
import { Harness, configure, createRegistry, defineDoc, type ConversationId } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { SettingsManager } from "../../../node_modules/@earendil-works/pi-coding-agent";
import type { RuntimeModelServices } from "../../src/agent-pool/model-services.js";
import type { RuntimeLockHandle } from "../../src/runtime/single-instance.js";
import type { RuntimeBackend } from "../../src/runtime/bootstrap.js";
import { getDb, storeChatMetadata } from "../../src/db.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";
import { DATA_DIR, SESSIONS_DIR, WORKSPACE_DIR } from "../../src/core/config.js";
import { getPiclawAgentDir } from "../../src/core/agent-dir.js";
import { installTerminalSettlementCompositionSchema } from "../../src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { BunSqliteDatabase } from "./bun-sqlite.js";
import { applicationOwnership, createApplicationBootstrapBundle } from "./application-bootstrap.js";
import { createHostModels } from "./host-models.js";
import { createHostBashTool } from "./host-bash.js";

const ApplicationConversations = defineDoc({ kind: "app.application-conversations", version: 1,
  scope: "conversation", history: "latest", fork: "initial", initial: () => ({ version: 1, domain: "", bindings: [] as { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] }) });

type ApplicationMapping = { version: number; domain: string; bindings: { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] };
function validateApplicationMapping(root: ReturnType<typeof getDb>, value: unknown): asserts value is ApplicationMapping {
  const m = value as ApplicationMapping;
  const canonical = (v: unknown): v is string => typeof v === "string" && !!v && v === v.trim();
  if (!m || m.version !== 1 || !canonical(m.domain) || !Array.isArray(m.bindings) || !m.bindings.length ||
    ["chatJid", "branchId", "conversationId", "sessionId"].some(key => new Set(m.bindings.map(b => b?.[key as keyof typeof b])).size !== m.bindings.length) ||
    m.bindings.some(b => !b || !canonical(b.chatJid) || !canonical(b.branchId) || !canonical(b.sessionId) || !Number.isSafeInteger(b.conversationId) || b.conversationId <= 1 ||
      !root.query("SELECT 1 FROM conversations WHERE id=?").get(b.conversationId) ||
      !root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL").get(b.chatJid, b.branchId))) throw Error("Invalid durable application conversation manifest");
}

/** Presence detection only: migration remains a separate, unimplemented operation. */
export function assertFreshApplicationHistory(root: ReturnType<typeof getDb>, sessionsDir: string): void {
  const files = existsSync(sessionsDir) ? readdirSync(sessionsDir, { recursive: true, withFileTypes: true }) : [];
  if (files.some(file => file.isFile())) throw Error("Durable startup requires migration: legacy session files exist; no files were imported or reset");
  const exists = (name: string) => !!root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const sdkTables = ["durable_schema", "durable_metadata", "record_ids", "conversations", "entries", "tasks", "submissions", "documents", "document_revisions"];
  let mapping: ApplicationMapping | undefined;
  if (sdkTables.some(exists)) {
    if (!sdkTables.every(exists)) throw Error("Durable startup requires migration: partial SDK storage");
    const docs = root.query("SELECT id FROM documents WHERE kind='\"app.application-conversations\"' AND scope_kind='conversation' AND owner_id=1 AND retired_at IS NULL").all() as { id: number }[];
    if (docs.length !== 1) throw Error("Invalid durable application conversation manifest: migration required");
    const revisions = root.query("SELECT kind, version, content FROM document_revisions WHERE document_id=? ORDER BY seq").all(docs[0]!.id) as { kind: string; version: number; content: string }[];
    let materialized: unknown;
    for (const revision of revisions) {
      if (revision.version !== 1) throw Error("Invalid durable application conversation manifest");
      if (revision.kind === "base") materialized = JSON.parse(revision.content);
      else if (revision.kind === "delta" && materialized) materialized = apply(materialized, JSON.parse(revision.content));
      else throw Error("Invalid durable application conversation manifest");
    }
    mapping = materialized as ApplicationMapping;
    validateApplicationMapping(root, mapping);
    for (const b of mapping.bindings) {
      const row = root.query(`SELECT r.content FROM documents d JOIN document_revisions r ON r.document_id=d.id WHERE d.kind='"app.application-identity"' AND d.owner_id=? AND d.retired_at IS NULL ORDER BY r.seq DESC LIMIT 1`).get(b.conversationId) as { content: string } | null;
      if (!row || row.content !== JSON.stringify({ domain: mapping.domain, chatJid: b.chatJid, branchId: b.branchId, sessionId: b.sessionId })) throw Error("Invalid durable application identity");
    }
  }
  const messages = root.query("SELECT rowid, id, chat_jid, is_bot_message FROM messages").all() as { rowid: number; id: string; chat_jid: string; is_bot_message: number }[];
  for (const message of messages) {
    if (!mapping || !exists("service_effect_s01_sources")) throw Error("Durable startup requires migration: legacy message history exists");
    const binding = mapping.bindings.find(b => b.chatJid === message.chat_jid);
    const source = root.query("SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=? AND kind='message' AND payload_ref=? AND provenance_ref='application:durable'").get(message.chat_jid, message.id, `message-row:${message.rowid}`);
    const terminal = message.is_bot_message && exists("service_effect_s01_operations") && exists("piclaw_durable_bindings_v1") && root.query(`SELECT 1 FROM service_effect_s01_operations o JOIN piclaw_durable_bindings_v1 b ON b.operation_id=o.operation_id JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq WHERE o.chat_jid=? AND o.terminal_message_row_id=? AND o.phase='terminal' AND b.domain=? AND b.incarnation=? AND b.conversation_id=? AND s.provenance_ref='application:durable'`).get(message.chat_jid, message.rowid, mapping.domain, mapping.domain, binding?.conversationId ?? -1);
    if (!binding || !(message.is_bot_message ? terminal : source)) throw Error("Durable startup requires migration: unverified message provenance");
  }
  if (mapping) for (const table of ["piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1"]) {
    if (!exists(table)) continue;
    const rows = root.query(`SELECT domain, incarnation, chat_jid, branch_id, conversation_id FROM ${table}`).all() as { domain: string; incarnation: string; chat_jid: string; branch_id: string; conversation_id: number }[];
    if (rows.some(row => row.domain !== mapping!.domain || row.incarnation !== mapping!.domain || !mapping!.bindings.some(b => b.chatJid === row.chat_jid && b.branchId === row.branch_id && b.conversationId === row.conversation_id))) throw Error("Invalid durable application routing provenance");
  }
}

/** Mainstream source factory. Only startup-known chats are admitted; unknown chats fail closed. */
export async function createDefaultApplicationRuntime(owner: RuntimeLockHandle, getModels: () => Promise<RuntimeModelServices>): Promise<RuntimeBackend> {
  if (process.platform !== "linux") throw Error("Durable application ownership is qualified only on Linux");
  const ownership = applicationOwnership(owner);
  const assert = () => owner.assertCurrentOwner();
  const root = getDb();
  assertFreshApplicationHistory(root, SESSIONS_DIR); // BEFORE SDK/schema/model construction
  const host = await getModels(); assert();
  const settings = SettingsManager.create(WORKSPACE_DIR, getPiclawAgentDir());
  const provider = settings.getDefaultProvider(), modelId = settings.getDefaultModel();
  // Only the host's authenticated/approved catalog grants admission, never getAll().
  const available = host.modelRegistry.getAvailable().filter(model => {
    const physical = host.modelRuntime.getPhysicalModel(model.provider, model.id);
    return physical?.provider === model.provider && physical.id === model.id;
  });
  const selected = provider && modelId ? available.find(model => model.provider === provider && model.id === modelId) : available[0];
  if (!selected) throw Error("Durable startup requires an available host default model");
  const ref = { provider: selected.provider, id: selected.id };
  const lifetime = new AbortController();
  const check = (model: { provider: string; id: string }, signal: AbortSignal) => {
    assert(); signal.throwIfAborted();
    if (!available.some(entry => entry.provider === model.provider && entry.id === model.id)) throw Error("Host model not approved");
    if (!host.modelRegistry.getAvailable().some(entry => entry.provider === model.provider && entry.id === model.id)) throw Error("Host model no longer available");
    const physical = host.modelRuntime.getPhysicalModel(model.provider, model.id);
    if (physical?.provider !== model.provider || physical.id !== model.id) throw Error("Host model no longer available");
  };
  // Validate stored choices without opening/writing SDK documents or bundle ports.
  if (root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'").get()) {
    const docs = root.query(`SELECT id FROM documents WHERE kind='"pi.agent"' AND retired_at IS NULL`).all() as { id: number }[];
    for (const doc of docs) {
      let stored: { model?: { provider: string; modelId: string } } | undefined;
      const revisions = root.query("SELECT kind, content FROM document_revisions WHERE document_id=? ORDER BY seq").all(doc.id) as { kind: string; content: string }[];
      for (const revision of revisions) {
        if (revision.kind === "base") stored = JSON.parse(revision.content);
        else if (revision.kind === "delta" && stored) stored = apply(stored, JSON.parse(revision.content));
        else throw Error("Invalid persisted agent document");
      }
      if (stored?.model && !available.some(model => model.provider === stored.model!.provider && model.id === stored.model!.modelId))
        throw Error("Persisted host model not approved");
    }
  }
  const models = createHostModels(host.modelRuntime, available.map(model => ({ provider: model.provider, id: model.id })), { signal: lifetime.signal,
    async authorize(model, _kind, signal) { check(model, signal); }, assertCurrent(model, _kind, signal) { check(model, signal); } });
  const registry = createRegistry();
  // Real host tracked-bash/keychain operations, not durable's independent coding tools.
  const bash = createHostBashTool({ cwd: WORKSPACE_DIR, authority: { assertAllowed: assert }, shellPath: () => settings.getShellPath() });
  const harnessOptions = { models, registry, settings: { retry: { enabled: false } } };
  const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")?.file;
  if (!path) throw Error("Durable default requires a file-backed application database");
  const storage = new BunSqliteDatabase(path, { root, assertOwner: assert, fenceTransactions: true });
  let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
  let mapping!: { version: number; domain: string; bindings: { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] };
  let primary: unknown;
  let failed = false;
  try {
    assert();
    harness = await Harness.open(await SqliteStorage.open(storage), harnessOptions, context);
    const app = await harness.root(context, { agent: { model: { provider: ref.provider, modelId: ref.id }, tools: [bash] } });
    // The SDK document is the sole routing authority; host binding tables link accepted sources only.
    mapping = await app.commit(async tx => {
      const doc = await tx.doc(ApplicationConversations, app.id);
      return JSON.parse(JSON.stringify(doc)) as typeof mapping;
    }, context);
    if (!mapping.domain) {
      // A fresh host may not have its initial web header until WebChannel construction.
      storeChatMetadata("web:default", new Date().toISOString());
      const chats = root.query("SELECT c.jid, b.branch_id FROM chats c JOIN chat_branches b ON b.chat_jid=c.jid WHERE b.archived_at IS NULL ORDER BY c.jid").all() as { jid: string; branch_id: string }[];
      const bindings = [] as typeof mapping.bindings;
      for (const chat of chats) {
        assert();
        const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: ref.provider, modelId: ref.id }, tools: [bash] } }, context);
        bindings.push({ chatJid: chat.jid, branchId: chat.branch_id, conversationId: conversation.id, sessionId: crypto.randomUUID() });
      }
      mapping = { version: 1, domain: crypto.randomUUID(), bindings };
      for (const binding of bindings) {
        const identity = { domain: mapping.domain, chatJid: binding.chatJid, branchId: binding.branchId, sessionId: binding.sessionId };
        // Initial creation stores one base, independently anchoring root routing identities.
        const conversation = (await harness.conversation(binding.conversationId as ConversationId, context))!;
        const token = defineDoc({ kind: "app.application-identity", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => identity });
        await conversation.commit(async tx => { await tx.doc(token, conversation.id); }, context);
      }
      await app.commit(async tx => { const doc = await tx.doc(ApplicationConversations, app.id); Object.assign(doc, mapping); }, context);
    }
    validateApplicationMapping(root, mapping);
  } catch (error) { failed = true; primary = error; }
  // Harness.open may allocate storage before rejecting; the application connection
  // is ours even when no harness was returned. Confirm both layers closed.
  const cleanupFailures: unknown[] = [];
  if (harness) {
    try { await harness.close(context); } catch (error) { cleanupFailures.push(error); }
  }
  try { await storage.close(); } catch (error) { if (!cleanupFailures.includes(error)) cleanupFailures.push(error); }
  if (cleanupFailures.length) throw new RuntimeStartupCleanupError(
    [...(failed ? [primary] : []), ...cleanupFailures], "Application preparation cleanup uncertain");
  if (failed) throw primary;
  assert();
  installTerminalSettlementCompositionSchema(root);
  const payloadDir = join(DATA_DIR, "durable-answers");
  const payloadPath = (ref: string) => join(payloadDir, createHash("sha256").update(ref).digest("hex"));
  const answers = { put(ref: string, text: string) {
    assert(); mkdirSync(payloadDir, { recursive: true });
    const file = payloadPath(ref);
    if (existsSync(file)) { if (readFileSync(file, "utf8") !== text) throw Error("Immutable answer collision"); return; }
    writeFileSync(file, text, { flag: "wx", mode: 0o600 });
  }, resolver: { resolve(ref: string) {
    assert(); const file = payloadPath(ref); if (!existsSync(file)) return null;
    const bytes = new Uint8Array(readFileSync(file));
    return { ref, bytes, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/plain", redactionClass: "private" as const };
  } } };
  const bundle = await createApplicationBootstrapBundle({ root, path, ownership, offlineInitialize: true, answers,
    manifest: mapping.bindings.map(({ chatJid, branchId, conversationId }) => ({ chatJid, branchId, conversationId: conversationId as ConversationId })),
    sessions: new Map(mapping.bindings.map(binding => [binding.chatJid, binding.sessionId])),
    assertConversationAvailable() { check(ref, lifetime.signal); },
    async createConversation(tx, chatJid, branchId) {
      assert(); check(ref, lifetime.signal);
      const doc = await tx.doc(ApplicationConversations, 1 as ConversationId);
      if (doc.domain !== mapping.domain || doc.bindings.some(b => b.chatJid === chatJid || b.branchId === branchId)) throw Error("Application mapping conflict");
      const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
      await configure(tx, conversation.id, { model: { provider: ref.provider, modelId: ref.id }, tools: [bash] });
      const binding = { chatJid, branchId, conversationId: conversation.id, sessionId: crypto.randomUUID() };
      const identity = { domain: mapping.domain, chatJid, branchId, sessionId: binding.sessionId };
      const token = defineDoc({ kind: "app.application-identity", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => identity });
      await tx.doc(token, conversation.id);
      doc.bindings.push(binding);
      assert(); check(ref, lifetime.signal);
      return Object.freeze(binding);
    },
    runtime: { incarnation: mapping.domain, sessionId: mapping.domain, lane: "main", generation: 1, now: () => new Date().toISOString(), harnessOptions } }, context);
  return { sessionOptions: bundle.sessionOptions, bind: bundle.bind,
    stop() { lifetime.abort(); bundle.stop(); }, async close() { lifetime.abort(); await bundle.close(); } };
}
