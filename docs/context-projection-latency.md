# Bound provider-context projection work

The `context` hook in `runtime/extensions/integrations/context-mode.ts` can stall the local event loop while traversing a long history, even when it returns no transformed messages.

## Cause and change

The previous traversal repeatedly called `canUseToolOutput()` and tool-compaction policy getters for historical messages and nested blocks. Access checks synchronously read configuration; policy resolution also performs configuration work. Awaiting helpers that immediately resolve only advances the microtask queue, so pending HTTP requests and timers can remain delayed.

The hook now:

- Reads enabled-tool and per-tool-threshold policy once per request.
- Projects legacy and nested tool results synchronously within each batch.
- Uses `setImmediate` after every 64 messages to let other event-loop work run.
- Rechecks access and cancellation after each yield and before publishing the result.
- Keeps policy snapshots local to the invocation; later requests read fresh policy.

The `tool_result` storage/semantic-summary path is unchanged. Context projection remains deterministic, does not call a model or store outputs, and does not mutate the input history. Policy changes made during a yield take effect on the next request; access revocation and turn cancellation discard the current partial projection.

The batch bound is measured in top-level messages, not text bytes or nesting depth. A single unusually large or deeply nested message can still monopolise a batch; this change does not claim a hard wall-clock latency bound.

## Reported measurements

Observed on Windows x64 with Bun 1.4.1 and PiClaw 3.2.4. The same affected hook was present at the upstream base used for this patch.

A 60-second status probe recorded 109 sequential requests, spaced 200 ms apart. Median latency was 2 ms; maximum latency was 10,530 ms. Five requests exceeded one second. Their measured application-handler time was approximately 0.4–1.2 ms, indicating delay before request handling.

Read-only replay of the same 1,050-message history produced:

| Replay | Previous hook | Batched hook |
|---|---:|---:|
| 1 | 3,676 ms | 76 ms |
| 2 | 3,691 ms | 54 ms |
| 3 | 3,474 ms | 57 ms |

Median hook time fell from 3,676 ms to 57 ms (98.4% lower). Outputs were deeply equal and input-history hashes unchanged. Additional oversized and nested synthetic cases also matched. Only aggregate measurements are included here; the replay history and deployment-specific scripts are not published.

These are hook-replay measurements, not an end-to-end model-speed claim. Provider latency, total context length, CPU contention and other startup work remain separate factors. Live improvement after activating the fix has not been established by this report.

## Regression tests

`runtime/test/extensions/context-projection-performance.test.ts` launches synthetic scenarios in separate child processes so module mocks cannot leak into neighbouring suites. Tests cover:

- One policy read per request and 17 access checks for 1,024 messages.
- Event-loop yielding without timing-sensitive speed assertions.
- Deterministic output and input immutability, including nested results.
- Images, binary blocks, excluded tools and small output preservation.
- Per-tool thresholds, request-scoped policy and fresh subsequent requests.
- Denied, disabled, missing-message and pre-aborted requests.
- Access revocation or cancellation during a yield and access recheck before publication.
- No model calls or tool-output persistence during context projection.

Run through the repository's isolated launcher:

```sh
bun run test:local --cwd runtime -- bun test test/extensions/context-projection-performance.test.ts
```

The standard filesystem preloads remain enabled. Fixtures contain synthetic data only.
