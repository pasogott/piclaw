# Ordinary idle input admission

Ordinary single-user web inputs now wait asynchronously for SQLite write admission while preserving atomic message/media/thread state. This follow-up addresses the idle-message blocking path measured after merged PR #1542. It is source-only; the full live thirty-second delay has not been fully traced.

## Boundary

Preparation snapshots input/options/media IDs and allocates one stable message ID, timestamp and Markdown spill buffer. A five-second bounded asynchronous admission loop acquires an immediate transaction with zero synchronous busy waiting and restores the connection setting before yielding. Authority, cancellation, DB handle, file identity and config paths are checked before captured-handle use and before/after mutation.

Inside that transaction, storage validates media and either:

- writes generated spill media, message, attachments/FTS, self-thread/explicit thread, optional deferred consumption/protected continuation and chat metadata; or
- if the chat became busy/backlogged, commits only a negative deferred intent before inserting any message or spill media.

The latter preserves existing materialisation semantics. No positive persisted row is added to a deferred queue and later inserted again. When materialised, one intent creates one message and is consumed once. Message timestamps are made monotonic at commit, so a request prepared earlier but committed later cannot fall behind the chat cursor.

The authoritative interaction is captured inside the transaction. Optional link previews and recording occur after commit and log failures without rejecting accepted input or retrying admission. HTTP acknowledgement, SSE and execution scheduling follow commit. Same-chat execution remains serialized by AgentQueue. Family, command and steering admission keep their existing paths; the synchronous internal storage API remains available.

## Review corrections

Separate source review found two blocking issues in the initial implementation:

1. Postcommit preview/read/record exceptions could be reported as an unaccepted input. Interaction capture moved inside the transaction, and optional preview/recording failures are handled after commit. Actual handler tests prove late abort and preview SQLITE_BUSY still return the durable row and schedule once.
2. Inserting a positive message row and a queued copy when activity changed could produce duplicate materialisation/execution. Routing now chooses a negative intent before insertion. Real queue/materialiser/selection tests prove one row and one consumption, including busy ending after commit but before acknowledgement.

No timeout, original functional assertion or security policy was relaxed. A new disk fixture initially hit its 15-second child deadline; the failed receipt is retained. Phase-only logging followed by direct and wrapper retries passed within the unchanged deadline. Its original timeout cause is unestablished.

## Measurements

The [synthetic receipt](../development/receipts/idle-input-admission-profile.json) records a two-second owned WAL writer against actual handlers and public WebChannel routing/storage/SSE.

- Prior idle-handler/store probe: ordinary input, unrelated HTTP, SSE and timer all delayed about 2,058 ms under the writer lock; idle acknowledgement about 32 ms.
- Candidate public WebChannel, three runs: durable input/SSE waited 2,032–2,603 ms; concurrent timeline GET returned in 1.93–2.11 ms and timer delay stayed 10.08–10.28 ms. Idle acknowledgement was 25–33 ms. The input is never acknowledged before commit.
- Requests include actual router/guards/prototype/storage and correlated Server-Timing/request IDs. The executor is a no-op, authentication is disabled for the owned single-user fixture, and provider execution is excluded.

Writer duration, durable commit and process scheduling vary; these runs are not whole-system speed benchmarks. Browser renderer CPU, authenticated repairs, family ingress, maintenance and commands remain separate coverage gaps.

Three method-instrumented runs recorded 1,736–1,771 event-loop samples at 1 ms resolution. The whole probe's worst delays were 20.8–33.0 ms, with p99 0.63–0.67 ms; this includes idle HTTP work and retry backoff. The locked request made 160 SQLite exec calls and 82 query lookups as it retried, totalling about 1.0–1.1 ms and 0.71–0.77 ms respectively. It also made 256 JSON serialisations (about 1.0–1.1 ms) and 13 parses (about 0.07 ms). Statement run/get timing and isolated commit cost were not instrumented. These call counts expose retry overhead without a production throughput claim.

A whole-process CPU profile includes fresh schema creation and module loading; native `run` frames dominate (232 samples). Bun omitted frame URLs, so repeated names cannot identify precise source costs. Raw output stays local. RSS after the method-instrumented probes was 117–119 MB; this is a single-process reading, with no dedicated GC or allocation comparison. The receipt preserves CPU/event-loop/method counts and limitations.

## Qualification so far

- Atomic storage, routing, postcommit failures and legacy handler tests: 33 passed / 255 assertions. TaskQueue/routing/postcommit subset: six passed / 54 assertions; tasks are synthetic, not provider turns.
- Broad existing channel/storage/facade regression: 127 passed / 705 assertions.
- Disk cancellation, revocation, reopened handle and replaced file: one passed / two assertions, with zero committed rows.
- Shipped Classic/Visual acknowledgement, rejection and event-order deduplication: four browser cases / 36 assertions, Chromium and WebKit.
- Web build: nine checks / 26 assertions. Five typecheck stages pass with 95 unchanged pre-existing frontend transitive diagnostics; scoped lint, circular-dependency and silent-catch checks pass.
- Independent final narrow reviews found no additional confirmed blocker after the two boundary corrections. A frozen full gate and final exact-head checks are still required before publication.

No production install, restart, private credential/provider call or live database mutation was performed. The complete live thirty-second report remains open.
