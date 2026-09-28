# Local-note query quality on frozen hard cases

The merged `memory_query`/`memory_get` tools deliver all returned references accurately but answerable-query coverage is low on the frozen hard-v2 corpus. An offline bounded query rewrite improves labelled-text coverage and worsens no-answer behaviour. These are measurements for #1346/#390, not accepted release budgets or a production ranking change.

## Method

`runtime/test/note-retrieval/current-tool-evidence.test.ts` indexes 16 frozen fictional Markdown notes into a disposable SQLite store via the existing independent note-index worker. The test verifies SHA-256 hashes for all 16 notes and both query files before indexing. Each variant runs the same 24 labelled queries: seven answerable and five no-answer questions in each development and held-out split. It calls the actual registered tools with an admitted synthetic single-user session, scores **returned snippet text** against each labelled quote at the correct path, and resolves every returned `{chunk_id, source_revision}` through `memory_get`. The full chunk is scored separately. Filenames and BM25 rank alone receive no credit. There is no model call or live workspace access.

The `current` variant sends original frozen queries unchanged. Three **offline** rewrites send bounded FTS expressions to the unchanged `memory_query` tool: `expanded` joins non-stopword units with OR; `anchored` requires the first unit plus any later unit; `anchored-two` requires the first two plus any later unit. A fourth `ranked` variant applies a 60% lexical unit-coverage filter to the expanded tool hits. The variants do not use labels or a no-answer classifier. They remain fixture code only. All variants have now been examined against held-out labels, so further thresholds or candidate choices need a new untouched split before making an unbiased quality claim.

Reproduce in an isolated repository worktree with `bun run test:controlled -- runtime/test/note-retrieval/current-tool-evidence.test.ts`. Run logs: `/workspace/tmp/1346-current-final.log` (metrics below), `/workspace/tmp/1346-quality-integration.log` (47 focused regression tests), `/workspace/tmp/1346-quality-typecheck.log`. Those logs are local evidence, not committed artefacts.

## Returned-text results

| Variant | Development answer text | Held-out answer text | Development no-answer hits | Held-out no-answer hits | Conflicting hits (dev / held) | Max response bytes (dev / held) |
|---|---:|---:|---:|---:|---:|---:|
| Current tool | 2/7 | 3/7 | 0/5 | 0/5 | 0 / 0 | 894 / 1,621 |
| Expanded OR | 6/7 | 6/7 | 5/5 | 5/5 | 4 / 2 | 3,489 / 3,495 |
| Anchored one | 6/7 | 6/7 | 5/5 | 5/5 | 4 / 2 | 3,257 / 3,021 |
| Anchored two | 5/7 | 6/7 | 5/5 | 5/5 | 4 / 2 | 2,731 / 1,735 |
| Ranked 60% coverage | 5/7 | 6/7 | 5/5 | 5/5 | 4 / 2 | 3,489 / 3,495 |

Every hit in the five variant runs resolved to the same admitted path through `memory_get`, and its full chunk contained the returned snippet. Chunk-text answer coverage equalled snippet-text coverage in each split. All 24 query calls per variant returned `ok` in this clean frozen snapshot. The OR variants still miss the repeated-heading case on both splits; lexical matches elsewhere consume the five-hit cap. The earlier fixture-only `anchors-v2` experiment also delivered 6/7 per split, but produced no-answer hits on 4/5 development and 5/5 held-out queries. Those different fixture results are not production-tool measurements.

The 512-character rewrite ceiling, 20 query-unit ceiling and existing five-hit tool cap are *experiment controls*. They do not change the accepted note-index access, freshness, byte/citation or output bounds. Run timings include a tiny warm synthetic index; they do not establish a production p95 or a 512-file runtime cost. No negative example here validates semantic abstention, and a top-five hit on a no-answer query is a false-positive exposure even when it is lexically relevant.

## Budget decision for Rui

A proposed hard-corpus **evaluation gate**, for approval or revision before #390 changes production ranking:

- At least **6/7 answerable questions per split** must include every labelled span in returned agent-visible text at the correct path. Score the actual snippets under the tool's five-hit and 16 KiB response ceilings; measure full-chunk results as a separate diagnostic.
- At most **1/5 no-answer queries per split** may return any hit (**≤20%**). Report conflicting-path hits separately and target **zero** in both splits. Do not label malformed, over-budget or incomplete queries as successful abstentions.
- **24/24** returned query references must resolve through `memory_get` to the same path and original bytes when the source is unchanged. Every access, stale, cancellation and dirty-state regression must continue to pass.
- Require repeatable output under reversed build order, fresh-process reopen and a synthetic 512-file scale run before approving a ranking change. Carry forward the existing 16 KiB tool-output ceiling and 2-second cooperative deadline; record observed p95, peak process RSS and candidate counts instead of inventing a pass threshold without scale data.

The current tool fails the proposed answer-coverage gate. All four offline variants fail the proposed no-answer and conflict gates; none should replace the current production query. The 60% coverage filter does not distinguish missing facts, contradicted facts or near-matching identifiers from real answers in this corpus. This result does not establish that lexical retrieval can achieve both targets. Improving answer coverage without promoting unsupported answers may require an independently reviewed evidence/abstention method under #390, with a new untouched split for selection. The previously proposed file-level budgets in `local-note-retrieval-budget-assessment.md` remain separate and unapproved. Approval of the hard-corpus evaluation gate would allow #390 to test new deterministic candidate generation and ranking; it would not itself authorise deployment, automatic answer rejection or a change to the access contract.
