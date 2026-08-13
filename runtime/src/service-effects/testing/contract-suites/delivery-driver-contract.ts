import type { DeliveryAttempt, DeliveryDriver, DeliveryDriverError, DeliveryOutcome, DeliveryProviderDetail } from "../../contracts/delivery-driver.js";
import { runParameterisedContractSuite, type ContractCaseResult, type ContractSubjectFactory, type ContractTestContext, type ParameterisedContractCase } from "../contract-suite.js";

export interface DeliveryDriverContractSubject {
  readonly driver: DeliveryDriver;
  scriptOutcome(outcome: DeliveryOutcome): void;
  scriptError(error: DeliveryDriverError): void;
  scriptDelayed(outcome: DeliveryOutcome): { release(): void; started(): Promise<void> };
  countAttempts(): number;
  corruptPayload(kind: "ref" | "length" | "digest" | "mutable" | "semantic"): void;
  holdPayload(): { release(): void; started(): Promise<void> };
  throwValidatorOnce(): void;
  throwClassifierOnce(): void;
  mutateResolverBytesAfterReturn(): Promise<void>;
  observedPayloadBytes(): Uint8Array | null;
}

export function defineDeliveryDriverContract(
  factory: ContractSubjectFactory<DeliveryDriverContractSubject>,
  createContext: () => ContractTestContext,
): Promise<readonly ContractCaseResult[]> {
  return runParameterisedContractSuite(factory, cases, createContext);
}

const cases: readonly ParameterisedContractCase<DeliveryDriverContractSubject>[] = [
  {
    name: "EF-S06-C1 before-send failure reports not_applied",
    async run({ subject }) {
      subject.scriptError(error("transport_unavailable", "not_applied", true));
      const result = await subject.driver.deliver(request());
      assert(!result.ok && result.error.certainty === "not_applied", "before-send failure must be not_applied");
      assert(subject.countAttempts() === 1, "deliver must execute exactly one boundary attempt");
    },
  },
  {
    name: "EF-S06-C2 provider rejection and rate limit retain bounded certainty",
    async run({ subject }) {
      subject.scriptError(error("rejected", "not_applied", false));
      subject.scriptError(error("rate_limited", "not_applied", true, "2026-08-12T00:01:00.000Z"));
      const rejected = await subject.driver.deliver(request("delivery-rejected"));
      const limited = await subject.driver.deliver(request("delivery-limited"));
      assert(!rejected.ok && rejected.error._tag === "rejected" && rejected.error.certainty === "not_applied", "rejection must remain definite");
      assert(!limited.ok && limited.error._tag === "rate_limited" && limited.error.retryAfter !== undefined, "rate limit must preserve typed retry detail");
    },
  },
  {
    name: "EF-S06-C3 accepted then disconnected reports applied or unknown by driver capability",
    async run({ subject }) {
      subject.scriptError(error("transport_unavailable", "unknown", true));
      const lost = await subject.driver.deliver(request());
      assert(!lost.ok && lost.error.certainty === "unknown", "ambiguous post-dispatch throw must be unknown");
    },
  },
  {
    name: "EF-S06-C4 delayed receipt is deterministic",
    async run({ subject }) {
      const expected = outcome(detailFor(subject.driver.kind));
      const delayed = subject.scriptDelayed(expected);
      const pending = subject.driver.deliver(request());
      await delayed.started();
      assert(subject.countAttempts() === 1, "delayed attempt must start once");
      delayed.release();
      const result = await pending;
      assert(result.ok && result.value.detail.kind === subject.driver.kind, "delayed result must preserve provider detail");
    },
  },
  {
    name: "EF-S06-C5 abort before send and late abort remain distinct",
    async run({ subject }) {
      const before = new AbortController();
      before.abort();
      const pre = await subject.driver.deliver(request("delivery-pre-abort", before.signal));
      assert(!pre.ok && pre.error._tag === "aborted" && pre.error.certainty === "not_applied", "pre-abort must be not_applied");
      assert(subject.countAttempts() === 0, "pre-abort must not call transport");

      const late = new AbortController();
      const delayed = subject.scriptDelayed(outcome(detailFor(subject.driver.kind)));
      const pending = subject.driver.deliver(request("delivery-late-abort", late.signal));
      await delayed.started();
      late.abort();
      delayed.release();
      const accepted = await pending;
      assert(accepted.ok && accepted.value.certainty === "applied", "late abort cannot rewrite completed provider acceptance");
    },
  },
  {
    name: "EF-S06-C6 current driver omits unsupported reconciliation",
    run({ subject }) {
      assert(subject.driver.reconcile === undefined, "driver without a stable provider query must omit reconcile");
    },
  },
  {
    name: "EF-S06-C7 Web Push preserves zero all-known partial and all-failed counts",
    async run({ subject }) {
      if (subject.driver.kind !== "web_push") return;
      const variants = [
        [{ attempted: 0, sent: 0, removed: 0, failed: 0 }, "not_applied"],
        [{ attempted: 3, sent: 2, removed: 1, failed: 0 }, "applied"],
        [{ attempted: 3, sent: 1, removed: 0, failed: 2 }, "unknown"],
        [{ attempted: 2, sent: 0, removed: 0, failed: 2 }, "unknown"],
      ] as const;
      for (const [counts, certainty] of variants) {
        subject.scriptOutcome(outcome({ kind: "web_push", providerMessageId: null, counts }, certainty));
        const result = await subject.driver.deliver(request(`delivery-web-${certainty}-${counts.sent}`));
        assert(result.ok && result.value.certainty === certainty, "Web Push certainty must follow aggregate counts");
        assert(result.ok && result.value.detail.kind === "web_push" && JSON.stringify(result.value.detail.counts) === JSON.stringify(counts), "Web Push counts must be exact");
      }
    },
  },
  {
    name: "EF-S06-C8 malformed payload tuples never reach the boundary",
    async run({ subject }) {
      subject.scriptOutcome(outcome(detailFor(subject.driver.kind)));
      for (const kind of ["ref", "length", "digest", "mutable"] as const) {
        const before = subject.countAttempts(); subject.corruptPayload(kind);
        const result = await subject.driver.deliver(request(`delivery-payload-${kind}`));
        if (kind === "mutable") {
          assert(result.ok, "mutable resolver bytes must be defensively snapshotted");
        } else {
          assert(!result.ok && result.error._tag === "invalid_payload", "mismatched payload tuple must fail validation");
          assert(subject.countAttempts() === before, "invalid payload must not call boundary");
        }
      }
    },
  },
  {
    name: "EF-S06-C9 provider identity and detail shape are fenced",
    async run({ subject }) {
      const detail = detailFor(subject.driver.kind);
      const mismatched: DeliveryProviderDetail = detail.kind === "timeline_broadcast" ? { ...detail, eventId: "wrong" } : detail.kind === "wake_chat" ? { ...detail, wakeId: "wrong" } : { kind: "timeline_broadcast", providerMessageId: null, eventId: "delivery-identity-1" };
      subject.scriptOutcome(outcome(mismatched));
      const result = await subject.driver.deliver(request());
      assert(!result.ok && result.error.certainty === "unknown", "mismatched provider detail must become boundary fault");
    },
  },
  {
    name: "EF-S06-C10 malformed Web Push aggregate is rejected",
    async run({ subject }) {
      if (subject.driver.kind !== "web_push") return;
      subject.scriptOutcome(outcome({ kind: "web_push", providerMessageId: null, counts: { attempted: 1, sent: 1, removed: 0, failed: 1 } }));
      const result = await subject.driver.deliver(request());
      assert(!result.ok && result.error._tag === "transport_unavailable" && result.error.certainty === "unknown", "malformed aggregate must be boundary fault");
    },
  },
  {
    name: "EF-S06-C11 malformed classifier output becomes unknown transport failure",
    async run({ subject }) {
      subject.scriptError({ _tag: "rejected", certainty: "applied", retryable: false } as DeliveryDriverError);
      const result = await subject.driver.deliver(request());
      assert(!result.ok && result.error._tag === "transport_unavailable" && result.error.certainty === "unknown", "errors cannot claim applied certainty");
    },
  },
  {
    name: "EF-S06-C12 malformed requests are rejected before boundary",
    async run({ subject }) {
      const malformed = [
        { ...request(), outboxId: "" }, { ...request(), idempotencyKey: "" }, { ...request(), payloadRef: "" }, { ...request(), deliveryIdentity: "" },
        null, 1, { ...request(), signal: undefined }, { ...request(), signal: { aborted: "no" } },
        { ...request(), destinationRef: "   " }, { ...request(), attempt: Number.NaN }, { ...request(), attempt: 1.5 }, { ...request(), attempt: Number.MAX_SAFE_INTEGER + 1 },
      ];
      for (const value of malformed) {
        const before = subject.countAttempts(); const result = await subject.driver.deliver(value as DeliveryAttempt);
        assert(!result.ok && (result.error._tag === "invalid_payload" || result.error._tag === "destination_missing"), "malformed request must be bounded");
        assert(subject.countAttempts() === before, "malformed request must not call boundary");
      }
    },
  },
  {
    name: "EF-S06-C13 semantic payload rejection does not consume attempt",
    async run({ subject }) {
      subject.corruptPayload("semantic"); const before = subject.countAttempts();
      const result = await subject.driver.deliver(request());
      assert(!result.ok && result.error._tag === "invalid_payload" && subject.countAttempts() === before, "semantic policy must reject before effect");
    },
  },
  {
    name: "EF-S06-C14 abort during payload resolution consumes no attempt",
    async run({ subject }) {
      const controller = new AbortController(); const hold = subject.holdPayload();
      const pending = subject.driver.deliver(request("delivery-held", controller.signal)); await hold.started(); controller.abort(); hold.release();
      const result = await pending;
      assert(!result.ok && result.error._tag === "aborted" && subject.countAttempts() === 0, "abort after awaited resolution must remain pre-effect");
    },
  },
  {
    name: "EF-S06-C15 injected validator and classifier faults stay bounded",
    async run({ subject }) {
      subject.throwValidatorOnce(); const validation = await subject.driver.deliver(request());
      assert(!validation.ok && validation.error._tag === "invalid_payload" && validation.error.certainty === "not_applied", "validator throw must be bounded pre-effect");
      subject.throwClassifierOnce(); subject.scriptError({ _tag: "transport_unavailable", certainty: "unknown", retryable: true });
      const classifier = await subject.driver.deliver(request("delivery-classifier"));
      assert(!classifier.ok && classifier.error._tag === "transport_unavailable" && classifier.error.certainty === "unknown", "classifier throw must be bounded unknown");
    },
  },
  {
    name: "EF-S06-C16 malformed outcome and classifier matrix stays bounded while certainty is derived",
    async run({ subject }) {
      const base = outcome(detailFor(subject.driver.kind));
      const malformedOutcomes = [
        { ...base, acceptedAt: "not-an-instant" }, { ...base, acceptedAt: 3 },
        { ...base, receiptRef: "" }, { ...base, receiptRef: 3 },
        { ...base, detail: null }, { ...base, detail: "bad" },
        { ...base, detail: { ...base.detail, providerMessageId: "" } },
      ] as unknown as DeliveryOutcome[];
      for (const malformed of malformedOutcomes) {
        subject.scriptOutcome(malformed); const result = await subject.driver.deliver(request());
        assert(!result.ok && result.error.certainty === "unknown", "malformed provider outcome must be bounded unknown");
      }
      const malformedErrors = [
        { _tag: "unknown_tag", certainty: "not_applied", retryable: false },
        { _tag: "rejected", certainty: "not_applied", retryable: true },
        { _tag: "aborted", certainty: "unknown", retryable: false },
        { _tag: "invalid_payload", certainty: "not_applied", retryable: true },
        { _tag: "destination_missing", certainty: "not_applied", retryable: true },
        { _tag: "rate_limited", certainty: "not_applied", retryable: true },
        { _tag: "rate_limited", certainty: "not_applied", retryable: true, retryAfter: "bad" },
        { _tag: "timeout", certainty: "unknown", retryable: true, retryAfter: "2026-08-12T00:01:00.000Z" },
      ] as unknown as DeliveryDriverError[];
      for (const malformed of malformedErrors) {
        subject.scriptError(malformed); const result = await subject.driver.deliver(request("delivery-malformed-classifier"));
        assert(!result.ok && result.error._tag === "transport_unavailable" && result.error.certainty === "unknown", "malformed classifier output must become bounded unknown");
      }
      subject.scriptOutcome({ ...base, certainty: "unknown" });
      const derived = await subject.driver.deliver(request("delivery-derived-certainty"));
      assert(derived.ok && derived.value.certainty === (derived.value.detail.kind === "web_push" ? derived.value.certainty : "applied"), "success certainty must be derived from provider detail");
    },
  },
  {
    name: "EF-S06-C17 mutable resolver bytes are defensively snapshotted",
    async run({ subject }) {
      subject.scriptOutcome(outcome(detailFor(subject.driver.kind)));
      const mutation = subject.mutateResolverBytesAfterReturn();
      const result = await subject.driver.deliver(request("delivery-mutable-snapshot")); await mutation;
      const observed = subject.observedPayloadBytes();
      assert(result.ok && observed !== null && new TextDecoder().decode(observed) === "safe payload", "boundary must observe verified defensive snapshot");
    },
  },
  {
    name: "EF-S06-R01 unknown acceptance remains stateless across restore",
    async run(fixture) {
      fixture.subject.scriptError(error("transport_unavailable", "unknown", true));
      const lost = await fixture.subject.driver.deliver(request("delivery-crash-oracle"));
      assert(!lost.ok && lost.error.certainty === "unknown" && fixture.subject.countAttempts() === 1, "lost provider response must remain unknown after one attempt");
      const beforeTrace = fixture.inspectTrace();
      const restored = await fixture.crashAndRestore();
      assert(restored.countAttempts() === 1, "restore must not start or reconcile a second attempt");
      assert(restored.driver.reconcile === undefined, "stateless current drivers cannot invent reconciliation");
      assert(fixture.inspectTrace().length >= beforeTrace.length, "claimed trace-preserving runtimes must retain prior observations");
    },
  },
];

export function request(outboxId = "delivery-1", signal: AbortSignal = new AbortController().signal): DeliveryAttempt {
  return { outboxId, idempotencyKey: `key-${outboxId}`, payloadRef: "payload:delivery", destinationRef: "destination:one", deliveryIdentity: "delivery-identity-1", attempt: 1, signal };
}

export function outcome(detail: DeliveryProviderDetail, certainty: DeliveryOutcome["certainty"] = "applied"): DeliveryOutcome {
  return { certainty, acceptedAt: "2026-08-12T00:00:00.000Z", receiptRef: null, detail };
}

export function detailFor(kind: DeliveryDriver["kind"]): DeliveryProviderDetail {
  switch (kind) {
    case "timeline_broadcast": return { kind, providerMessageId: null, eventId: "delivery-identity-1" };
    case "channel_delivery": return { kind, providerMessageId: null };
    case "web_push": return { kind, providerMessageId: null, counts: { attempted: 1, sent: 1, removed: 0, failed: 0 } };
    case "pushover": return { kind, providerMessageId: null };
    case "wake_chat": return { kind, providerMessageId: null, wakeId: "delivery-identity-1" };
  }
}

function error(tag: DeliveryDriverError["_tag"], certainty: DeliveryDriverError["certainty"], retryable: boolean, retryAfter?: string): DeliveryDriverError {
  return Object.freeze({ _tag: tag, certainty, retryable, ...(retryAfter ? { retryAfter } : {}) });
}

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
