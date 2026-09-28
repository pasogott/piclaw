# Local-note epic acceptance audit

This audit records implemented behaviour and remaining gates for #1347. Passing tests do not approve a proposed performance budget, prove model-answer accuracy or authorise deployment. It covers the combined #1431/#1432 work; #1427 separately preserves historical evidence.

## #387 query/get delivery

| Requirement | Implementation evidence |
|---|---|
| Explicit availability and single-user admission | `memory-search.ts` registered closures capture session/chat binding, validate active grants and note-index access before selectors; `memory-query.test.ts` / `memory-get.test.ts` admission and mid-read revocation scenarios |
| Bounded references, heading, lines, revision and snippet | Query returns verified leaf and separately verified parent references; `rank-context` resolves every reference with `memory_get`; BOM/CRLF and byte-boundary helpers tested in `ranking.test.ts` |
| Exact revision; no stale redirection | Same-metadata edits, deletion, links, corruption, replacement database, mode changes and cancellation regressions; source bytes rehashed on each file read |
| No arbitrary path selector or raw no-identity reader | Only query/limit/offset and chunk-ID/revision schemas; private admitted read path; early-denial parameter-proxy tests |
| Limits and current publication checks | Five hits, encoded output cap, 20 chunk validations including parents, 16 file attempts/8 MiB, 1,024 UTF-8 input bytes; publication-pruning and parent-selector snapshot regressions |
| Preserve generic search and startup maps | Guidance tests assert independent bootstrap/search entrypoints; no preflight hook, new provider call or tool-default expansion |

Final source review found and fixed the post-open size race, post-opendir cleanup, parent selector race and missing file/UTF-8 input bounds. Closing #387 requires the reviewed fixes on main and integrated passing validation. It should not remain open solely because #390 ranking work or production deployment is incomplete.

## #377 workflow and release checks

- Tool-local guidance specifies query → exact get → cited answer, supported/contradicted/unrecorded/not-found distinctions, and untrusted note handling. Registration tests verify guidance remains opt-in with no retrieval bootstrap hook.
- `docs/local-note-recall.md` documents stale/error semantics, source/index ownership, refresh coordination, trusted recovery, operator enablement and non-destructive rollback.
- `release-workflow.test.ts` measures 516 admitted normal files in the same store across build, three reopens, three real writer interruptions/recovery and incremental refresh. It verifies corpus reference stability, get round trips, warm-response stability, publication advance and dirty-file-only read counts.
- `files-limits.test.ts` and the query worker cover independent-review findings. Frozen evidence-role annotations are added separately from original relevance labels; no deterministic test is called model-answer accuracy.
- Final combined full CI and the resource/quality gate disposition still have to pass before closing #377. Installation/restart is not part of that source-level gate and has not been authorised here.

## #390 ranking and #1346 evaluation

Implemented: bounded lexical/heading streams, common-query BM25, exact phrase/structured-ID constraints, deterministic rank-before-top-five, and separately cited contiguous parent headings. No rejected candidate-mode API, arbitrary answerability threshold, embedding dependency or compulsory model call. No blanket recency preference. Consulted regression data show 12/12 labelled spans delivered with cited parent context; this is not a fresh held-out result.

Still required for these issues:

1. Decide workload-specific numerical release thresholds explicitly. Original proposals remain unchanged; observed p95, output size and owned-index ratio exceed them. The recommended new limits are documented with measurement scope, not marked accepted.
2. Keep retrieval relevance and evidence-role usefulness distinct from response faithfulness. A note that records rejection/absence is potentially useful; nonempty hits do not measure hallucination. The new role annotations are consulted regression labels, not retrospective changes to frozen ground truth.
3. Record the final ranking ablations/temporal-intent disposition. No automatic date preference or claim of chronology understanding is implemented. The current keyword/heading approach preserves historical conflicts for caller assessment; any stronger date-aware ranking needs explicit parsing rules and tests.
4. Final role-aware fixture frozen at `96be3e301` before queries: 13 new notes/24 questions, drafted in a delegate context without implementation or prior corpus access. [First-run evidence](../performance/local-note-final-holdout.md): 11/12 supported quotes delivered in query+context and12/12 after get,4/4 contradicted and4/4 unrecorded quotes,137 exact reference round-trips. All4 originally absent-labelled questions still have lexical hits; independent review found Q23 explicitly unrecorded and Q24 ambiguous/intentional omission, so that group is not a valid absence-quality gate. Frozen labels/results remain unchanged with the defect documented. No answer model was run. Keep this evidence separate from consulted regression sets; do not retune on it.
5. Report representative resource measurements separately from logical ceilings; three interrupted-refresh snapshots are not a long-run physical DB/WAL growth bound. The repeated-run release report lists exactly what was measured.

The epic should close only after remaining code/evidence PRs are reviewed and merged and each child acceptance item is dispositioned with evidence. No tables, notes, live sessions or runtime installation need to be reset to complete that audit.
