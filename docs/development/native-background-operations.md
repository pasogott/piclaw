# Native background operation policy

The immutable policy and SDK quota components are implemented. Production admission, private-context routing and Dream/add-on caller migration remain unfinished under #1670. No native background execution API is enabled by these components.

## Immutable input and retry identity

`runtime/src/agent-pool/background-operation-contract.ts` defines the host-created payload:

- Stable Dream invocation or add-on operation/principal identity.
- Exact provider/model/API, tool-name ceiling and maximum tool calls. Add-on grants require a finite limit; zero permits a model-only result. Dream can retain an explicitly uncapped host policy.
- Work and parent-work identities, original admission time and absolute expiry.
- Prompt/instruction hashes, with the full text kept only in the private payload.

Construction copies and freezes values, canonicalises tool order and rejects duplicate names, malformed fields, getters, unknown versions and changed content. Decoding does not repair an unsupported snapshot.

The source ID includes stable caller ownership. Grant revision/target, model, prompt, instructions, tools, budget ancestry and deadline are execution choices: changing them conflicts with the same source instead of allocating another operation. ACK/restart repair cannot renew expiry or widen a grant. Physical model identity is exact; no provider/model/API fallback is allowed.

These values describe accepted intent. Current operator grants, model approval, parent budget and source ownership still require host validation. Do not deserialize a policy from a model/browser and treat it as permission.

## Public SDK binding and quota

`runtime/durable-engine/src/host-background-policy.ts` uses `app.background-policy`, a conversation-scoped, latest-history, initial-fork SDK document. The schema ownership contract declares its Core owner. It adds no physical table or migration.

The document stores a source/hash binding and at most100 finite-limit tool claims. It does not duplicate the prompt/instructions or establish an effect receipt. An explicitly uncapped policy stores no unbounded claim list.

The allocation transaction must create a fresh ownerless, unforked context, configure its exact agent model/tools/instructions and bind the policy after host authorisation. Same-policy re-entry preserves quota. Changed configuration or binding fails. Forks begin unbound and cannot inherit the parent's grant.

A before-intent claim verifies actual public SDK task, assistant and pending live-slot evidence. SDK task IDs distinguish calls; provider call IDs may legitimately repeat across rounds. Re-entering one task after a lost ACK spends no extra call. Parallel tasks contend inside public SDK commits, so one remaining slot permits one effect. Oversized call identities cannot expand the bounded quota document.

A quota claim never authorises resending a tool. Keep the SDK tool's existing safe/unsafe replay semantics and uncertain-effect receipts. Passive recovery/terminal settlement must remain available after expiry or revocation; do not install live execution approval as a general bootstrap-read gate.

## Model and effect fences

The pinned SDK treats a thrown generation `beforeRequest` hook as a reported hook failure. It can continue the model request. That hook cannot serve as an admission fence.

Production wiring must enforce policy through the existing host model bridge's source capture, request accounting and post-auth checks, and recheck current authority at actual tool effect boundaries after awaits. Before-tool quota checks are an additional boundary, not a replacement for those effect checks.

The component fixture uses a public awaited header transform to exercise model refusal. That fixture is not an atomic post-auth dispatch proof and does not qualify production grants or an AgentPool caller.

## Required production integration

Before marking #1670 complete:

1. Derive policy from trusted Dream/add-on records and current grants. Preserve the original absolute deadline, parent ancestry and exact model approval on retry.
2. Publish a private fresh context through the single application SDK owner, with durable source-to-context identity. Keep private contexts out of public chat targets, web admission and session controls; do not fabricate a web user message or branch.
3. Compose EF-S01 acceptance/claim, native binding and accounting ancestry on the existing application store. Reuse exact source/request identities after lost ACK. A staged empty context cannot grant execution.
4. Extend exact controller recovery and immutable binding checks for these private contexts. Unknown tasks remain denied. Revoked/expired work must not block passive inspection of unrelated chats or be replayed as a new run.
5. Install quota/model/effect fences with live grant revalidation. Complete capped request accounting without weakening existing budget denials. Preserve cancellation and unsafe tool uncertainty.
6. Settle private results through existing SDK answers and EF-S02, without a second result-cache authority. Update complete recovery-unit reference closure for the immutable background payload before enabling its source namespace; the current collector recognises only side-prompt internal sources.
7. Migrate Dream and granted add-on callers, including deterministic refresh, descriptor-bound lock ownership, cancellation, restart and source-owned cleanup. An uncertain still-running operation must retain its waiter/ownership; releasing a Dream lease while that work can still mutate notes is unsafe.
8. Qualify actual native AgentPool callers with a synthetic provider, grants/tool ceilings, budget ancestry, deadlines, revocation, cancellation, same-ID lost ACK/reopen and no repeated effects. Component tests alone cannot establish this integration.

## Component evidence

- `runtime/test/agent-pool/background-operation-contract.test.ts`: immutable data, canonical owner identity, content/configuration hashes, policy conflicts, physical model identity and absolute deadlines.
- Existing registered `qualification/pi-durable-130/host-controller.test.ts`, filter `^background policy SDK:`: actual SDK task quotas, concurrent calls, forged identity, revocation, expiry, configuration/API mismatch, repeated provider call IDs and a paused disk reopen with same-input replay. A deliberate second-input probe checks retained quota; it does not authorise production admission of another primary in a private one-operation context.
- Removed-quota and removed-deadline counterfactuals produce real SDK failures; source is restored byte-exact afterwards.

No full suite, live database/configuration/credential access, deployment, restart, retention schedule, restore promotion or new UI pattern is implied. See [the current runner boundary](native-runner-boundary.md) and [complete recovery unit](native-recovery-unit.md).
