import { createHash } from "node:crypto";
import { buildSessionProjection, convertToLlm, type SessionEntry } from "../../src/durable-legacy-sdk.js";
export const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
/** Strict modern wire values only; never repair or stringify away invalid values. */
const object = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
function json(v: any, seen = new Set<any>()): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (!object(v) && !Array.isArray(v) || seen.has(v)) return false;
  if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
  seen.add(v);
  const ok = Object.getOwnPropertySymbols(v).length === 0 && (Array.isArray(v) ? Array.from(v) : Object.values(v)).every(x => json(x, seen));
  seen.delete(v); return ok;
}
export function isModernMessage(m: any): boolean {
  if (!object(m) || !json(m) || !Number.isFinite(m.timestamp)) return false;
  const strings = (...keys: string[]) => keys.every(k => typeof m[k] === "string" && m[k].length > 0);
  if (!["user", "assistant", "toolResult"].includes(m.role)) return false;
  if (m.role === "user" && typeof m.content === "string") return true;
  if (!Array.isArray(m.content)) return false;
  if (!m.content.every((b: any) => object(b) && (
    b.type === "text" ? typeof b.text === "string" :
    b.type === "image" ? m.role !== "assistant" && typeof b.data === "string" && typeof b.mimeType === "string" :
    b.type === "thinking" ? m.role === "assistant" && typeof b.thinking === "string" :
    b.type === "toolCall" ? m.role === "assistant" && typeof b.id === "string" && !!b.id && typeof b.name === "string" && !!b.name && object(b.arguments) : false))) return false;
  if (m.role === "toolResult") return strings("toolCallId", "toolName") && typeof m.isError === "boolean";
  if (m.role === "user") return true;
  const numbers = (v: any, keys: string[]) => object(v) && keys.every(k => typeof v[k] === "number" && Number.isFinite(v[k]) && v[k] >= 0);
  return strings("api", "provider", "model") && ["pending","stop","length","toolUse","error","aborted","deferred"].includes(m.stopReason) &&
    numbers(m.usage, ["input","output","cacheRead","cacheWrite","totalTokens"]) && numbers(m.usage.cost, ["input","output","cacheRead","cacheWrite","total"]);
}
/** Public Root SDK projection only. Incomplete units remain solely in the raw archive. */
export function selectRecent(entries: SessionEntry[], leaf: string, asOf: string) {
  const end = Date.parse(asOf);
  if (!Number.isFinite(end) || new Date(end).toISOString() !== asOf) throw Error("Invalid leaf/asOf");
  const byId = new Map(entries.map(entry => [entry.id,entry]));
  if (byId.size !== entries.length) throw Error("Duplicate source entry IDs");
  const empty = (reason: string) => ({messages:[],sourceEntryIds:[],completedTurns:0,skipped:{[reason]:1},selection:"empty" as const});
  const visited = new Set<string>(); let cursor: string | null = leaf;
  while (cursor) {
    if (visited.has(cursor) || !byId.has(cursor)) return empty("unverifiable-parent-chain");
    visited.add(cursor); cursor = byId.get(cursor)!.parentId;
  }
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  // Supply a safe sentinel only to projection's role inspection, never as selected data.
  const malformed = new Set(entries.filter(e => e.type === "message" && !isModernMessage(e.message)).map(e => e.id));
  const projection = buildSessionProjection(entries.map(e => malformed.has(e.id) ? {...e, message:{role:"invalid"}} as any : e), leaf);
  let checkpoint: any[] = [], group: any[] = [], bad = false;
  let turns: any[][] = []; const pending = new Map<string, string>();
  for (const p of projection.entries) {
    if (malformed.has(p.sourceEntry.id)) { skip("malformed-message"); group = []; bad = false; pending.clear(); continue; }
    const invalidProjection = p.messages.some((m: any) => !object(m) ||
      (["user","assistant","toolResult"].includes(m.role) && !isModernMessage(m)) ||
      (["branchSummary","compactionSummary"].includes(m.role) && typeof m.summary !== "string"));
    if (invalidProjection) { skip("malformed-projection"); group = []; bad = false; pending.clear(); continue; }
    const messages = convertToLlm(p.messages).filter(m => m.role !== "system");
    if (messages.some(m => !isModernMessage(m))) { skip("malformed-projection"); group = []; bad = false; pending.clear(); continue; }
    if (p.sourceEntry.type === "message" && !messages.length) { skip("unsupported-message"); group = []; bad = false; pending.clear(); continue; }
    if (p.sourceEntry.type === "compaction") {
      if (!messages.length) continue;
      checkpoint = messages.map(message => ({ sourceEntryId: p.sourceEntry.id, message }));
      turns = []; group = []; bad = false; pending.clear(); continue;
    }
    for (const message of messages) {
      if (message.role === "user" && group.some(x => x.message.role === "assistant")) { group = []; bad = false; pending.clear(); }
      if (!group.length && message.role !== "user") continue;
      group.push({ sourceEntryId: p.sourceEntry.id, message });
      if (message.role === "assistant") {
        if (pending.size || !message.api || !["stop", "length", "toolUse"].includes(message.stopReason)) bad = true;
        const calls = message.content.filter(b => b.type === "toolCall");
        if ((message.stopReason === "toolUse") !== !!calls.length) bad = true;
        for (const call of calls) { if (pending.has(call.id)) bad = true; pending.set(call.id, call.name); }
        if (["stop", "length"].includes(message.stopReason)) {
          if (bad || pending.size) skip("invalid-turn");
          if (!bad && !pending.size && message.timestamp >= end - 7 * 86400000 && message.timestamp <= end) turns.push(group);
          group = []; bad = false; pending.clear();
        }
      } else if (message.role === "toolResult") {
        if (pending.get(message.toolCallId) !== message.toolName) bad = true;
        pending.delete(message.toolCallId);
      } else if (message.role !== "user") bad = true;
    }
  }
  const fits = (items: any[]) => items.length <= 1000 && Buffer.byteLength(JSON.stringify(items.map(x => x.message))) <= 8 * 1024 * 1024;
  if (group.length) skip("incomplete-turn");
  if (!turns.length) return { messages: [], sourceEntryIds: [], completedTurns: 0, skipped, selection: "empty" as const };
  if (!fits([...checkpoint, ...turns.at(-1)!])) throw Error("Latest complete unit exceeds payload limit; never truncate");
  let recent = turns.slice(-20);
  while (!fits([...checkpoint, ...recent.flat()])) recent.shift();
  const selected = [...checkpoint, ...recent.flat()];
  return { messages: selected.map(x => x.message), sourceEntryIds: selected.map(x => x.sourceEntryId), completedTurns: recent.length, skipped, selection: "selected" as const };
}
