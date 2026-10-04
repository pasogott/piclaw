# Pin synchronisation and loaded input visibility

Two synchronous SQLite waits and a Visual queue-refresh gap delay input visibility under controlled load. This candidate bounds pin contention, retries queued admission asynchronously and rehydrates Visual queue state from the server after acknowledgement/reconnect. It has not been deployed. The reported live 30-second delay has not been fully traced.

## Measured paths

The [synthetic receipt](../development/receipts/pin-input-load-profile.json) records owned loopback requests against disposable SQLite/WAL databases, a separate two-second writer and real message/pin handlers.

| Workload | Original behaviour | Candidate behaviour |
|---|---|---|
| Pin write plus unrelated HTTP acknowledgement under writer lock | Both responses about 2,050 ms; timer stalled about 2,049 ms | Pin returns explicit 503 in 0.9 ms; unrelated acknowledgement 0.9 ms; timer about 10 ms |
| Actual agent input, durable queued follow-up and SSE under writer lock | HTTP/SSE about 2,090 ms; timer about 2,089 ms | Three runs: HTTP/SSE 2,025–2,032 ms, after durable commit; timer 10.16–10.28 ms; concurrent pin busy response 1.44–1.57 ms |
| Visual compose while queue SSE is absent | Existing queue is invisible; old UI fails the browser fixture | Queued acknowledgement triggers server reconciliation; input visible about 36 ms in rebuilt Chromium/WebKit cases |

The writer still delays durable acceptance; the candidate yields during that wait so other requests/timers can run. It never acknowledges an uncommitted input. Idle actual admission took 31–60 ms across the three candidate runs. These small synthetic runs do not establish whole-system throughput or the full live delay's cause.

## Changes

- Pin DB operations temporarily use `busy_timeout=0` only within synchronous actor/read/transaction scopes, restoring the original connection value in `finally`. Contention produces an explicit 503/Retry-After response. No access pruning or durability setting is weakened.
- The shared pin request retries only 503 with exact `Retry-After: 1`, at most three retries, with one 15-second deadline and one serialised desired-state body. It does not retry authentication, rate-limit or ambiguous network failures. Lifecycle stop aborts backoff.
- Queued single-user web admission uses an immediate read/modify/write transaction with zero synchronous lock waiting and a five-second asynchronous budget. Only confirmed SQLite contention is retried. Every attempt and precommit recheck authority, cancellation, DB handle/binding, canonical config paths and file device/inode. The original timeout is restored before yielding.
- HTTP 201 and queued SSE follow successful commit. A fresh active-run check wakes the exact chat if its previous turn ended while admission waited. Family admission uses its existing authority path; this slice does not change it.
- Visual queue state has one controller owner. Mount, acknowledged queue submission, reconnect and turn end fetch authoritative state. Generations/cancellation suppress stale held GETs; foreign chat and stopped responses cannot publish.
- Queue actions use captured chat URLs. Confirmed remove/steer/edit and persisted reorder invalidate older GETs; failed/ambiguous actions retain local rows until reconciliation. Editing removes the durable queued item before returning its text to compose. Session navigation currently performs full-page reloads.

## Qualification so far

- Combined unit/backend/facade checks: 47 passed / 305 assertions, covering busy/cancel/revoked authority, rollback, deadlines, concurrent fresh writes, lost-wake prevention, stale queue responses and action races.
- Disk pin/binding checks: 10 passed / 39 assertions. Reopened handles and replaced database files are rejected before writing captured state; configuration redirection rolls back. Runtime busy timeout is restored after success, denial and unrelated errors.
- Browser matrix: eight passed / 64 assertions. Existing Classic/Visual model/session pin synchronisation cases pass; real Visual ChatPanel/QueueStack tests cover absent SSE, held snapshots, consumption, cancel/steer, denied actions and chat-scoped URLs. Display panels are stubbed and this queue fixture uses in-memory SQLite; disk behaviour is tested separately.
- Web rebuild: nine passed / 26 assertions. Rebuilt browser replay passed eight / 64. Five typecheck stages pass with 95 unchanged pre-existing frontend transitive diagnostics; strict QueueStack/controller compile, scoped lint, cycle and silent-catch checks pass. Two silent fixture rejection observers were corrected to central debug logging before the full gate.
- Separate source review found and corrected controller/component dual ownership, unscoped action URLs, active-to-idle lost wake and stale DB binding. Final narrow reviews found no additional confirmed blocker. Full frozen gate is pending.

The earlier naive queue acknowledgement append was discarded because a consumed SSE event could precede the HTTP reply and revive an already-consumed row. The candidate uses server snapshots instead. The old UI browser failure is retained; neither timeouts nor functional assertions were relaxed.

The first binding fixture closed its DB while the blocker still held its transaction, consuming the retry deadline. The fixture now releases that writer before synchronous close/reopen. Runtime admission checks captured binding before any PRAGMA on the old handle; the corrected disk case passes. This failure is retained locally.

## Profiling and remaining coverage

A whole-process Bun CPU profile contains fresh schema creation and module loading; native `run` frames dominate (237 samples). Frame URLs are absent, so function names cannot identify precise call sites. Raw CPU output stays local; reviewed aggregate counts are in the receipt. No SQL bind values, private conversation content or credentials were collected.

Synchronous authentication repairs, ordinary timeline message writes, background DB maintenance, browser render CPU and provider/tool-induced event-loop work still need representative measurements. The live 30-second report has not been matched to a complete request trace. A successful isolated run is insufficient to close that investigation. No production install, restart or credential/provider call occurred.
