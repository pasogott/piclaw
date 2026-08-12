import type { CanonicalJsonValue } from "../../contracts/common.js";
import { hashCanonicalRequest } from "../../contracts/common.js";
import type {
  BindOperationMediaRequest,
  CreateMediaRequest,
  DeleteMediaIfUnreferencedRequest,
  MediaRef,
  OperationMediaRole,
  OperationMediaStore,
} from "../../contracts/operation-media-store.js";
import type { InMemoryEffectPayloadResolver } from "../in-memory-payload-resolver.js";
import {
  runParameterisedContractSuite,
  type ContractCaseResult,
  type ContractSubjectFactory,
  type ContractTestContext,
  type ParameterisedContractCase,
} from "../contract-suite.js";
import type { PlannedFault } from "../fault-plan.js";

export interface OperationMediaContractSubject {
  readonly store: OperationMediaStore;
  readonly payloads: InMemoryEffectPayloadResolver;
  inspectStoredBytes(mediaId: number): Uint8Array | null;
  addMessageReference(mediaId: number): void;
  addOutboxReference(mediaId: number): void;
  beforeDeleteTransactionOnce(run: () => void): void;
  hasUploadMapping(mediaId: number): boolean;
  indexTextMedia(mediaId: number, expectedTerm: string): boolean;
  countMediaRows(): number;
}

export async function defineOperationMediaStoreContract(
  factory: ContractSubjectFactory<OperationMediaContractSubject>,
  createContext: (faults?: readonly PlannedFault[]) => ContractTestContext,
): Promise<readonly ContractCaseResult[]> {
  const normal = await runParameterisedContractSuite(factory, mediaCases, () => createContext());
  const crash = await runParameterisedContractSuite(factory, mediaCrashCases, () => createContext([
    { point: "effect_then_lost_acknowledgement", occurrence: 1 },
  ]));
  return Object.freeze([...normal, ...crash]);
}

const mediaCases: readonly ParameterisedContractCase<OperationMediaContractSubject>[] = [
  {
    name: "EF-S04-C1 equal upload ID and digest returns original media reference",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c1", "equal upload");
      const request = mediaRequest(subject, "media-c1", "upload-c1", "data:c1");
      const first = await subject.store.create(request);
      const duplicate = await subject.store.create(request);
      assert(first.ok && duplicate.ok, "equal upload must replay under its semantic key");
      assert(first.value.mediaId === duplicate.value.mediaId, "equal upload must return original reference");
      assert(subject.countMediaRows() === 1, "equal upload must create one blob");
    },
  },
  {
    name: "EF-S04-C2 committed media replay does not require payload availability",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c2-replay", "durable upload");
      const request = mediaRequest(subject, "media-c2-replay", "upload-c2-replay", "data:c2-replay");
      const first = await subject.store.create(request);
      assert(first.ok, "media must commit before payload removal");
      subject.payloads.delete(request.dataRef);
      const replay = await subject.store.create(request);
      assert(replay.ok && replay.value.mediaId === first.value.mediaId, "exact replay must return persisted media without payload");
      assert(subject.countMediaRows() === 1, "replay without payload must not add a blob");
    },
  },
  {
    name: "EF-S04-C3 conflicting digest is rejected",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c2", "digest one");
      seedMedia(subject.payloads, "data:c2-other", "digest two");
      const first = await subject.store.create(mediaRequest(subject, "media-c2-a", "upload-c2", "data:c2"));
      assert(first.ok, "first upload must commit");
      const conflict = await subject.store.create(mediaRequest(subject, "media-c2-b", "upload-c2", "data:c2-other"));
      assert(!conflict.ok && conflict.error._tag === "digest_mismatch", "same upload with different digest must fail");
      assert(subject.countMediaRows() === 1, "digest conflict must not add a blob");
    },
  },
  {
    name: "EF-S04-C4 equal digest with changed upload semantics is rejected",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c3", "semantic conflict");
      const first = await subject.store.create(mediaRequest(subject, "media-c3-a", "upload-c3", "data:c3"));
      assert(first.ok, "first upload must commit");
      const conflict = await subject.store.create(mediaRequest(
        subject, "media-c3-b", "upload-c3", "data:c3", "application/octet-stream", { filename: "changed.bin" },
      ));
      assert(!conflict.ok && conflict.error._tag === "idempotency_conflict", "same digest with changed semantics must conflict");
      assert(subject.countMediaRows() === 1, "semantic conflict must not add a blob");
    },
  },
  {
    name: "EF-S04-C5 operation binding is unique by operation media and role",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c4", "binding");
      const created = await subject.store.create(mediaRequest(subject, "media-c4", "upload-c4", "data:c4"));
      assert(created.ok, "media must commit");
      const request = bindingRequest("bind-c4", created.value.mediaId, "draft");
      const first = await subject.store.bindToOperation(request);
      const duplicate = await subject.store.bindToOperation(request);
      assert(first.ok && duplicate.ok && first.value.boundAt === duplicate.value.boundAt, "equal binding must return original");
      const listed = await subject.store.listForOperation("operation-1");
      assert(listed.ok && listed.value.length === 1, "binding uniqueness must expose one media ref");
    },
  },
  {
    name: "EF-S04-C6 changed binding semantics conflict",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c5", "binding conflict");
      const created = await subject.store.create(mediaRequest(subject, "media-c5", "upload-c5", "data:c5"));
      assert(created.ok, "media must commit");
      const first = await subject.store.bindToOperation(bindingRequest("bind-c5-a", created.value.mediaId, "draft"));
      assert(first.ok, "first binding must commit");
      const conflict = await subject.store.bindToOperation(bindingRequest(
        "bind-c5-b", created.value.mediaId, "draft", { boundAt: "2026-08-12T00:02:00.000Z" },
      ));
      assert(!conflict.ok && conflict.error._tag === "binding_conflict", "changed binding semantics must conflict");
    },
  },
  {
    name: "EF-S04-C7 concurrent binding decisions are atomic",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c7-bind", "concurrent binding");
      const created = await subject.store.create(mediaRequest(subject, "media-c7-bind", "upload-c7-bind", "data:c7-bind"));
      assert(created.ok, "media must commit before concurrent binding");
      const equal = bindingRequest("bind-c7-equal", created.value.mediaId, "draft");
      const [equalFirst, equalSecond] = await Promise.all([
        subject.store.bindToOperation(equal), subject.store.bindToOperation(equal),
      ]);
      assert(equalFirst.ok && equalSecond.ok && equalFirst.value.boundAt === equalSecond.value.boundAt, "concurrent equal binding must replay original");

      seedMedia(subject.payloads, "data:c7-conflict", "concurrent conflict");
      const conflicted = await subject.store.create(mediaRequest(subject, "media-c7-conflict", "upload-c7-conflict", "data:c7-conflict"));
      assert(conflicted.ok, "second media must commit before conflicting binding");
      const base = bindingRequest("bind-c7-first", conflicted.value.mediaId, "draft");
      const changed = bindingRequest("bind-c7-second", conflicted.value.mediaId, "draft", { boundAt: "2026-08-12T00:02:00.000Z" });
      const [first, second] = await Promise.all([
        subject.store.bindToOperation(base), subject.store.bindToOperation(changed),
      ]);
      assert(first.ok && !second.ok && second.error._tag === "binding_conflict", "changed concurrent binding must conflict deterministically");
      const listed = await subject.store.listForOperation("operation-1");
      assert(listed.ok && listed.value.length === 2, "concurrent binding races must retain one binding per media tuple");
    },
  },
  {
    name: "EF-S04-C8 stale request hash is rejected before mutation",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c6", "stale hash");
      const request = mediaRequest(subject, "media-c6", "upload-c6", "data:c6");
      const malformed = { ...request, filename: "mutated-after-hash.bin" };
      const result = await subject.store.create(malformed);
      assert(!result.ok && result.error._tag === "idempotency_conflict", "stale request hash must conflict");
      assert(subject.countMediaRows() === 0, "stale request hash must not write");
    },
  },
  {
    name: "EF-S04-C9 payload media type must match request content type",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c7", "typed as text", "text/plain");
      const result = await subject.store.create(mediaRequest(subject, "media-c7", "upload-c7", "data:c7", "application/octet-stream"));
      assert(!result.ok && result.error._tag === "unsupported_media", "payload media type mismatch must fail");
      assert(subject.countMediaRows() === 0, "payload media type mismatch must not write");
    },
  },
  {
    name: "EF-S04-C10 metadata reference requires JSON media type",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c8", "metadata carrier");
      subject.payloads.putText("metadata:c8", JSON.stringify({ source: "wrong media type" }), "text/plain");
      const result = await subject.store.create(mediaRequest(subject, "media-c8", "upload-c8", "data:c8", "application/octet-stream", {
        metadataRef: "metadata:c8",
      }));
      assert(!result.ok && result.error._tag === "unsupported_media", "metadata must be application/json");
      assert(subject.countMediaRows() === 0, "invalid metadata media type must not write");
    },
  },
  {
    name: "EF-S04-C11 missing media cannot be bound",
    async run({ subject }) {
      const result = await subject.store.bindToOperation(bindingRequest("bind-c9", 999, "draft"));
      assert(!result.ok && result.error._tag === "media_not_found", "missing media bind must fail");
    },
  },
  {
    name: "EF-S04-C12 compressed data round trips with stable digest",
    async run({ subject }) {
      const text = "compressible deterministic text ".repeat(100);
      seedMedia(subject.payloads, "data:c10", text, "text/plain");
      const created = await subject.store.create(mediaRequest(subject, "media-c10", "upload-c10", "data:c10", "text/plain"));
      assert(created.ok, "compressible media must commit");
      const stored = subject.inspectStoredBytes(created.value.mediaId);
      assert(stored && new TextDecoder().decode(stored) === text, "stored compressed data must round trip");
      const read = await subject.store.get(created.value);
      assert(read.ok && read.value?.ref.sha256 === created.value.sha256, "round trip must preserve digest");
    },
  },
  {
    name: "EF-S04-C13 text-index maintenance follows media lifecycle",
    async run({ subject }) {
      seedMedia(subject.payloads, "data:c11", "unique-index-token", "text/plain");
      const created = await subject.store.create(mediaRequest(subject, "media-c11", "upload-c11", "data:c11", "text/plain"));
      assert(created.ok, "text media must commit");
      assert(subject.indexTextMedia(created.value.mediaId, "unique-index-token"), "message attachment must index media text");
    },
  },
  {
    name: "EF-S04-C14 reference arriving at delete boundary preserves upload identity",
    async run({ subject }) {
      const referenced = await createNamed(subject, "boundary-reference");
      subject.beforeDeleteTransactionOnce(() => subject.addMessageReference(referenced.mediaId));
      const result = await subject.store.deleteIfUnreferenced(deleteRequest("delete-c12-boundary", referenced));
      assert(!result.ok && result.error._tag === "still_referenced", "boundary reference must block deletion");
      const retained = await subject.store.get(referenced);
      assert(retained.ok && retained.value?.ref.mediaId === referenced.mediaId, "upload mapping and media must remain intact");
      assert(subject.hasUploadMapping(referenced.mediaId), "upload identity mapping must remain intact");
    },
  },
  {
    name: "EF-S04-C15 orphan deletion is blocked by operation message or outbox reference",
    async run({ subject }) {
      const operation = await createNamed(subject, "operation");
      const bound = await subject.store.bindToOperation(bindingRequest("bind-c7", operation.mediaId, "draft"));
      assert(bound.ok, "operation media must bind");
      assertErrorTag(await subject.store.deleteIfUnreferenced(deleteRequest("delete-c7-operation", operation)), "still_referenced");

      const message = await createNamed(subject, "message");
      subject.addMessageReference(message.mediaId);
      assertErrorTag(await subject.store.deleteIfUnreferenced(deleteRequest("delete-c7-message", message)), "still_referenced");

      const outbox = await createNamed(subject, "outbox");
      subject.addOutboxReference(outbox.mediaId);
      assertErrorTag(await subject.store.deleteIfUnreferenced(deleteRequest("delete-c7-outbox", outbox)), "still_referenced");

      const orphan = await createNamed(subject, "orphan");
      const deleted = await subject.store.deleteIfUnreferenced(deleteRequest("delete-c7-orphan", orphan));
      assert(deleted.ok && deleted.value, "unreferenced media must delete");
      const absent = await subject.store.get(orphan);
      assert(absent.ok && absent.value === null, "deleted orphan must be absent");
    },
  },
];

const mediaCrashCases: readonly ParameterisedContractCase<OperationMediaContractSubject>[] = [
  {
    name: "EF-S04-R01 blob committed before binding reconciles after restore",
    async run(fixture) {
      seedMedia(fixture.subject.payloads, "data:r01", "crash blob");
      const request = mediaRequest(fixture.subject, "media-r01", "upload-r01", "data:r01");
      const lost = await fixture.subject.store.create(request);
      assert(!lost.ok && lost.error.certainty === "unknown", "lost create acknowledgement must be unknown");
      const traceBeforeRestore = fixture.inspectTrace();
      const idBeforeRestore = fixture.context.ids.nextId();
      await fixture.crashAndRestore();
      assert(fixture.inspectTrace().length === traceBeforeRestore.length, "pre-crash trace must survive restore");
      assert(fixture.context.ids.nextId() !== idBeforeRestore, "deterministic IDs must continue across restore");
      assert(!fixture.context.faults.hit("effect_then_lost_acknowledgement"), "consumed fault occurrence must remain consumed");
      const recovered = await fixture.subject.store.create(request);
      assert(recovered.ok, "create retry must recover committed blob");
      const listedBeforeBind = await fixture.subject.store.listForOperation("operation-1");
      assert(listedBeforeBind.ok && listedBeforeBind.value.length === 0, "restored blob must remain unbound");
      const bound = await fixture.subject.store.bindToOperation(bindingRequest("bind-r01", recovered.value.mediaId, "draft"));
      assert(bound.ok, "recovered blob can bind exactly once");
      assert(fixture.inspectTrace().length > traceBeforeRestore.length, "post-restore trace must append to prior observations");
      assert(fixture.subject.countMediaRows() === 1, "crash reconciliation must retain one blob");
    },
  },
];

async function createNamed(subject: OperationMediaContractSubject, name: string): Promise<MediaRef> {
  const ref = `data:c7:${name}`;
  seedMedia(subject.payloads, ref, name);
  const created = await subject.store.create(mediaRequest(subject, `media-c7-${name}`, `upload-c7-${name}`, ref));
  assert(created.ok, `${name} media must commit`);
  return created.value;
}

function seedMedia(payloads: InMemoryEffectPayloadResolver, ref: string, text: string, mediaType = "application/octet-stream"): void {
  payloads.putText(ref, text, mediaType);
}

function mediaRequest(
  subject: OperationMediaContractSubject,
  key: string,
  uploadId: string,
  dataRef: string,
  contentType = "application/octet-stream",
  patch: Partial<CreateMediaRequest> = {},
): CreateMediaRequest {
  const payload = subject.payloads.peek(dataRef);
  assert(payload, `missing seeded payload ${dataRef}`);
  return withRequestHash({
    effect: nullableEffect(key), uploadId, filename: `${uploadId}.dat`, contentType,
    byteLength: payload.byteLength, sha256: payload.sha256, dataRef,
    thumbnailRef: null, metadataRef: null, createdAt: "2026-08-12T00:00:00.000Z",
    ...patch,
  });
}

function bindingRequest(
  key: string,
  mediaId: number,
  role: OperationMediaRole,
  patch: Partial<BindOperationMediaRequest> = {},
): BindOperationMediaRequest {
  return withRequestHash({
    effect: operationEffect(key), mediaId, role, boundAt: "2026-08-12T00:01:00.000Z",
    ...patch,
  });
}

function deleteRequest(key: string, ref: MediaRef): DeleteMediaIfUnreferencedRequest {
  return withRequestHash({ effect: nullableEffect(key), mediaId: ref.mediaId, expectedSha256: ref.sha256 });
}

function operationEffect(idempotencyKey: string) {
  return { ...nullableEffect(idempotencyKey), operationId: "operation-1" };
}
function nullableEffect(idempotencyKey: string) {
  return { idempotencyKey, requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "contract-suite", redactionClass: "private" as const };
}
function withRequestHash<T extends { effect: { requestHash: string } }>(request: T): T {
  return { ...request, effect: { ...request.effect, requestHash: hashCanonicalRequest(request as unknown as CanonicalJsonValue) } };
}
function assertErrorTag(result: Awaited<ReturnType<OperationMediaStore["deleteIfUnreferenced"]>>, tag: string): void {
  assert(!result.ok && result.error._tag === tag, `expected ${tag}`);
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
