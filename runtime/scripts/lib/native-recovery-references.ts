import type { Database } from "bun:sqlite";

/** Data dependencies only. Discovering a reference never grants execution authority. */
export interface NativeRecoveryReference {
  owner: "native-answer" | "native-side-input" | "native-side-result" | "codex-image" | "outbox";
  ref: string;
  location: "answers" | "workspace" | "external";
  mediaType?: string;
  redactionClass: "public" | "private" | "secret";
  sha256?: string;
  byteLength?: number;
}
const side = /^side-prompt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\r\n\0]/.test(value)) throw Error("Invalid recovery reference");
}
function present(db: Database, table: string) {
  return !!db.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table);
}

/** Read from the selected snapshot, never from a live process or its directory.
 * Native answer/side refs have fixed owners. Outbox payloads are adapter-owned:
 * their explicit resolver/file proof must accompany the unit, never a guessed path.
 * Core messages/scheduled definitions remain inside SQLite and are not files.
 */
export function collectNativeRecoveryReferences(db: Database): readonly NativeRecoveryReference[] {
  const refs = new Map<string, NativeRecoveryReference>();
  const add = (input: Omit<NativeRecoveryReference,"redactionClass"> & Partial<Pick<NativeRecoveryReference,"redactionClass">>) => {
    const value: NativeRecoveryReference = { mediaType:"text/plain",redactionClass:"private",...input };
    text(value.ref);
    if (value.mediaType !== undefined) text(value.mediaType);
    const key = JSON.stringify([value.owner, value.ref]);
    const prior = refs.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(value)) throw Error("Conflicting recovery reference");
    refs.set(key, Object.freeze({ ...value }));
  };
  if (present(db, "service_effect_s01_sources")) {
    const inputs = db.query("SELECT kind,source_id,payload_ref FROM service_effect_s01_sources WHERE kind='internal'").all() as
      { kind: string; source_id: string; payload_ref: string }[];
    for (const input of inputs) {
      if (!side.test(input.source_id) || input.payload_ref !== input.source_id) throw Error("Unsupported internal recovery source");
      add({ owner: "native-side-input", ref: input.payload_ref, location: "answers" });
    }
  }
  if (present(db, "piclaw_durable_bindings_v1")) {
    const bindings = db.query(`SELECT b.incarnation,b.submission_id,s.source_id,s.kind,o.terminal_disposition,o.terminal_message_row_id
      FROM piclaw_durable_bindings_v1 b
      JOIN service_effect_s01_operations o ON o.operation_id=b.operation_id AND o.chat_jid=b.chat_jid
      JOIN service_effect_s01_sources s ON s.chat_jid=b.chat_jid AND s.source_seq=b.source_seq
      WHERE o.harness_state='finished' AND (o.terminal_disposition='completed'
        OR (o.terminal_disposition='failed' AND o.terminal_message_row_id IS NOT NULL))`).all() as
      { incarnation: string; submission_id: number | bigint | null; source_id: string; kind: string; terminal_disposition: string; terminal_message_row_id: number | bigint | null }[];
    for (const binding of bindings) {
      text(binding.incarnation);
      if (binding.submission_id === null || BigInt(binding.submission_id) < 1n) throw Error("Missing native answer submission binding");
      add({ owner: "native-answer", ref: `runtime-answer:${binding.incarnation}:${binding.submission_id}`, location: "answers" });
      if (binding.kind === "internal" && binding.terminal_disposition === "completed") {
        if (!side.test(binding.source_id)) throw Error("Unsupported internal recovery result");
        add({ owner: "native-side-result", ref: `side-result:${binding.source_id}`, location: "answers" });
      }
    }
  }
  if (present(db, "extension_kv")) {
    const records = db.query("SELECT scope_key,key,value FROM extension_kv WHERE extension_id='codex-conversion' AND scope='chat' AND key LIKE 'outputrefs:%'").all() as
      { scope_key: string; key: string; value: string }[];
    for (const row of records) {
      let record: any;
      try { record = JSON.parse(row.value); } catch { throw Error("Invalid Codex recovery record"); }
      if (typeof record?.hostOperationId !== "string" || !record.hostOperationId || record.chatJid !== row.scope_key ||
        `outputrefs:${record.hostOperationId}` !== row.key || !Array.isArray(record.refs)) throw Error("Invalid Codex recovery owner");
      for (const image of record.refs) {
        if (typeof image?.path !== "string" || !/^\.pi\/openai-codex-images\/[^\r\n\0]+$/.test(image.path) ||
          image.path.split("/").some((part: string) => !part || part === "." || part === "..") ||
          typeof (image.codexOperationId ?? record.codexOperationId) !== "string" || !(image.codexOperationId ?? record.codexOperationId) ||
          typeof image.callId !== "string" || !image.callId || typeof image.mimeType !== "string" || !/^image\/[a-z0-9.+-]+$/.test(image.mimeType) ||
          (image.responseId !== undefined && typeof image.responseId !== "string") || !hash.test(image.sha256) || !Number.isSafeInteger(image.bytes) || image.bytes < 0)
          throw Error("Invalid Codex recovery image");
        add({ owner: "codex-image", ref: image.path, location: "workspace", mediaType:image.mimeType, sha256: image.sha256, byteLength: image.bytes });
      }
    }
  }
  if (present(db, "service_effect_s05_outbox")) {
    for (const row of db.query("SELECT DISTINCT payload_ref,redaction_class FROM service_effect_s05_outbox").all() as { payload_ref: string; redaction_class: string }[]) {
      if (!["public","private","secret"].includes(row.redaction_class)) throw Error("Invalid adapter payload redaction class");
      add({ owner: "outbox", ref: row.payload_ref, location: "external",mediaType:undefined,redactionClass:row.redaction_class as NativeRecoveryReference["redactionClass"] });
    }
  }
  const compare = (a: string,b: string) => a < b ? -1 : a > b ? 1 : 0;
  return Object.freeze([...refs.values()].sort((a, b) => compare(a.owner,b.owner) || compare(a.ref,b.ref)));
}
