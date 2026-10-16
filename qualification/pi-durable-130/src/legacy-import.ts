import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { JsonValue, Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { CompactionEntry, SystemEntry, defineDoc, type Conversation, type EntryId } from "@earendil-works/pi-durable";
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


export const IMPORTER_VERSION = 1;
export const DEFAULT_IMPORT_LIMITS = { maxEntries: 1000, maxBytes: 8 * 1024 * 1024 } as const;
export type CopiedLegacyInput = Readonly<{
  sourceJSONL: string; chatJid: string; chatIncarnation: string; branchId: string;
  hostBaseline: string;
  maxEntries?: number; maxBytes?: number;
}>;
/** Trusted host bridge: use ONLY public Pi120 buildSessionContext/convertToLlm and
 * sessionEntryToContextMessages. No SDK runtime, provider, path or engine is loaded here.
 * The input is detached JSON; the host must return detached, serializable model data.
 * This callback is trusted to project faithfully: forged host messages are not security-gated. */
export type GetLegacyContext = (entries: readonly SessionEntry[], leafId: string) => {
  messages: readonly Message[];
  projected: readonly { sourceEntryId: string; messages: readonly Message[] }[];
};
type Mapping = { sourceEntryId: string; durableEntryId: number };
export type LegacyImportBinding = {
  schemaVersion: number; importerVersion: number; sourceHash: string;
  chatJid: string; chatIncarnation: string; branchId: string; sourceSessionId: string;
  sourceLeafId: string; engineConversationId: number;
  originalEntries: JsonValue[]; entries: Mapping[];
};
export const LegacyImportManifest = defineDoc<{ binding: LegacyImportBinding | null }>({
  kind: "app.copied-legacy-import", version: 1, scope: "conversation", history: "latest",
  fork: "initial", initial: () => ({ binding: null }),
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Pure fail-closed preparation. Only a complete linear, quiescent v3 history is supported.
 * Bounds reject the WHOLE input. No selected-path filtering or silent truncation. */
export function prepareLegacyImport(input: CopiedLegacyInput, getLegacyContext: GetLegacyContext) {
  return prepareCopiedLegacy(input, getLegacyContext);
}

function prepareCopiedLegacy(input: CopiedLegacyInput, getLegacyContext: GetLegacyContext) {
  // Host-owned accessors are read once, before validation or any trusted callback.
  // Readonly is a type-level promise, not runtime isolation; retain only scalar copies.
  const { sourceJSONL, chatJid, chatIncarnation, branchId, hostBaseline,
    maxEntries: requestedMaxEntries, maxBytes: requestedMaxBytes } = input;
  const identity = Object.freeze({ chatJid, chatIncarnation, branchId, hostBaseline });
  for (const key of ["chatJid", "chatIncarnation", "branchId", "hostBaseline"] as const)
    assert(typeof identity[key] === "string" && identity[key].length > 0, `missing ${key}`);
  assert(typeof sourceJSONL === "string", "missing sourceJSONL");
  const maxEntries = requestedMaxEntries ?? DEFAULT_IMPORT_LIMITS.maxEntries;
  const maxBytes = requestedMaxBytes ?? DEFAULT_IMPORT_LIMITS.maxBytes;
  assert(Number.isSafeInteger(maxEntries) && maxEntries > 0, "invalid maxEntries");
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0, "invalid maxBytes");
  assert(Buffer.byteLength(sourceJSONL, "utf8") <= maxBytes, "maxBytes exceeded");
  const lines = sourceJSONL.trim().split("\n");
  assert(lines.length > 1 && lines.length - 1 <= maxEntries, "maxEntries exceeded or empty source");
  const [header, ...raw]: unknown[] = lines.map(line => JSON.parse(line, (_key, value: unknown) => {
    assert(typeof value !== "number" || Number.isFinite(value), "non-finite JSON number");
    return value;
  }));
  object(header); keys(header, ["type", "version", "id", "timestamp", "cwd"]);
  assert(header.type === "session" && header.version === 3, "unsupported session schema");
  strings(header, ["id", "timestamp", "cwd"]);
  const ids = new Set<string>(), calls = new Set<string>();
  const pending: { id: string; name: string }[] = [];
  let parent: string | null = null;
  for (const entry of raw) {
    object(entry); strings(entry, ["type", "id", "timestamp"]);
    assert(Number.isFinite(Date.parse(entry.timestamp as string)), "invalid timestamp");
    assert(!ids.has(entry.id as string) && entry.parentId === parent, "unsupported nonlinear history/duplicate ID");
    if (entry.type === "message") {
      keys(entry, ["type", "id", "parentId", "timestamp", "message"]);
      object(entry.message);
      if (entry.message.role === "system") {
        keys(entry.message, ["role", "content", "timestamp"]); strings(entry.message, ["content"]);
        finite(entry.message.timestamp);
        assert(pending.length === 0, "inflight tools");
      } else {
        message(entry.message);
        const msg: Message = clone(entry.message) as Message;
        if (msg.role === "toolResult") {
          const call = pending.shift();
          assert(call && call.id === msg.toolCallId && call.name === msg.toolName, "orphan/out-of-order tool result");
        } else {
          assert(pending.length === 0, "inflight tools");
          if (msg.role === "assistant") {
            for (const call of msg.content) if (call.type === "toolCall") {
              assert(!calls.has(call.id), "duplicate tool call"); calls.add(call.id);
              pending.push({ id: call.id, name: call.name });
            }
            assert((msg.stopReason === "toolUse") === (pending.length > 0), "inconsistent tool stop reason");
          }
        }
      }
    } else if (entry.type === "compaction") {
      keys(entry, ["type", "id", "parentId", "timestamp", "summary", "firstKeptEntryId", "tokensBefore", "details", "fromHook", "systemMessage"]);
      strings(entry, ["summary", "firstKeptEntryId"]); finite(entry.tokensBefore);
      assert(ids.has(entry.firstKeptEntryId as string), "unmapped compaction head");
      assert(pending.length === 0, "inflight tools");
      if (entry.fromHook !== undefined) assert(typeof entry.fromHook === "boolean");
      if (entry.systemMessage !== undefined) {
        object(entry.systemMessage); keys(entry.systemMessage, ["role", "content", "timestamp"]);
        assert(entry.systemMessage.role === "system"); strings(entry.systemMessage, ["content"]); finite(entry.systemMessage.timestamp);
      }
    } else if (entry.type === "custom") {
      keys(entry, ["type", "id", "parentId", "timestamp", "customType", "data"]);
      assert(entry.customType === "qualification.display", "unsupported extension state");
    } else assert.fail(`unsupported record: ${entry.type}`);
    parent = entry.id as string; ids.add(parent);
  }
  assert(pending.length === 0, "inflight tools");
  // Cast only after the narrow data validator above; never executes source content.
  const entries = raw as SessionEntry[];
  const first = entries[0];
  assert(first?.type === "message" && first.message.role === "system" && first.message.content === hostBaseline,
    "missing/mismatched persisted host baseline (external-only baseline unsupported)");
  const projection = clone(getLegacyContext(clone(entries), parent!));
  assert(projection.projected.length === entries.length && projection.projected.every((p, i) => p.sourceEntryId === entries[i]!.id),
    "incomplete host projection");
  const sourceHash = createHash("sha256").update(JSON.stringify({
    importerVersion: IMPORTER_VERSION, chatJid, chatIncarnation, branchId, hostBaseline, sourceJSONL,
  })).digest("hex");
  return { identity, entries, projection, sourceHash, sourceSessionId: header.id as string, sourceLeafId: parent! };
}

/** Caller MUST hold exclusive host ownership, drain admission/work, and use owned/fenced
 * storage for the entire async commit (including final storage commit). assertOwnership
 * is a synchronous additional check, NOT a lease or a final async storage fence.
 * No live source reads, tasks, queue, replay, batch runner or production activation.
 * One bounded transaction; large-input blocking/performance is NOT qualified. */
export async function importCopiedLegacy(conversation: Conversation, input: CopiedLegacyInput,
  getLegacyContext: GetLegacyContext, assertOwnership: () => void, context: Context) {
  // Always privately reprepare; a caller-mutated public preparation is never accepted.
  const prepared = prepareCopiedLegacy(input, getLegacyContext);
  assertOwnership();
  return conversation.commit(async tx => {
    assertOwnership();
    const doc = await tx.doc(LegacyImportManifest, conversation.id);
    if (doc.binding) {
      assert(doc.binding.sourceHash === prepared.sourceHash, "import binding/content conflict");
      assertOwnership();
      return clone(doc.binding);
    }
    assert((await tx.scanEntries({ conversationId: conversation.id }, 1)).items.length === 0, "target must be empty");
    const mapping = new Map<string, EntryId>();
    for (const [index, entry] of prepared.entries.entries()) {
      assertOwnership();
      const audit = await tx.appendEntry(conversation.id, { kind: "app.legacy-source", data: JSON.parse(JSON.stringify(entry)) });
      let at = audit.id;
      const model = [...prepared.projection.projected[index]!.messages];
      if (entry.type === "message") {
        assertOwnership();
        at = entry.message.role === "system"
          ? (await tx.appendEntry(SystemEntry, conversation.id, { model })).id
          : (await tx.appendEntry(conversation.id, { kind: "app.legacy-message", model })).id;
      } else if (entry.type === "compaction") {
        const head = mapping.get(entry.firstKeptEntryId); assert(head, "unmapped compaction head");
        assertOwnership();
        at = (await tx.appendEntry(CompactionEntry, conversation.id, {
          head, data: { reason: "manual" }, model: model.filter(m => m.role !== "system"),
        })).id;
        const baseline = model.filter(m => m.role === "system");
        if (baseline.length) {
          assertOwnership();
          at = (await tx.appendEntry(SystemEntry, conversation.id, { model: baseline })).id;
        }
      }
      mapping.set(entry.id, at);
    }
    const binding: LegacyImportBinding = {
      schemaVersion: 3, importerVersion: IMPORTER_VERSION, sourceHash: prepared.sourceHash,
      chatJid: prepared.identity.chatJid, chatIncarnation: prepared.identity.chatIncarnation, branchId: prepared.identity.branchId,
      sourceSessionId: prepared.sourceSessionId, sourceLeafId: prepared.sourceLeafId,
      engineConversationId: conversation.id, originalEntries: JSON.parse(JSON.stringify(prepared.entries)),
      entries: [...mapping].map(([sourceEntryId, durableEntryId]) => ({ sourceEntryId, durableEntryId })),
    };
    assertOwnership(); doc.binding = binding;
    assertOwnership(); return clone(binding);
  }, context);
}
