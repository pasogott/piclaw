import { createHash } from "node:crypto";
import { buildSessionProjection, convertToLlm, type SessionEntry } from "../../src/durable-legacy-sdk.js";
export const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
/** Public Root SDK projection only. Incomplete units remain solely in the raw archive. */
export function selectRecent(entries: SessionEntry[], leaf: string, asOf: string) {
  const end = Date.parse(asOf);
  if (!Number.isFinite(end) || new Date(end).toISOString() !== asOf || !entries.some(e => e.id === leaf)) throw Error("Invalid leaf/asOf");
  const byId = new Map(entries.map(entry => [entry.id,entry]));
  if (byId.size !== entries.length) throw Error("Duplicate source entry IDs");
  const visited = new Set<string>(); let cursor: string | null = leaf;
  while (cursor) {
    if (visited.has(cursor) || !byId.has(cursor)) throw Error("Invalid source parent chain");
    visited.add(cursor); cursor = byId.get(cursor)!.parentId;
  }
  const projection = buildSessionProjection(entries, leaf);
  let checkpoint: any[] = [], group: any[] = [], bad = false;
  let turns: any[][] = []; const pending = new Map<string, string>();
  for (const p of projection.entries) {
    const messages = convertToLlm(p.messages).filter(m => m.role !== "system");
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
  if (!turns.length) throw Error("No complete recent unit");
  if (!fits([...checkpoint, ...turns.at(-1)!])) throw Error("Latest complete unit exceeds payload limit; never truncate");
  let recent = turns.slice(-20);
  while (!fits([...checkpoint, ...recent.flat()])) recent.shift();
  const selected = [...checkpoint, ...recent.flat()];
  return { messages: selected.map(x => x.message), sourceEntryIds: selected.map(x => x.sourceEntryId), completedTurns: recent.length };
}
