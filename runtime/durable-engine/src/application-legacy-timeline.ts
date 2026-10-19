/** Operator-owned historical membership, NOT native execution/source/terminal authority.
 * Rows remain in messages untouched. Deletions are allowed; moves/content edits fail
 * closed (including chat_jid changes). Cleanup that moves rows needs separate policy.
 * Capture/record must run under the same exclusive application ownership, before
 * admission opens. No conversational-message count bound applies to this metadata.
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { defineDoc, type Tx, type ConversationId } from "@earendil-works/pi-durable";

export type LegacyTimelineReceipt = {
  version: 1;
  rows: { rowid: number; sha256: string }[];
  sha256: string;
};
// Physical migration safety limit only; never truncate or waive verification.
const MAX_BYTES = 64 * 1024 * 1024;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const fail = (): never => { throw Error("Invalid legacy timeline provenance"); };
function keys(value: unknown, expected: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== expected.sort().join(",")) fail();
}
function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify({ bigint: value.toString() });
  if (value instanceof Uint8Array) return JSON.stringify({ blob: Buffer.from(value).toString("hex") });
  if (value && typeof value === "object" && !Array.isArray(value))
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
  return fail();
}
function digestRows(rows: LegacyTimelineReceipt["rows"]) { return hash(JSON.stringify(rows)); }
/** Closed JSON shape, ascending unique positive safe rowids, exact digest. */
export function assertLegacyTimelineReceipt(value: unknown): asserts value is LegacyTimelineReceipt {
  keys(value, ["version", "rows", "sha256"]);
  if (value.version !== 1 || !Array.isArray(value.rows) || typeof value.sha256 !== "string") fail();
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) fail();
  let previous = 0;
  for (const row of value.rows as unknown[]) {
    keys(row, ["rowid", "sha256"]);
    if (typeof row.rowid !== "number" || !Number.isSafeInteger(row.rowid) || row.rowid <= previous ||
      typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)) fail();
    previous = row.rowid as number;
  }
  if (digestRows(value.rows as LegacyTimelineReceipt["rows"]) !== value.sha256) fail();
}
function snapshot(root: Database): LegacyTimelineReceipt {
  // Separate rowid alias from all physical columns, including future columns.
  const columns = root.query("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!columns.length || columns.some(c => c.name.toLowerCase() === "__legacy_rowid" || ["rowid", "_rowid_", "oid"].includes(c.name.toLowerCase()))) fail();
  const rows = (root.query("SELECT rowid AS __legacy_rowid, * FROM messages ORDER BY rowid").all() as Record<string, unknown>[]).map(row => {
    const { __legacy_rowid: rowid, ...fields } = row;
    return Object.freeze({ rowid: rowid as number, sha256: hash(canonical({ rowid, fields })) });
  });
  const receipt = { version: 1 as const, rows, sha256: digestRows(rows) };
  assertLegacyTimelineReceipt(receipt);
  return Object.freeze(receipt);
}
export function captureLegacyTimeline(root: Database, assertOwner: () => void): LegacyTimelineReceipt {
  assertOwner();
  const receipt = snapshot(root);
  assertOwner();
  return receipt;
}
/** Missing rows are legitimate cleanup. New rows never acquire legacy eligibility.
 * A retained captured row with any changed field rejects the entire verification.
 * Identical-byte rowid reuse is indistinguishable without an execution ledger; this
 * helper deliberately creates none and grants no native authority.
 */
export function verifyLegacyTimeline(root: Database, receipt: unknown): ReadonlySet<number> {
  assertLegacyTimelineReceipt(receipt);
  const current = new Map(snapshot(root).rows.map(row => [row.rowid, row.sha256]));
  const verified = new Set<number>();
  for (const row of receipt.rows) {
    const digest = current.get(row.rowid);
    if (digest === undefined) continue;
    if (digest !== row.sha256) fail();
    verified.add(row.rowid);
  }
  return verified;
}
export const ApplicationLegacyTimeline = defineDoc<{ receipt: LegacyTimelineReceipt | null }>({
  kind: "app.legacy-timeline", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ receipt: null }),
});
/** Inside app/root conversation 1 commit, using public SDK only. Exact replay is
 * idempotent even after legitimate deletions/native additions; first preparation
 * requires equality to the ENTIRE current capture, not just a selected subset.
 */
export async function recordLegacyTimeline(tx: Tx, conversationId: ConversationId,
  root: Database, receipt: unknown, assertOwner: () => void): Promise<void> {
  assertOwner();
  if (conversationId !== 1) fail();
  assertLegacyTimelineReceipt(receipt);
  const copy = JSON.parse(JSON.stringify(receipt)) as LegacyTimelineReceipt;
  const doc = await tx.doc(ApplicationLegacyTimeline, conversationId);
  assertOwner();
  if (doc.receipt !== null) {
    assertLegacyTimelineReceipt(doc.receipt);
    if (JSON.stringify(doc.receipt.rows) !== JSON.stringify(copy.rows) || doc.receipt.sha256 !== copy.sha256) fail();
    verifyLegacyTimeline(root, copy);
  } else {
    const expected = captureLegacyTimeline(root, assertOwner);
    if (JSON.stringify(expected) !== JSON.stringify(copy)) fail();
    doc.receipt = copy;
  }
  assertOwner();
}
