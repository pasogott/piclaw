import type { CanonicalJsonValue } from "../../contracts/common.js";
import { hashCanonicalRequest } from "../../contracts/common.js";
import type {
  CommitDraftRequest,
  CommitServiceNoticeRequest,
  TimelineDraftStore,
} from "../../contracts/timeline-draft-store.js";
import type { InMemoryEffectPayloadResolver } from "../in-memory-payload-resolver.js";
import {
  runParameterisedContractSuite,
  type ContractCaseResult,
  type ContractSubjectFactory,
  type ContractTestContext,
  type ParameterisedContractCase,
} from "../contract-suite.js";
import type { PlannedFault } from "../fault-plan.js";

export interface TimelineDraftContractRow {
  readonly rowId: number;
  readonly content: string;
  readonly threadId: number | null;
  readonly terminal: boolean;
}

export interface TimelineDraftContractSubject {
  readonly store: TimelineDraftStore;
  readonly payloads: InMemoryEffectPayloadResolver;
  bindDraftMedia(operationId: string): Promise<number> | number;
  inspectRow(rowId: number): TimelineDraftContractRow | null;
  countTimelineRows(): number;
}

export async function defineTimelineDraftStoreContract(
  factory: ContractSubjectFactory<TimelineDraftContractSubject>,
  createContext: (faults?: readonly PlannedFault[]) => ContractTestContext,
): Promise<readonly ContractCaseResult[]> {
  const normal = await runParameterisedContractSuite(factory, timelineCases, () => createContext());
  const crash = await runParameterisedContractSuite(factory, timelineCrashCases, () => createContext([
    { point: "effect_then_lost_acknowledgement", occurrence: 2 },
  ]));
  return Object.freeze([...normal, ...crash]);
}

const timelineCases: readonly ParameterisedContractCase<TimelineDraftContractSubject>[] = [
  {
    name: "EF-S03-C1 duplicate equal draft revision returns original write",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const request = draftRequest("draft-c1", 1);
      const first = await subject.store.commitDraft(request);
      const duplicate = await subject.store.commitDraft(request);
      assert(first.ok && duplicate.ok && first.value.rowId === duplicate.value.rowId, "equal duplicate must return original write");
      const conflict = await subject.store.commitDraft(withRequestHash({ ...request, contentRef: "content:two" }));
      assert(!conflict.ok && conflict.error._tag === "idempotency_conflict", "conflicting duplicate must fail");
      assert(subject.countTimelineRows() === 1, "duplicates must not create another row");
    },
  },
  {
    name: "EF-S03-C2 conflicting or stale revision creates no row",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const current = await subject.store.commitDraft(draftRequest("draft-c2-current", 2));
      assert(current.ok, "current revision must commit");
      const stale = await subject.store.commitDraft(draftRequest("draft-c2-stale", 1));
      assert(!stale.ok && stale.error._tag === "stale_revision", "unseen stale revision must fail");
      assert(subject.countTimelineRows() === 1, "stale revision must not create a row");
    },
  },
  {
    name: "EF-S03-C3 replacement preserves row ownership and thread association",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const firstRequest = draftRequest("draft-c3-r1", 1, { threadId: 41 });
      const first = await subject.store.commitDraft(firstRequest);
      assert(first.ok, "first revision must commit");
      const replacementRequest = draftRequest("draft-c3-r2", 2, {
        mode: "replace", existingRowId: first.value.rowId, threadId: 41, contentRef: "content:two",
      });
      const replacement = await subject.store.commitDraft(replacementRequest);
      assert(replacement.ok && replacement.value.rowId === first.value.rowId, "replacement must retain row ownership");
      const row = subject.inspectRow(first.value.rowId);
      assert(row?.threadId === 41 && row.content === "draft two", "replacement must retain thread and update current content");
      const replayOld = await subject.store.commitDraft(firstRequest);
      assert(replayOld.ok && replayOld.value.revision === 1, "known old revision must replay original result");
      assert(subject.inspectRow(first.value.rowId)?.content === "draft two", "old replay must not rewrite current content");
      const artifacts = await subject.store.getOperationArtifacts("operation-1");
      assert(artifacts.ok && artifacts.value.draftRows.length === 1 && artifacts.value.draftRows[0].revision === 2, "artifacts must expose latest revision per kind");
    },
  },
  {
    name: "EF-S03-C4 service notice is idempotent by kind and source",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const request = noticeRequest("notice-c4");
      const first = await subject.store.commitServiceNotice(request);
      const duplicate = await subject.store.commitServiceNotice(request);
      assert(first.ok && duplicate.ok && first.value.rowId === duplicate.value.rowId, "notice duplicate must return original");
      const conflict = await subject.store.commitServiceNotice(withRequestHash({ ...request, contentRef: "content:two" }));
      assert(!conflict.ok && conflict.error._tag === "idempotency_conflict", "notice conflict must fail");
      assert(subject.countTimelineRows() === 1, "notice duplicate must not add a row");
    },
  },
  {
    name: "EF-S03-C5 invalid content blocks are rejected",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      subject.payloads.putJson("blocks:invalid", [{ type: "text" }, "not-an-object"]);
      subject.payloads.putJson("blocks:reserved", [{ type: "restart_handoff" }]);
      for (const [key, ref] of [["invalid", "blocks:invalid"], ["reserved", "blocks:reserved"]] as const) {
        const result = await subject.store.commitDraft(draftRequest(`draft-c5-${key}`, 1, { contentBlocksRef: ref }));
        assert(!result.ok && result.error._tag === "invalid_content_blocks", "invalid/reserved blocks must be rejected");
      }
      assert(subject.countTimelineRows() === 0, "invalid blocks must not persist");
    },
  },
  {
    name: "EF-S03-C6 draft and notice rows remain non-terminal",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const mediaId = await subject.bindDraftMedia("operation-1");
      const draft = await subject.store.commitDraft(draftRequest("draft-c6", 1, { mediaIds: [mediaId] }));
      const notice = await subject.store.commitServiceNotice(noticeRequest("notice-c6"));
      assert(draft.ok && notice.ok, "draft and notice must commit");
      assert(subject.inspectRow(draft.value.rowId)?.terminal === false, "draft must remain non-terminal");
      assert(subject.inspectRow(notice.value.rowId)?.terminal === false, "notice must remain non-terminal");
      const artifacts = await subject.store.getOperationArtifacts("operation-1");
      assert(artifacts.ok && artifacts.value.mediaIds.includes(mediaId), "operation artifacts must retain operation-owned media");
    },
  },
];

const timelineCrashCases: readonly ParameterisedContractCase<TimelineDraftContractSubject>[] = [
  {
    name: "EF-S03-R01 committed replacement lost acknowledgement reconciles after restore",
    async run(fixture) {
      seedTimelinePayloads(fixture.subject.payloads);
      const first = await fixture.subject.store.commitDraft(draftRequest("draft-r01-r1", 1));
      assert(first.ok, "first revision must commit");
      const replacement = draftRequest("draft-r01-r2", 2, {
        mode: "replace", existingRowId: first.value.rowId, contentRef: "content:two",
      });
      const lost = await fixture.subject.store.commitDraft(replacement);
      assert(!lost.ok && lost.error.certainty === "unknown", "lost acknowledgement must report unknown");
      await fixture.crashAndRestore();
      const reconciled = await fixture.subject.store.commitDraft(replacement);
      assert(reconciled.ok && reconciled.value.rowId === first.value.rowId, "retry must recover committed replacement");
      assert(fixture.subject.countTimelineRows() === 1, "reconciliation must retain one current row");
    },
  },
];

export function seedTimelinePayloads(payloads: InMemoryEffectPayloadResolver): void {
  payloads.putText("content:one", "draft one");
  payloads.putText("content:two", "draft two");
  payloads.putJson("blocks:valid", [{ type: "text", text: "summary" }]);
}

function draftRequest(
  key: string,
  revision: number,
  patch: Partial<CommitDraftRequest> = {},
): CommitDraftRequest {
  const request: CommitDraftRequest = {
    effect: operationEffect(key),
    chatJid: "web:contract",
    draftKind: "assistant_progress",
    revision,
    mode: "insert",
    existingRowId: null,
    contentRef: "content:one",
    threadId: null,
    mediaIds: [],
    contentBlocksRef: "blocks:valid",
    writtenAt: `2026-08-12T00:00:${String(revision).padStart(2, "0")}.000Z`,
    ...patch,
  };
  return withRequestHash(request);
}

function noticeRequest(key: string): CommitServiceNoticeRequest {
  return withRequestHash({
    effect: nullableEffect(key),
    chatJid: "web:contract",
    sourceId: "restart-source-1",
    noticeKind: "restart",
    contentRef: "content:one",
    contentBlocksRef: "blocks:valid",
    writtenAt: "2026-08-12T00:01:00.000Z",
  });
}

function operationEffect(idempotencyKey: string) {
  return { ...nullableEffect(idempotencyKey), operationId: "operation-1" };
}

function nullableEffect(idempotencyKey: string) {
  return {
    idempotencyKey,
    requestHash: "",
    operationId: null,
    sourceSeq: null,
    provenanceRef: "contract-suite",
    redactionClass: "private" as const,
  };
}

function withRequestHash<T extends { effect: { requestHash: string } }>(request: T): T {
  return { ...request, effect: { ...request.effect, requestHash: hashCanonicalRequest(request as unknown as CanonicalJsonValue) } };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
