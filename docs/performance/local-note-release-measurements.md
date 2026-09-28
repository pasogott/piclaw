# Note-recall release measurements and gate disposition

The integrated ranked query/get workflow passes same-store reopen and incremental-reference regression tests on 516 normal synthetic Markdown files. It does **not** meet every older proposed file-search resource threshold; those thresholds are unapproved and unchanged. This report does not close #1346 or the retrieval epic.

## Reproduce

```sh
bun run test:controlled -- runtime/test/note-retrieval/release-workflow.test.ts runtime/test/note-retrieval/files-limits.test.ts runtime/test/extensions/extensions-memory-guidance.test.ts
```

The release worker copies the consulted 16-note regression corpus and creates 500 normal ~8 KiB filler notes with complete lines. It asserts all 516 sources were indexed, not excluded. Three independent processes use **the same disposable store** for build, reopen without refresh, and a single-file dirty/incremental refresh. All leaf/parent references are read with `memory_get`; all corpus source IDs, ordered evidence text, revisions, bounds, signals, coverage and statuses must remain identical across phases. Dynamic timing, generation timestamps and serialized rank lengths are not reference identity. No provider/model calls or live workspace/store access.

## Recorded run

Measured on Smith LXC with Bun 1.4.2, source based on #1431 `d59b8cafb`, plus #377 guidance and reviewed allocation/cleanup fixes. Run log: `/workspace/tmp/377-final-focused.log`.

| Metric | Build | Reopen | Incremental |
|---|---:|---:|---:|
| Indexed files | 516 | 516 | 516 |
| Source bytes | 4,387,001 | 4,387,001 | 4,387,032 |
| Note-owned table/index pages (bytes) | 9,949,184 | 9,949,184 | 10,719,232 |
| Note pages / source bytes | 2.27× | 2.27× | 2.44× |
| Refresh wall time including bound worker startup | 8,270 ms | none | 500 ms |
| First measured query | 13.15 ms | 13.15 ms | 19.54 ms |
| p95 of 22 query calls | 20.22 ms | 18.51 ms | 21.58 ms |
| Max encoded query response | 6,385 bytes | 6,385 bytes | 6,387 bytes |
| Parent/leaf evidence covering full labelled spans | 12/12 | 12/12 | 12/12 |

RSS at report was 81.6/80.8/83.0 MB; the controlled runner sampled a 164 MiB process-tree peak. Report RSS is not peak RSS. Note page totals include autoindexes selected via `sqlite_schema.tbl_name`; whole messages-DB bytes (11.8 MB initially, 22.8 MB after incremental staging) also include unrelated schema and free pages, so are not labelled note-index size. The test is not a long-duration storage growth bound. These source bytes are real normal paragraphs, but unrelated fillers do not demonstrate ranking under a dense relevant corpus. Times are one local run, not a statistically robust production latency estimate.

## Preserve failed/proposed gates

The original `runtime/test/fixtures/note-retrieval/budgets.json` file is not edited. Its thresholds were proposed for the earlier file-level search baseline, not accepted for this integrated tool.

- Proposed warm p95 **10 ms**: this query-call p95 exceeds it. Calls were not a five-repeat warm-only measurement, so do not replace the original assessor with this number; neither can it establish a pass.
- Proposed index/source ratio **2×**: note-owned pages exceed it at 2.27–2.44×.
- Proposed maximum query output **4 KiB**: observed max exceeds it. The implemented safety ceiling remains **16 KiB**, which every response respects.
- Existing safety: 20 chunk validation operations including parents, five query hits, 2-second cooperative query/get deadline, exact revision checks and fail-closed permissions remain unchanged. Runtime safety ceilings do not approve performance budgets.
- The old no-answer-hit and conflicting-path gates conflate retrieval exposure with wrong model answers. Do not silently relabel frozen runs; a useful note may say a fact was rejected/unrecorded. Future retrieval and answer-faithfulness gates need separate labels and explicit acceptance.

## Review findings and remaining closure work

A bounded independent review of note access/files found a same-inode growth race: `readNote` checked initial pathname size but allocated from the post-open descriptor size without reapplying the 512 KiB limit. Fixed before allocation and covered by a test requiring zero read calls and handle closure. A related post-opendir admission failure now closes its directory handle. Existing access identities/root bindings and source revisions were not relaxed.

A separate independent review of the admitted query found that parent rows were rechecked by ID but their adjacency selector was not repeated. A same-generation insertion of a second, non-FTS-matching parent could evade the candidate snapshot check after a later source read. The final validation now repeats every parent selector (including empty lookups) and rejects a changed row set. A deterministic two-source regression passes with the fix and fails when that final selector recheck is removed; read order is asserted so the insertion occurs after the original parent lookup.

The final contract audit also found the 20-candidate query could read 20 distinct files despite the accepted 16-file/8 MiB ceiling, and a 512-character query could exceed the accepted 1,024 UTF-8-byte input ceiling. Both limits are now explicitly enforced. A hooked file-open regression verifies exactly 16 source opens when more candidates exist; an oversized multibyte query returns `invalid_request`.

Remaining epic gates: review/merge integrated PRs; explicitly accept or revise numerical #1346 budgets using measurements; assess any remaining #390 ranking/temporal-intent criteria without claiming consulted data is held out; complete #387 checklist against publication/stale/access tests; complete #377 operator/guidance checks and the final independent query/get integration review. No final model-answer accuracy claim can come from these deterministic tests. No deployment/restart has occurred.
