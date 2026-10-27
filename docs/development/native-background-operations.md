# Native background operation policy

The granted add-on path uses native dispatch and settlement, including API-equivalent task and calendar caps when a stored account and trusted model ceiling can be bound. `AgentPool.prepareAddonOperation()` derives authority from the persisted owner and current host grant, publishes a private context, and composes the accepted source/binding/budget identity without starting a model or tool. `dispatchAddonOperation()` uses that same identity through native submit/wait/settle; the real operation host selects it without calling the legacy runner.

Explicit continuation and budget-resume now reuse qualified private history. This remains unfinished under #1670: interrupted working-owner recovery and held-work ownership still need qualification, and Dream still uses the legacy runner. Unavailable pricing/account authority and provider-window evidence remain fail-closed. Initial execution tests do not establish full issue acceptance or merge readiness.

## Immutable input and retry identity

`runtime/src/agent-pool/background-operation-contract.ts` defines the host-created payload:

- Stable Dream invocation or add-on operation/principal identity. The add-on owner's latest persisted queued event identifies an explicit input sequence; status changes and mutable input-committed markers cannot mint another sequence.
- Exact provider/model/API, tool-name ceiling and maximum tool calls. Add-on grants require a finite limit; zero permits a model-only result. Dream can retain an explicitly uncapped host policy.
- Work and parent-work identities, original admission time and absolute expiry.
- Prompt/instruction hashes, with the full text kept only in the private payload.

Construction copies and freezes values, canonicalises tool order and rejects duplicate names, malformed fields, getters, unknown versions and changed content. Decoding does not repair an unsupported snapshot.

The source ID includes stable caller ownership. Grant revision/target, model, prompt, instructions, tools, budget ancestry and deadline are execution choices: changing them conflicts with the same source instead of allocating another operation. ACK/restart repair cannot renew expiry or widen a grant. Physical model identity is exact; no provider/model/API fallback is allowed.

Explicit continuation creates another accepted source while keeping the same stable operation-context key. Per-source quota is kept separately; it cannot reset an older input's claims. A new queued owner event identifies continuation versus resume. A committed prior input is resumed with the fixed host continuation instruction, never its original text. Unsubmitted input retains its own bytes, including when a budget denial occurred before native publication. An existing context keeps its original model even when the global default changes.

These values describe accepted intent. Current operator grants, model approval, parent budget and source ownership still require host validation. Do not deserialize a policy from a model/browser and treat it as permission.

## Public SDK binding and quota

`runtime/durable-engine/src/host-background-policy.ts` uses `app.background-policy`, a conversation-scoped, latest-history, initial-fork SDK document. The schema ownership contract declares its Core owner. It adds no physical table or migration.

Each source-keyed document family member stores its input/hash binding and at most100 finite-limit tool claims. It does not duplicate the prompt/instructions or establish an effect receipt. An explicitly uncapped policy stores no unbounded claim list.

The allocation transaction creates a fresh ownerless, unforked context, configures its exact agent model/tools/instructions and binds the policy after host authorisation. The exact `ConversationRecord` returned by that transaction proves creation: the SDK forbids table reads after its first table write. Never replace that record with a caller-supplied freshness flag. Same-policy re-entry preserves quota. Changed configuration or binding fails. Forks begin unbound and cannot inherit the parent's grant.

A before-intent claim verifies actual public SDK task, assistant and pending live-slot evidence. SDK task IDs distinguish calls; provider call IDs may legitimately repeat across rounds. Re-entering one task after a lost ACK spends no extra call. Parallel tasks contend inside public SDK commits, so one remaining slot permits one effect. Oversized call identities cannot expand the bounded quota document.

A quota claim never authorises resending a tool. Keep the SDK tool's existing safe/unsafe replay semantics and uncertain-effect receipts. Passive recovery/terminal settlement must remain available after expiry or revocation; do not install live execution approval as a general bootstrap-read gate.

## Model and effect fences

The pinned SDK treats a thrown generation `beforeRequest` hook as a reported hook failure. It can continue the model request. That hook cannot serve as an admission fence.

The initial dispatcher enforces policy through the host model bridge's exact source capture, public SDK configuration checks, request accounting and post-auth checks. Synchronous host effect guards repeat current grant, model, policy-document, configuration, ancestry and execution-lease checks after awaits. A public SDK before-intent hook claims the actual tool task's quota. The hook returns unchanged for proven ordinary/Delegate inputs; unknown/private references still fail. Before-tool quota checks supplement the effect guards.

The execution lease permits only an explicit dispatcher waiter. A failed/uncertain dispatch remains cached and sealed until reopen; it cannot silently start another request. This memory fence grants nothing without the persisted accepted source and current host permission. The existing awaited post-auth header transform is not an atomic network-send hook.

The component fixture uses a public awaited header transform to exercise model refusal. That fixture is not an atomic post-auth dispatch proof and does not qualify production grants or an AgentPool caller.

## Explicit input epochs

Before adding an input to an existing context, the host proves every prior native operation is terminal and re-reads its exact public SDK submission. The public SDK transaction then requires an ownerless, unforked, idle context, terminal tasks, complete accepted-input history and all prior policy bindings. Interrupted/aborted/unknown tool outcomes refuse new admission. Known history, old quotas, source identities and immutable payloads remain unchanged; only the new source gets a fresh policy-family member.

Updating an existing context never registers another conversation in the recovery/scheduling domain. Concurrent preparation joins one source-owned promise before the first await. If policy publication succeeds but the host acceptance frame fails, the same-process failure stays owned; confirmed close/reopen reuses that staged policy/context without another allocation or deadline reset.

The operation worker captures its input epoch. Native dispatch, committed-input acknowledgements and terminal owner transitions reject a stale epoch instead of rewriting a later input or its result. These constraints do not grant spending permission. The API still checks current principal/grant authority for every new continuation/resume.

## Capped request boundaries

The blanket model-budget denial remains for unqualified ordinary, side, scheduled and Delegate paths. Background model calls pass it only with exact captured input provenance and their own completed reservation preparation; an uncapped call with no reservation cannot keep spending if a cap appears during credential resolution.

Current grant revalidation retains enabled state, operator approval, immutable tools/model/deadline and active ancestor ownership. The internal request action does not borrow read permission. The request ledger evaluates prospective cost before credentials and again after auth, excluding exactly that request's own hold. Tool effects separately check the current parent budget after awaits. Those checks are read-only and cannot create calendar-window records.

Background reservations fund the full approved model output ceiling. A smaller request hint may be ignored by a provider and cannot lower that bound. The model bridge checks that physical pricing, tiers and token limits still match its prepared catalogue before and after auth; changed metadata requires fresh preparation, without a provider/model fallback.

An exact host budget denial has a bounded `budget` failure category that survives transport serialisation and SDK terminal replay. It forbids automatic SDK retries and maps to the operation API's `budget_blocked` outcome. Provider errors and lookalike codes cannot create that category. A pre-input denial returns that outcome only after proving no accepted source/binding exists; uncertain accepted work is not cleared or replayed.

Only definitely unsent reservations are released. Unknown/dispatched outcomes remain held and block new work under the same parent. Definitively rejected reservation work is stopped without inventing a zero-cost usage event. If that cleanup is uncertain, active work is retained and both the original denial and cleanup failure remain in bounded, redacted diagnostic evidence; the operation reports failure instead of claiming confirmed budget cleanup. No budget record, hold or usage history is deleted.

## Initial admission and recovery

The sole application SDK owner publishes `app.background-contexts`; these private identities are separate from public chat routes and session controls. A fsynced immutable payload precedes metadata publication. EF-S01 accept/claim, native correlation and operation-budget ancestry then share one host transaction. A failed binding insert rolls back that whole host frame; the staged empty context and its payload remain for exact reopen/retry. They grant no execution.

Same-input admission reuses the context/source/deadline, including after the compatibility owner replaces its mutable text with a committed-input marker. The persisted working transition fixes the original start time; preparation cannot start another timeout window. Missing original bytes are never reconstructed from that marker. Fresh grants and budget ancestry are checked; an existing public/imported binding cannot be reparented as a private context.

Read-only recovery proves the private manifest, policy family and immutable bytes without applying live grant permission. A revoked operation can be inspected/reopened while an unrelated ordinary chat continues. This includes a private input whose original model is no longer approved: retain that exact choice, deny re-admission/execution, and allow ordinary contexts using a still-approved model to reopen. Public/root contexts and unclassified agent documents retain their existing startup model-approval requirement. New spending/effect admission still requires current permission.

The initial dispatcher joins native cancellation before settlement and persists a distinct timeout/cancellation cause. An already committed completion wins its race with cancellation. Replaying a terminal result reads the original SDK answer and EF-S02 outcome, including with a fresh signal after reopen; it submits no new input and spends no quota. Private settlement has no timeline row, outbox delivery or side-result cache. The add-on API retains its 256KiB UTF-8 output limit; the ordinary native answer bound is unchanged. Budget requests with unknown outcomes retain their holds and active operation work.

Complete recovery-unit capture includes `native-background-input` references from policy families, even for staged contexts without an accepted source. It validates the policy/hash/owner/content binding; missing or modified input fails without a published manifest. No private source or payload is inferred from a filename alone.

## Required execution integration

Before marking #1670 complete:

1. Derive policy from trusted Dream/add-on records and current grants. Preserve the original absolute deadline, parent ancestry and exact model approval on retry.
2. Retain qualified explicit continuation/resume and complete interrupted working-owner recovery. Keep private contexts out of public chat targets, web admission and session controls; do not fabricate a web user message or branch.
3. Compose EF-S01 acceptance/claim, native binding and accounting ancestry on the existing application store. Reuse exact source/request identities after lost ACK. A staged empty context cannot grant execution.
4. Extend exact controller recovery and immutable binding checks for these private contexts. Unknown tasks remain denied. Revoked/expired work must not block passive inspection of unrelated chats or be replayed as a new run.
5. Retain the qualified task/calendar reservation and effect fences, with unavailable authority held closed. Qualify revocation during held provider/tool execution, preterminal lost acknowledgements and unsafe tool uncertainty.
6. Settle private results through existing SDK answers and EF-S02, without a second result-cache authority. Retain the implemented recovery closure for active and staged background payloads.
7. Migrate Dream and finish the add-on service's interrupted-working/held-work lifecycle, including deterministic refresh, descriptor-bound lock ownership, cancellation, restart and source-owned cleanup. An uncertain still-running operation must retain its waiter/ownership; releasing a Dream lease while that work can still mutate notes is unsafe.
8. Qualify actual native AgentPool callers with a synthetic provider, grants/tool ceilings, budget ancestry, deadlines, revocation, cancellation, same-ID lost ACK/reopen and no repeated effects. Component tests alone cannot establish this integration.

## Component evidence

- `runtime/test/agent-pool/background-operation-contract.test.ts`: immutable data, canonical owner identity, content/configuration hashes, policy conflicts, physical model identity and absolute deadlines.
- Existing registered `qualification/pi-durable-130/host-controller.test.ts`, filter `^background policy SDK:`: actual SDK task quotas, concurrent calls, forged identity, revocation, expiry, configuration/API mismatch, repeated provider call IDs and a paused disk reopen with same-input replay. A deliberate second-input probe checks retained quota; it does not authorise production admission of another primary in a private one-operation context.
- Existing default-factory cases `native-addon-admission`, `native-addon-admission-rollback`, `native-addon-admission-overlap`, `native-addon-admission-rejected` and `native-addon-admission-alias`: real native pool admission/reopen, private visibility, grant and ancestry refusal, shared-store rollback, payload alias/mode refusal and complete paused recovery. Admission itself makes no model call; one unrelated ordinary request proves revoked private work does not block it.
- Default-factory cases `native-addon-admission-model-revoked` and `native-addon-admission-public-model-revoked`: passive recovery retains a revoked private model and denies new admission without modifying its records; an approved ordinary request still runs. An unapproved public model continues to block startup without database changes. The original private-startup failure and removed-public-guard counterfactual are retained.
- Native default-factory execution cases cover the real operation host and service, exact private results/reopen, grant withdrawal before tools and during credential resolution, cancellation/deadline outcomes, tool ceilings, quota and a 140KB Unicode result. The deadline fixture controls the host clock and named deadline callback at credential resolution; its 200ms policy and 30s harness limit are unchanged. This avoids making slow fixture publication count as the intended in-flight expiry. The accounting variant proves three reserved/dispatched/settled requests with background ancestry; unknown usage retains its unresolved hold across terminal replay/reopen with zero extra provider calls.
- Actual service lifecycle cases resume after budget blocking and accept new input after `input_required`, with close/reopen and a changed global default between turns. Concurrent calls accept one new epoch. An unsubmitted continuation survives a budget gap; staged policy publication survives a failed acceptance frame and another confirmed reopen. Old input appears once in history, old effects/quota are unchanged, and multi-input complete recovery units verify and reopen paused. Live prior operations and interrupted tool receipts refuse fresh admission. Removing the resume-instruction rule repeats a write; removing quota/epoch checks erases history or lets stale acknowledgements/results overwrite the current input.
- Capped default-factory cases cover funded task/daily requests, exact reservation headroom, reserve-before-auth denial, cap changes during auth and a tool await, missing/rotated accounts, pricing changes, full output-ceiling funding, unknown holds and rejection of fresh work that would evade them. Terminal outcomes replay after reopen. A real ordinary request still receives no credentials/model dispatch under the unqualified global cap boundary.
- Completed private execution is captured as a complete recovery unit with exactly the immutable background input and native answer; verification and paused qualification succeed. Missing/tampered input still refuses publication.
- Removing the production quota hook permits a second write to overwrite the fixture marker. Removing fresh grant revalidation lets revoked work complete. The defining tests fail; source is restored byte-exact afterwards. Earlier removed-quota/deadline component counterfactuals remain evidence too. Removing reserve, dispatch, post-await tool-budget, ordinary-boundary, pricing, output-ceiling or read-only checks also causes defining failures. In the output-hint counterfactual the synthetic provider records10,005,000 micros against a110,000-micro cap; the intact full-ceiling check sends no request.

No full suite, live database/configuration/credential access, deployment, restart, retention schedule, restore promotion or new UI pattern is implied. See [the current runner boundary](native-runner-boundary.md) and [complete recovery unit](native-recovery-unit.md).
