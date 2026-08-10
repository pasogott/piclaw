# Assessment quality review

Review baseline: Piclaw `v2.13.2` plus ADR documentation through the review commit.

Result: **decision-ready with explicit post-approval implementation gates**.

## Scope and integrity

- Production/runtime changes: **0**.
- Changed paths from `v2.13.2`: ADR Markdown files only.
- Local/remote branch: `main` synchronized before final review.
- Post-release campaign: preserved at `archive/post-v2.13.2-fixes-20260810` and in a verified complete Git bundle.
- Markdown links: checked as local paths across the ADR bundle.
- Whitespace: `git diff --check` passes.

## Evidence completeness

| Measure | Result |
|---|---:|
| Current capabilities | 59 |
| Regressions/incidents | 25 |
| Invariants | 14 |
| Piclaw surfaces classified for effector reuse | 35 |
| Harness contract cases | 20 |
| Piclaw boundary contract cases | 20 |
| Earendil assumptions | 10 |
| Migration phases | 9 (`M0`–`M8`) |
| Capabilities with owner/mechanism/test traceability | 59/59 |
| Regressions with mechanism/test traceability | 25/25 |

## Quality-bar review

| Criterion | Evidence | Result |
|---|---|---|
| Pinned baselines | ADR index and evidence E-001/E-002 | Pass |
| Existing functionality captured systematically | `current-capability-matrix.md` | Pass; named evidence-strength gaps retained |
| Known defects treated as specification | `regression-corpus.md` | Pass |
| Every durable responsibility has a target owner | capability and traceability matrices | Pass |
| No reuse of current Piclaw orchestration | effector classification rejects agent pool, process-chat/recovery/compaction orchestration | Pass as design constraint; implementation boundary test is an M1 gate |
| Earendil structure adopted early | installed declarations, session protocol and reducer surveyed | Pass |
| Real installed harness viability checked | installed JavaScript inspected; execution methods found to be stubs | Pass |
| Compatibility fixture specified | fixture layout, manual driver, model/tools, fault plan and assumptions | Pass |
| One suite can target fixture and real harness | parameterised contract factory and compatibility report | Pass as specification; implementation is an M1/M4 gate |
| Replay and fault boundaries specified | target state model and fixture contract | Pass |
| Exact-owner cancellation specified | operation/run identity and cancellation protocol | Pass |
| Atomic terminal settlement specified | nine-step transaction/protocol | Pass |
| Restart reconciliation specified | two-journal state table | Pass |
| Scheduler delivery ownership specified | scheduler model and PC-012/013 | Pass |
| Mobile installed-browser acceptance specified | PC-015 and M5–M7 installed gates | Pass |
| Alternatives compared | five alternatives with selected fixture-first architecture | Pass |
| Migration and rollback reversible | M0–M8, per-chat backend cutover and no destructive downgrade | Pass |
| Unsupported claims labelled | ten assumptions with confidence/failure response and resolution gates | Pass |

## Baseline test evidence

Documentation-only review reran representative stable tests with inherited MCP/browser compatibility variables removed:

- focused recovery/compaction/tool/queue/restart/scheduler slice: **100 pass, 0 fail**, 313 assertions across 9 files;
- web-channel and main run-orchestrator slice: **162 pass, 3 pre-existing skips, 0 fail**, 838 assertions across 2 files;
- MCP keychain isolation probe: **8 pass, 0 fail** with `PICLAW_MCP_MEMENTO_TOKEN` unset; **7 pass, 1 fail** with the host-injected token.

The pre-push guard was attempted on documentation-only commits. It reaches the baseline suite and fails on the inherited MCP token assumption. The guard bypass and its reason are recorded in E-010. No runtime source differs from `v2.13.2`.

## Independent-review limitation

One agent produced the assessment and this quality review. No independent reviewer has approved the architecture. The ADR therefore remains **Proposed**, not Accepted.

An independent review should challenge:

- whether Piclaw should own the accepted-source sequence and terminal frontier;
- whether timeline persistence can participate in the same transaction as operation settlement;
- whether the fixture risks encoding assumptions that Earendil later rejects;
- whether M5 (service authority before execution cutover) is the safest order;
- whether per-chat rollback can preserve context without uncertain tool replay;
- whether the contract suite covers add-on/extension resource compatibility sufficiently.

## Post-approval gates

These are implementation evidence, not missing assessment prose:

- implement the fixture and shared suite in M1;
- prototype/benchmark the Piclaw operation schema in M2;
- select a usable Earendil source commit;
- run the HC suite against the real harness in M4;
- measure shadow/soak and resource budgets;
- complete installed-service/mobile/restart/rollback gates before cutover.

## Review decision

The assessment satisfies the agreed documentation quality bar and is ready for Rui's architecture decision. Approval authorises planning/implementation of M1 only; it does not authorise production cutover, dependency upgrade, schema deployment or service restart.
