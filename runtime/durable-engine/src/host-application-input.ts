import type { Database } from "bun:sqlite";
import { admitSqliteWrite } from "../../src/db/sqlite-async-admission.js";
import { apply } from "@earendil-works/chord/delta";
import { hashCanonicalRequest } from "../../src/service-effects/contracts/common.js";
import type { QueuedFollowupLifecycleService, QueuedInputSourceAdmission } from "../../src/channels/web/runtime/queued-followup-lifecycle-service.js";

export interface NativeSessionTarget {
  readonly domain: string;
  readonly chatJid: string;
  readonly branchId: string;
  readonly conversationId: number;
  readonly sessionId: string;
  readonly revision: string;
}
export interface ApplicationHostInput {
  source: "remote_peer" | "regrets.command";
  sourceId: string;
  text: string;
  queuedAt: string;
  /** Supplied by verified ingress, never inferred from a model/tool source. */
  principal: { id: string; revision: string };
  target: NativeSessionTarget;
  mode?: "queue";
  /** Synchronous current owner/peer policy check. Never persisted. */
  assertCurrent(): void;
}
type Route = Omit<NativeSessionTarget, "domain" | "revision">;

/** Application-owned ingress; no runner, task lifetime, session emulation or provider IO. */
export function createApplicationHostInput(options: {
  root: Database; domain: string; assertCurrent(): void; routes(): readonly Route[];
  followups: QueuedFollowupLifecycleService;
  admission(chat: string): QueuedInputSourceAdmission | undefined;
  steer?(input: ApplicationHostInput, receipt: { rowId: number; chatJid: string }, check: () => void): Promise<{ rowId: number; chatJid: string; mode: "steer" | "new_input" }>;
}) {
  const { root } = options;
  const canonical = (s: unknown): s is string => typeof s === "string" && !!s && s.trim() === s;
  function mapping(): { domain: string; bindings: Route[] } | undefined {
    const docs = root.query(`SELECT id FROM documents WHERE kind='"app.application-conversations"'
      AND scope_kind='conversation' AND owner_id=1 AND retired_at IS NULL`).all() as { id: number }[];
    if (!docs.length) return undefined; // copied public-SDK bundles have an explicit manifest instead
    if (docs.length !== 1) throw Error("Ambiguous application mapping");
    let value: any;
    for (const row of root.query("SELECT kind,version,content FROM document_revisions WHERE document_id=? ORDER BY seq").all(docs[0].id) as { kind: string; version: number; content: string }[]) {
      if (row.version !== 1) throw Error("Unsupported application mapping version");
      if (row.kind === "base") value = JSON.parse(row.content);
      else if (row.kind === "delta" && value) value = apply(value, JSON.parse(row.content));
      else throw Error("Invalid application mapping");
    }
    if (!value || value.domain !== options.domain || !Array.isArray(value.bindings)) throw Error("Invalid application mapping");
    return value;
  }
  function list(): readonly NativeSessionTarget[] {
    options.assertCurrent();
    const doc = mapping();
    return Object.freeze(options.routes().map(route => {
      const identity = { domain: options.domain, chatJid: route.chatJid, branchId: route.branchId,
        conversationId: route.conversationId, sessionId: route.sessionId };
      if (doc && !doc.bindings.some(b => b.chatJid === route.chatJid && b.branchId === route.branchId &&
        b.conversationId === route.conversationId && b.sessionId === route.sessionId)) throw Error("Application routing changed");
      return Object.freeze({ ...identity, revision: hashCanonicalRequest(identity) });
    }));
  }
  function resolve(target: NativeSessionTarget): NativeSessionTarget {
    const found = list().find(b => b.chatJid === target.chatJid);
    if (!found || Object.keys(found).some(k => found[k as keyof NativeSessionTarget] !== target[k as keyof NativeSessionTarget]))
      throw Error("Exact native session target required");
    return found;
  }
  async function admitApplicationInput(raw: ApplicationHostInput) {
    // Copy all persisted authority before callbacks can mutate caller-owned objects.
    const input = { ...raw, target: { ...raw.target }, principal: { ...raw.principal } };
    if (!["remote_peer", "regrets.command"].includes(input.source) || (input.mode !== undefined && input.mode !== "queue"))
      throw Error("Unsupported application input source or mode");
    if (![input.sourceId, input.principal.id, input.principal.revision].every(canonical) ||
      typeof input.text !== "string" || !input.text.trim() || input.text.length > 100_000 ||
      !canonical(input.queuedAt) || !Number.isFinite(Date.parse(input.queuedAt)) || typeof input.assertCurrent !== "function")
      throw Error("Invalid application input authority or payload");
    const check = () => {
      options.assertCurrent(); resolve(input.target);
      const result: unknown = input.assertCurrent();
      if (result !== undefined) { void Promise.resolve(result).catch(() => {}); throw Error("Application input guard must be synchronous"); }
      options.assertCurrent(); resolve(input.target);
    };
    return admitSqliteWrite(root, () => {
      const admit = options.admission(input.target.chatJid);
      if (!admit) throw Error("Native input admission unavailable");
      const rowId = options.followups.enqueueAcceptedFollowupOnce(input.sourceId, input.target.chatJid,
        input.text, input.queuedAt, { source: input.source, queuedBy: {
          source: input.source, userId: input.principal.id, sessionId: input.target.sessionId,
          // Existing metadata projection preserves this canonical, complete authority proof.
          clientId: JSON.stringify({ principalRevision: input.principal.revision, target: input.target }),
          sourceMessageId: input.sourceId,
        } }, stored => { check(); admit(stored); check(); });
      if (rowId === null) throw Error("Application input admission unavailable");
      return Object.freeze({ sourceId: input.sourceId, chatJid: input.target.chatJid, rowId, target: Object.freeze(input.target) });
    }, check);
  }
  async function steerApplicationInput(input: ApplicationHostInput) {
    if (!options.steer) throw Error("Native steering unavailable");
    const snapshot = { ...input, target: { ...input.target }, principal: { ...input.principal } };
    const check = () => { options.assertCurrent(); resolve(snapshot.target); snapshot.assertCurrent(); options.assertCurrent(); resolve(snapshot.target); };
    const receipt = await admitApplicationInput(snapshot);
    return options.steer(snapshot, receipt, check);
  }
  return Object.freeze({ steerApplicationInput, sessionTargets: Object.freeze({ list, resolve }), admitApplicationInput });
}
