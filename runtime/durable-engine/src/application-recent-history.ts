/** Explicit operator copy, not native execution authority. No archive is opened here. */
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { SessionEntry } from "../../src/durable-legacy-sdk.js";
import type { Message } from "@earendil-works/pi-ai";
import { defineEntry, type Tx, type ConversationId, type Cursor, type EntryRecord } from "@earendil-works/pi-durable";
import { recordLegacyTimeline, type LegacyTimelineReceipt } from "./application-legacy-timeline.js";

export interface ApplicationRecentHistory {
  chatJid: string;
  branchId: string;
  sourceSessionId: string;
  sourceLeafId: string;
  /** Explicit operator asserting this is a copy, never original residency. */
  owner: string;
  sourceHash: string;
  messages: readonly Message[];
}
const Seed = defineEntry<{ sourceHash: string; sourceSessionId: string; sourceLeafId: string; owner: string; copied: true; chatJid: string; branchId: string; messageIndex: number }>("app.recent-history-copy");
export const recentHistoryHash = (messages: readonly Message[]) => createHash("sha256").update(JSON.stringify(messages)).digest("hex");
const fail = (): never => { throw Error("Invalid recent history scope or boundary"); };
export function validateRecentHistoryScopes(history: readonly ApplicationRecentHistory[], bindings: readonly { chatJid: string; branchId: string }[]): void {
  const seen = new Set<string>();
  for (const item of history) {
    const key = JSON.stringify([item.chatJid, item.branchId]);
    if (seen.has(key) || !bindings.some(b => b.chatJid === item.chatJid && b.branchId === item.branchId)) fail();
    seen.add(key);
    if ([item.owner, item.sourceSessionId, item.sourceLeafId].some(s => typeof s !== "string" || !s.trim() || s !== s.trim()) ||
      !Array.isArray(item.messages) || !item.messages.length || item.messages.length > 1000 ||
      Buffer.byteLength(JSON.stringify(item.messages)) > 8 * 1024 * 1024 || recentHistoryHash(item.messages) !== item.sourceHash) fail();
    let awaitingAssistant = false, hadAssistant = false;
    const calls = new Map<string, string>();
    for (const message of item.messages) {
      if (message.role === "user") {
        if (calls.size || (awaitingAssistant && hadAssistant)) fail();
        awaitingAssistant = true;
      } else if (message.role === "assistant") {
        if (!awaitingAssistant || calls.size || !Array.isArray(message.content) || !message.api ||
          !["stop", "length", "toolUse"].includes(message.stopReason)) fail();
        hadAssistant = true;
        for (const content of message.content) if (content.type === "toolCall") {
          if (!content.id || !content.name || calls.has(content.id)) fail();
          calls.set(content.id, content.name);
        }
        if ((message.stopReason === "toolUse") !== (calls.size > 0)) fail();
        awaitingAssistant = calls.size > 0;
        if (!awaitingAssistant) hadAssistant = false;
      } else if (message.role === "toolResult") {
        if (calls.get(message.toolCallId) !== message.toolName || !calls.delete(message.toolCallId)) fail();
      } else fail(); // Never historical system/offline baseline/custom messages.
    }
    if (awaitingAssistant || calls.size) fail();
  }
}
/** Public single transaction: timeline membership and every seed or nothing.
 * A single public root marker anchors exact request replay; no host SQL writes.
 */
const Marker = defineEntry<{ sourceHash: string }>("app.operator-migration");
export async function recordApplicationMigration(tx: Tx, rootId: ConversationId, root: Database,
  migration: { timeline: LegacyTimelineReceipt; recentHistory: readonly ApplicationRecentHistory[] },
  bindings: readonly { chatJid: string; branchId: string; conversationId: number }[], assertOwner: () => void): Promise<void> {
  assertOwner();
  if (rootId !== 1) fail();
  validateRecentHistoryScopes(migration.recentHistory, bindings);
  // Freeze the request across asynchronous SDK reads.
  const copy = structuredClone(migration);
  const sourceHash = createHash("sha256").update(JSON.stringify({ format: "message-entries-v1", migration: copy })).digest("hex");
  const found: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await tx.scanEntries({ conversationId: rootId }, 1000, cursor);
    assertOwner();
    found.push(...page.items.filter(entry => entry.kind === Marker.kind));
    cursor = page.next;
  } while (cursor);
  const markers = { items: found };
  if (markers.items.length) {
    if (markers.items.length !== 1 || (markers.items[0]!.data as { sourceHash?: string })?.sourceHash !== sourceHash) fail();
    await recordLegacyTimeline(tx, rootId, root, copy.timeline, assertOwner);
    assertOwner();
    return;
  }
  // Public Tx table reads are forbidden after the first table write. Preflight
  // every target before staging timeline membership or any copied message.
  const targets = copy.recentHistory.map(item => ({ item, binding: bindings.find(b =>
    b.chatJid === item.chatJid && b.branchId === item.branchId)! }));
  for (const { binding } of targets) {
    const entries = await tx.scanEntries({ conversationId: binding.conversationId as ConversationId }, 1);
    assertOwner();
    if (entries.items.length) fail();
  }
  assertOwner();
  await recordLegacyTimeline(tx, rootId, root, copy.timeline, assertOwner);
  assertOwner();
  for (const { item, binding } of targets) {
    const { sourceHash, sourceSessionId, sourceLeafId, owner, chatJid, branchId } = item;
    // Keep public compaction/fork heads at message granularity. A single entry
    // containing the entire archive would retain all copied messages at its head.
    for (const [messageIndex, message] of item.messages.entries()) {
      assertOwner();
      await tx.appendEntry(Seed, binding.conversationId as ConversationId, {
        data: { sourceHash, sourceSessionId, sourceLeafId, owner, copied: true, chatJid, branchId, messageIndex }, model: [message],
      });
      assertOwner();
    }
  }
  assertOwner();
  await tx.appendEntry(Marker, rootId, { data: { sourceHash } });
  assertOwner();
}

/** Read only the operator-supplied native public branch API. Choose a complete
 * suffix of turns, never summaries/system entries or a synthetic offline base. */
export function selectApplicationRecentHistory(source: { getLeafId(): string | null; getSessionId(): string; getBranch(): SessionEntry[] },
  scope: { chatJid: string; branchId: string; owner: string }): ApplicationRecentHistory {
  const sourceLeafId = source.getLeafId();
  if (!sourceLeafId) fail();
  const messages = source.getBranch().flatMap(entry => entry.type === "message" &&
    ["user", "assistant", "toolResult"].includes(entry.message.role) ? [entry.message as Message] : []);
  // Candidate suffixes must start at a user boundary and finish a whole turn.
  // Prefer the largest suffix admitted by the same strict import validator.
  for (let start = Math.max(0, messages.length - 1000); start < messages.length; start++) {
    if (messages[start]!.role !== "user") continue;
    const selected = messages.slice(start);
    const item: ApplicationRecentHistory = { ...scope, sourceSessionId: source.getSessionId(),
      sourceLeafId: sourceLeafId!, messages: selected, sourceHash: recentHistoryHash(selected) };
    try { validateRecentHistoryScopes([item], [scope]); return item; } catch { /* Try next complete suffix. */ }
  }
  return fail();
}
