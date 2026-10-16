// INACTIVE private qualification only. No bootstrap, engine open, queue or production migration.
import type { Database } from "bun:sqlite";
import { hashCanonicalRequest } from "../../../runtime/src/service-effects/contracts/common.js";
export type Phase = "source" | "copying" | "verified" | "active" | "reconciliation_required";
export interface CutoverIdentity { domain: string; incarnation: string; ownerGeneration: number; sourceEngineId: string; candidateStoreRef: string }
export interface CutoverRequest { requestKey: string; sourceDigest: string; importHash: string }
export interface Receipt { sourceDigest: string; receiptHash: string }
export interface Manifest { phase: Phase; revision: number; writer: string; postCutoverCount: number; request: CutoverRequest; receipt: Receipt | null }
export interface CutoverPorts {
  /** Synchronous exact domain/incarnation/generation assertion. Must throw on owner loss. */
  assertOwner(identity: Readonly<CutoverIdentity>): void;
  /** Caller must fence real writer admission/effects in this same host SQL domain.
   * A persisted marker alone does NOT fence another process or external effects. */
  assertCurrentWriter(writer: string): void;
  /** Synchronous authoritative SQL queries, including current original-source bytes digest.
   * Invoked again INSIDE writer commit. Source admission must honor that same SQL fence. */
  checkDrained(): { sourceDigest: string; pending: number; inflight: number };
}
export interface Preparation {
  /** Idempotent deterministic owned copy; verify original bytes, not just an import digest. */
  copy(request: Readonly<CutoverRequest>): Promise<Receipt>;
  /** Must query committed importer root or idempotently reexecute importCopiedLegacyTree.
   * Intent precedes effects; a crash before acknowledgement is NOT exactly-once execution. */
  importCopied(request: Readonly<CutoverRequest>): Promise<Receipt>;
}
const fail = () => new Error("Cutover rejected");
function safe<T>(body: () => T): T { try { return body(); } catch { throw fail(); } }
function ref(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value)) throw fail();
  return value;
}
function digest(value: string) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw fail(); return value; }
function requestSnapshot(r: CutoverRequest) {
  return Object.freeze({ requestKey: ref(r.requestKey), sourceDigest: digest(r.sourceDigest), importHash: digest(r.importHash) });
}
/** Explicit fixture sidecar initializer, never invoked by controller construction. Caller enables FK. */
export function initializeCutoverManifest(db: Database) {
  safe(() => db.exec(`CREATE TABLE IF NOT EXISTS qualification_cutover_v1 (
    domain TEXT PRIMARY KEY, identity TEXT NOT NULL, request_hash TEXT NOT NULL, manifest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS qualification_cutover_work_v1 (
    domain TEXT NOT NULL REFERENCES qualification_cutover_v1(domain), operation_id TEXT NOT NULL,
    content_hash TEXT NOT NULL, PRIMARY KEY(domain,operation_id));`));
}
export class HostCutoverController {
  private readonly identity: Readonly<CutoverIdentity>;
  private readonly ports: CutoverPorts;
  constructor(private readonly db: Database, identity: CutoverIdentity, ports: CutoverPorts) {
    this.identity = safe(() => Object.freeze({ domain: ref(identity.domain), incarnation: ref(identity.incarnation),
      ownerGeneration: identity.ownerGeneration, sourceEngineId: ref(identity.sourceEngineId), candidateStoreRef: ref(identity.candidateStoreRef) }));
    if (!Number.isSafeInteger(this.identity.ownerGeneration) || this.identity.ownerGeneration < 1 || this.identity.sourceEngineId === this.identity.candidateStoreRef) throw fail();
    this.ports = safe(() => Object.freeze({ assertOwner: ports.assertOwner.bind(ports),
      assertCurrentWriter: ports.assertCurrentWriter.bind(ports), checkDrained: ports.checkDrained.bind(ports) }));
  }
  private owner() { this.ports.assertOwner(this.identity); }
  private read() {
    const row = this.db.query("SELECT identity, request_hash, manifest FROM qualification_cutover_v1 WHERE domain=?")
      .get(this.identity.domain) as { identity: string; request_hash: string; manifest: string } | null;
    if (row && row.identity !== JSON.stringify(this.identity)) throw fail();
    return row;
  }
  inspect(): Manifest | null { return safe(() => { this.owner(); const row = this.read(); return row ? JSON.parse(row.manifest) : null; }); }
  private drained(r: CutoverRequest) {
    const { sourceDigest, pending, inflight } = this.ports.checkDrained();
    if (sourceDigest !== r.sourceDigest || pending !== 0 || inflight !== 0) throw fail();
  }
  preflight(request: CutoverRequest): Manifest {
    return safe(() => {
      const r = requestSnapshot(request);
      return this.db.transaction(() => {
        this.owner(); this.ports.assertCurrentWriter(this.identity.sourceEngineId); this.drained(r);
        const prior = this.read(), hash = hashCanonicalRequest(r);
        if (prior) { if (prior.request_hash !== hash) throw fail(); this.owner(); return JSON.parse(prior.manifest); }
        const m: Manifest = { phase: "source", revision: 0, writer: this.identity.sourceEngineId, postCutoverCount: 0, request: r, receipt: null };
        this.db.query("INSERT INTO qualification_cutover_v1 VALUES (?,?,?,?)").run(this.identity.domain, JSON.stringify(this.identity), hash, JSON.stringify(m));
        this.owner(); return m;
      }).immediate();
    });
  }
  private change(expected: number, phases: Phase[], body: (m: Manifest) => void): Manifest {
    return safe(() => this.db.transaction(() => {
      this.owner(); const row = this.read(); if (!row) throw fail();
      const m: Manifest = JSON.parse(row.manifest);
      if (m.revision !== expected || !phases.includes(m.phase)) throw fail();
      this.ports.assertCurrentWriter(m.writer); body(m); this.owner(); m.revision++;
      // BEGIN IMMEDIATE serializes contenders; revision and phase were compared within this TX.
      this.db.query("UPDATE qualification_cutover_v1 SET manifest=? WHERE domain=? AND manifest=?")
        .run(JSON.stringify(m), this.identity.domain, row.manifest);
      this.owner(); return m;
    }).immediate());
  }
  private receipt(value: Receipt, request: CutoverRequest) {
    const copy = Object.freeze({ sourceDigest: digest(value.sourceDigest), receiptHash: digest(value.receiptHash) });
    if (copy.sourceDigest !== request.sourceDigest || copy.receiptHash !== request.importHash) throw fail();
    return copy;
  }
  async begin(expectedRevision: number, preparation: Preparation): Promise<Manifest> {
    try {
      // Capture BOTH callbacks before the first await, never re-read caller options.
      const copy = preparation.copy.bind(preparation), importCopied = preparation.importCopied.bind(preparation);
      const intent = this.change(expectedRevision, ["source", "copying"], m => { this.drained(m.request); m.phase = "copying"; });
      const request = requestSnapshot(intent.request);
      this.receipt(await copy(request), request); this.owner();
      const receipt = this.receipt(await importCopied(request), request); this.owner();
      return this.change(intent.revision, ["copying"], m => { this.drained(m.request); m.receipt = receipt; });
    } catch { throw fail(); }
  }
  async verify(expectedRevision: number, verifier: (request: Readonly<CutoverRequest>, receipt: Readonly<Receipt>) => Promise<Receipt>) {
    try {
      const m = this.inspect(); if (!m || m.revision !== expectedRevision || m.phase !== "copying" || !m.receipt) throw fail();
      const request = requestSnapshot(m.request), receipt = Object.freeze({ ...m.receipt });
      const verified = this.receipt(await verifier(request, receipt), request); this.owner();
      return this.change(expectedRevision, ["copying"], next => { this.drained(next.request); next.phase = "verified"; next.receipt = verified; });
    } catch { throw fail(); }
  }
  /** Returns candidateReady data; caller alone may subsequently open the inactive host runtime. */
  commitWriter(expectedRevision: number) {
    return this.change(expectedRevision, ["verified"], m => {
      this.drained(m.request); if (!m.receipt) throw fail(); m.phase = "active"; m.writer = this.identity.candidateStoreRef;
    });
  }
  /** Call in the host acceptance transaction with the actual immutable operation binding.
   * Trusted caller port, not a queue. Does not deduplicate timeline publication or effects. */
  recordPostCutoverWork(expectedRevision: number, operation: { operationId: string; contentHash: string }) {
    return safe(() => {
      const id = ref(operation.operationId), hash = digest(operation.contentHash);
      return this.change(expectedRevision, ["active", "reconciliation_required"], m => {
        const prior = this.db.query("SELECT content_hash FROM qualification_cutover_work_v1 WHERE domain=? AND operation_id=?")
          .get(this.identity.domain, id) as { content_hash: string } | null;
        if (prior) { if (prior.content_hash !== hash) throw fail(); return; }
        this.db.query("INSERT INTO qualification_cutover_work_v1 VALUES (?,?,?)").run(this.identity.domain, id, hash); m.postCutoverCount++;
      });
    });
  }
  rollback(expectedRevision: number) {
    const m = this.change(expectedRevision, ["source", "copying", "verified", "active", "reconciliation_required"], m => {
      if (m.postCutoverCount) { m.phase = "reconciliation_required"; return; }
      m.phase = "source"; m.writer = this.identity.sourceEngineId; m.receipt = null;
    });
    if (m.phase === "reconciliation_required") throw new Error("Reconciliation required");
    return m;
  }
}
