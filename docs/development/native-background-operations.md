# Native background operation policy

The immutable policy, per-input SDK quota and initial granted add-on admission path are implemented. `AgentPool.prepareAddonOperation()` derives authority from the persisted add-on owner and current host grant, publishes a private context, and composes the accepted source/binding/budget identity. It starts no model or tool. Background execution remains explicitly blocked until qualified execution ports are installed. Dispatch, continuation, cancellation/settlement and Dream/add-on execution-caller migration remain unfinished under #1670.

## Immutable input and retry identity

`runtime/src/agent-pool/background-operation-contract.ts` defines the host-created payload:

- Stable Dream invocation or add-on operation/principal identity. The add-on owner's latest persisted queued event identifies an explicit input sequence; status changes and mutable input-committed markers cannot mint another sequence.
- Exact provider/model/API, tool-name ceiling and maximum tool calls. Add-on grants require a finite limit; zero permits a model-only result. Dream can retain an explicitly uncapped host policy.
- Work and parent-work identities, original admission time and absolute expiry.
- Prompt/instruction hashes, with the full text kept only in the private payload.

Construction copies and freezes values, canonicalises tool order and rejects duplicate names, malformed fields, getters, unknown versions and changed content. Decoding does not repair an unsupported snapshot.

The source ID includes stable caller ownership. Grant revision/target, model, prompt, instructions, tools, budget ancestry and deadline are execution choices: changing them conflicts with the same source instead of allocating another operation. ACK/restart repair cannot renew expiry or widen a grant. Physical model identity is exact; no provider/model/API fallback is allowed.

Explicit continuation creates another accepted source while keeping the same stable operation-context key. Per-source quota is kept separately; it cannot reset an older input's claims. The current admission port deliberately rejects unqualified continuation into an existing context.

These values describe accepted intent. Current operator grants, model approval, parent budget and source ownership still require host validation. Do not deserialize a policy from a model/browser and treat it as permission.

## Public SDK binding and quota

`runtime/durable-engine/src/host-background-policy.ts` uses `app.background-policy`, a conversation-scoped, latest-history, initial-fork SDK document. The schema ownership contract declares its Core owner. It adds no physical table or migration.

Each source-keyed document family member stores its input/hash binding and at most100 finite-limit tool claims. It does not duplicate the prompt/instructions or establish an effect receipt. An explicitly uncapped policy stores no unbounded claim list.

The allocation transaction creates a fresh ownerless, unforked context, configures its exact agent model/tools/instructions and binds the policy after host authorisation. The exact `ConversationRecord` returned by that transaction proves creation: the SDK forbids table reads after its first table write. Never replace that record with a caller-supplied freshness flag. Same-policy re-entry preserves quota. Changed configuration or binding fails. Forks begin unbound and cannot inherit the parent's grant.

A before-intent claim verifies actual public SDK task, assistant and pending live-slot evidence. SDK task IDs distinguish calls; provider call IDs may legitimately repeat across rounds. Re-entering one task after a lost ACK spends no extra call. Parallel tasks contend inside public SDK commits, so one remaining slot permits one effect. Oversized call identities cannot expand the bounded quota document.

A quota claim never authorises resending a tool. Keep the SDK tool's existing safe/unsafe replay semantics and uncertain-effect receipts. Passive recovery/terminal settlement must remain available after expiry or revocation; do not install live execution approval as a general bootstrap-read gate.

## Model and effect fences

The pinned SDK treats a thrown generation `beforeRequest` hook as a reported hook failure. It can continue the model request. That hook cannot serve as an admission fence.

Production wiring must enforce policy through the existing host model bridge's source capture, request accounting and post-auth checks, and recheck current authority at actual tool effect boundaries after awaits. Before-tool quota checks are an additional boundary, not a replacement for those effect checks.

The component fixture uses a public awaited header transform to exercise model refusal. That fixture is not an atomic post-auth dispatch proof and does not qualify production grants or an AgentPool caller.

## Initial admission and recovery

The sole application SDK owner publishes `app.background-contexts`; these private identities are separate from public chat routes and session controls. A fsynced immutable payload precedes metadata publication. EF-S01 accept/claim, native correlation and operation-budget ancestry then share one host transaction. A failed binding insert rolls back that whole host frame; the staged empty context and its payload remain for exact reopen/retry. They grant no execution.

Same-input admission reuses the context/source/deadline, including after the compatibility owner replaces its mutable text with a committed-input marker. Missing original bytes are never reconstructed from that marker. Fresh grants and budget ancestry are checked; an existing public/imported binding cannot be reparented as a private context.

Read-only recovery proves the private manifest, policy family and immutable bytes without applying live grant permission. A revoked operation can be inspected/reopened while an unrelated ordinary chat continues. New spending/effect admission still requires current permission.

Complete recovery-unit capture includes `native-background-input` references from policy families, even for staged contexts without an accepted source. It validates the policy/hash/owner/content binding; missing or modified input fails without a published manifest. No private source or payload is inferred from a filename alone.

## Required execution integration

Before marking #1670 complete:

1. Derive policy from trusted Dream/add-on records and current grants. Preserve the original absolute deadline, parent ancestry and exact model approval on retry.
2. Extend the implemented private fresh-context/source publication to qualified dispatch and explicit continuation. Keep private contexts out of public chat targets, web admission and session controls; do not fabricate a web user message or branch.
3. Compose EF-S01 acceptance/claim, native binding and accounting ancestry on the existing application store. Reuse exact source/request identities after lost ACK. A staged empty context cannot grant execution.
4. Extend exact controller recovery and immutable binding checks for these private contexts. Unknown tasks remain denied. Revoked/expired work must not block passive inspection of unrelated chats or be replayed as a new run.
5. Install quota/model/effect fences with live grant revalidation. Complete capped request accounting without weakening existing budget denials. Preserve cancellation and unsafe tool uncertainty.
6. Settle private results through existing SDK answers and EF-S02, without a second result-cache authority. Retain the implemented recovery closure for active and staged background payloads.
7. Migrate Dream and granted add-on callers, including deterministic refresh, descriptor-bound lock ownership, cancellation, restart and source-owned cleanup. An uncertain still-running operation must retain its waiter/ownership; releasing a Dream lease while that work can still mutate notes is unsafe.
8. Qualify actual native AgentPool callers with a synthetic provider, grants/tool ceilings, budget ancestry, deadlines, revocation, cancellation, same-ID lost ACK/reopen and no repeated effects. Component tests alone cannot establish this integration.

## Component evidence

- `runtime/test/agent-pool/background-operation-contract.test.ts`: immutable data, canonical owner identity, content/configuration hashes, policy conflicts, physical model identity and absolute deadlines.
- Existing registered `qualification/pi-durable-130/host-controller.test.ts`, filter `^background policy SDK:`: actual SDK task quotas, concurrent calls, forged identity, revocation, expiry, configuration/API mismatch, repeated provider call IDs and a paused disk reopen with same-input replay. A deliberate second-input probe checks retained quota; it does not authorise production admission of another primary in a private one-operation context.
- Existing default-factory cases `native-addon-admission`, `native-addon-admission-rollback`, `native-addon-admission-overlap` and `native-addon-admission-rejected`: real native pool admission/reopen, private visibility, grant and ancestry refusal, shared-store rollback and complete paused recovery. Admission itself makes no model call; one unrelated ordinary request proves revoked private work does not block it.
- Removed-quota and removed-deadline counterfactuals produce real SDK failures; source is restored byte-exact afterwards.

No full suite, live database/configuration/credential access, deployment, restart, retention schedule, restore promotion or new UI pattern is implied. See [the current runner boundary](native-runner-boundary.md) and [complete recovery unit](native-recovery-unit.md).
