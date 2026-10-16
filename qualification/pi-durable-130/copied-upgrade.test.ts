import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SessionManager, buildSessionContext, convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { prepareCopiedUpgrade } from "../../runtime/durable-engine/src/copied-upgrade.ts";
import { HostCutoverController, initializeCutoverManifest, LegacyTreeImportManifest, LegacyImportManifest, type GetLegacyContext } from "../../runtime/durable-engine/src/index.ts";
import { TestOwner, OwnedSqlite } from "./src/ownership.ts";
import { context, openFixture } from "./src/fixture.ts";
const sha = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bridge: GetLegacyContext = (entries, leaf) => ({ messages: json(convertToLlm(buildSessionContext([...entries], leaf).messages)),
  projected: entries.map(entry => ({ sourceEntryId: entry.id, messages: json(convertToLlm(sessionEntryToContextMessages(entry))) })) });
async function using(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  try { await run(f); } finally { await f.base.close(); f.owner.releaseAfterClose(); f.db.close(); f.owner.closeConnection(); await rm(f.dir, { recursive: true, force: true }); }
}
async function setup() {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "upgrade-")), path = join(dir, "owned.sqlite");
  const manager = SessionManager.inMemory(dir, { id: "existing-session" });
  manager.appendMessage({ role: "system", content: "persisted baseline", timestamp: 1 });
  const user = manager.appendMessage({ role: "user", content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }], timestamp: 2 });
  manager.appendCustomEntry("qualification.display", { note: "copied metadata, not a model message" });
  const shared = manager.appendCompaction("Copied summary, never regenerated", user, 100, { copied: true }, true);
  const answer = () => manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "never", model: "never", content: [{ type: "text", text: "historical" }], stopReason: "stop", timestamp: 3,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const left = answer(); manager.branch(shared); const right = answer();
  const source = Buffer.from([manager.getHeader(), ...manager.getEntries()].map(v => JSON.stringify(v)).join("\n") + "\n");
  const host = { version: 1, sourceCopied: true, expectedSourceSHA256: sha(source), pending: 0, inflight: 0,
    hostBranchBindings: Object.fromEntries([left, right].map((leaf, i) => [leaf, { chatJid: "web:existing", chatIncarnation: "existing-incarnation", branchId: `existing-${i}`, hostBaseline: "persisted baseline" }])) };
  await writeFile(join(dir, "copy.jsonl"), source); await writeFile(join(dir, "host.json"), JSON.stringify(host));
  const bytes = await readFile(join(dir, "copy.jsonl")), manifest = await readFile(join(dir, "host.json"));
  const expected = { sourceSHA256: sha(bytes), manifestSHA256: sha(manifest) };
  const owner = TestOwner.acquire(path), db = new Database(path, { strict: true });
  db.exec("PRAGMA foreign_keys=ON"); initializeCutoverManifest(db);
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new OwnedSqlite(owner)));
  const identity = { domain: "copied-authority", incarnation: "existing-host", ownerGeneration: owner.token.generation, sourceEngineId: "legacy", candidateStoreRef: "candidate" };
  const ports = { assertOwner() { owner.assert(); }, assertCurrentWriter(writer: string) { if (writer !== "legacy") throw Error("not source"); },
    checkDrained() { return { sourceDigest: expected.sourceSHA256, pending: 0, inflight: 0 }; } };
  const controller = new HostCutoverController(db, identity, ports);
  return { dir, owner, db, base, bytes, manifest, expected, controller, identity, ports, host };
}
test("copied upgrade: exact bytes checkpoint before import; lost acknowledgement and disk/public reopen preserve all IDs", () => using(async f => {
  const plan = prepareCopiedUpgrade(f.bytes, f.manifest, f.expected, bridge);
  f.bytes.fill(0); f.manifest.fill(0); // No retained caller buffers.
  const checkpoint = plan.checkpoint(f.controller);
  const preparation = { async copy() { return { sourceDigest: plan.sourceSHA256, receiptHash: plan.request.importHash }; },
    importCopied: () => plan.importCopied(f.base.root, () => f.owner.assert(), context) };
  await expect(f.controller.begin(checkpoint.revision, { ...preparation, async importCopied() { await preparation.importCopied(); throw Error("lost acknowledgement"); } })).rejects.toThrow();
  const rootId = f.base.root.id;
  const before = await f.base.harness.snapshot(LegacyTreeImportManifest, rootId, context);
  await f.base.close();
  const reopened = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new OwnedSqlite(f.owner)));
  const journal = new Database(join(f.dir, "owned.sqlite"), { strict: true });
  try {
    const root = (await reopened.harness.conversation(rootId, context))!;
    const controller = new HostCutoverController(journal, f.identity, f.ports);
    const checkpointAgain = plan.checkpoint(controller);
    const imported = await controller.begin(checkpointAgain.revision, { ...preparation, importCopied: () => plan.importCopied(root, () => f.owner.assert(), context) });
    const verified = await controller.verify(imported.revision, () => plan.verify(reopened.harness, rootId, context));
    expect(verified.phase).toBe("verified"); expect(verified.writer).toBe("legacy");
    expect(await reopened.harness.snapshot(LegacyTreeImportManifest, rootId, context)).toEqual(before);
    const after = f.controller.inspect();
    const originalSource = await readFile(join(f.dir, "copy.jsonl"));
    const differentManifest = Buffer.from(JSON.stringify(f.host) + "\n");
    const other = prepareCopiedUpgrade(originalSource, differentManifest, { ...f.expected, manifestSHA256: sha(differentManifest) }, bridge);
    expect(() => other.checkpoint(controller)).toThrow(); expect(f.controller.inspect()).toEqual(after);
    expect((await root.commit(tx => tx.scanConversations({}, 100), context)).items).toHaveLength(2);
    expect(controller.rollback(verified.revision).writer).toBe("legacy");
    expect(reopened.host.modelCalls + reopened.host.effects + reopened.host.credentialLookups).toBe(0);
  } finally { await reopened.close(); journal.close(); }
}));
for (const fault of ["missing tree mapping", "missing branch mapping", "aliased conversations", "matching forged manifests"] as const) {
  test(`copied upgrade: public receipt corruption rejects ${fault} without advancing cutover`, () => using(async f => {
    const plan = prepareCopiedUpgrade(f.bytes, f.manifest, f.expected, bridge);
    const checkpoint = plan.checkpoint(f.controller);
    const imported = await f.controller.begin(checkpoint.revision, {
      async copy() { return { sourceDigest: plan.sourceSHA256, receiptHash: plan.request.importHash }; },
      importCopied: () => plan.importCopied(f.base.root, () => f.owner.assert(), context),
    });
    await f.base.root.commit(async tx => {
      const doc = await tx.doc(LegacyTreeImportManifest, f.base.root.id);
      const binding = doc.binding!;
      if (fault === "missing tree mapping") binding.entries = [];
      else if (fault === "missing branch mapping") binding.branches[0]!.entries = [];
      else if (fault === "aliased conversations") binding.branches[1]!.engineConversationId = binding.branches[0]!.engineConversationId;
      else {
        // Both receipt surfaces agree, but point one source at a different real entry.
        const branch = binding.branches[0]!;
        const mapped = branch.entries[0]!;
        mapped.durableEntryId = branch.entries[1]!.durableEntryId;
        binding.entries.find(entry => entry.sourceEntryId === mapped.sourceEntryId)!.durableEntryId = mapped.durableEntryId;
        (await tx.doc(LegacyImportManifest, f.base.root.id)).binding = json(branch);
      }
    }, context);
    const before = f.controller.inspect();
    await expect(f.controller.verify(imported.revision, () => plan.verify(f.base.harness, f.base.root.id, context))).rejects.toThrow();
    expect(f.controller.inspect()).toEqual(before);
    expect(f.controller.rollback(imported.revision).writer).toBe("legacy");
    expect((await f.base.root.commit(tx => tx.scanConversations({}, 100), context)).items).toHaveLength(2);
    expect(f.base.host.modelCalls + f.base.host.effects + f.base.host.credentialLookups).toBe(0);
  }));
}
test("copied upgrade: digest/provenance/context failures precede every journal/import write", () => using(async f => {
  const before = await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context);
  for (const patch of [{ expectedSourceSHA256: "0".repeat(64) }, { pending: 1 }, { sourceCopied: false },
    { hostBranchBindings: {} }, { hostBranchBindings: Object.fromEntries(Object.entries(f.host.hostBranchBindings).map(([k, v]) => [k, { ...v, hostBaseline: "invented" }])) }]) {
    const manifest = Buffer.from(JSON.stringify({ ...f.host, ...patch }));
    expect(() => prepareCopiedUpgrade(f.bytes, manifest, { ...f.expected, manifestSHA256: sha(manifest) }, bridge)).toThrow();
    expect(f.controller.inspect()).toBeNull();
  }
  expect(() => prepareCopiedUpgrade(f.bytes, f.manifest, { ...f.expected, sourceSHA256: "0".repeat(64) }, bridge)).toThrow();
  expect(() => prepareCopiedUpgrade(f.bytes, f.manifest, { ...f.expected, manifestSHA256: "0".repeat(64) }, bridge)).toThrow();
  expect(await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context)).toEqual(before);
}));
