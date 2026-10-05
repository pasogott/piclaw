# Timeline return and latest-message handle

Returning to a cached conversation now loads contiguous newer pages, reconciles the rendered viewport without waiting for a scroll, and exposes a jump-to-latest action on the compose divider. The handle overlays a small chevron while away from latest and uses the accent colour when new messages arrived. Source only; no installation or restart.

## Reproduced causes

Classic rendered a fixed16-row window. A viewport resize/return with short messages exposed virtual spacer because row selection only followed scroll; Chromium and WebKit both failed the new geometry test. The viewport now determines the rendered interval plus a small row buffer, reconciled on layout/resize/foreground return, with cancellation on unmount.

Cached returns refreshed only the newest10 rows and merged them into older cache even when many new messages separated them. A bounded50-row-page catch-up now reaches the last page-verified cached boundary before retaining older rows. Individual SSE arrivals cannot advance that boundary. Ten-page maximum preserves a contiguous fresh segment and drops disconnected old cache. Generation/chat/mutation checks prevent stale publication; one bounded mutation retry catches a same-turn arrival. Malformed/failed raw pages reject before normalization; failed older loads expose an explicit retry action and reset the cursor without an automatic retry loop.

Reverse-scroll load-more distance/sign and scroll preservation were wrong for negative column-reverse offsets. Corrected anchoring preserves the same reading position and never writes into a replacement chat's scroller. Visual also restores the anchor before paint when WebKit clamps the scroller during a large insertion. Catch-up results are sorted chronologically in Visual. New-message and foreground refreshes do not force the reader to latest; divider activation does.

The divider preserves drag-to-resize in Classic, distinguishing more-than4px movement from tap; keyboard activation is supported. Visual uses the compose-divider button. Per-scroller state compares newest data IDs, not virtual-row mount/unmount, so pagination/history reveal does not fabricate unread messages. Changed state only is published, observers/listeners/frames are cleaned up, and explicit arrivals reconcile after WebKit anchor restoration.

## Candidate evidence

- Focused loaders/cache/window/scroll/action/lifecycle tests:39passed/81assertions across8files.
- Rebuilt browser matrix:23passed/148assertions across3files. Chromium/WebKit, desktop/mobile/tablet fixtures, small/windowed history, cachedswitchreturnafter85arrivals, foreground/newmessage gap handling, SSE-before-catch-up, malformed Visual responses retaining history,100px reading boundary, latest+middle rows, viewport growth, handle drag/tap, retry cursor and reverse-anchor coverage.
- Web build:9passed/26assertions. Five type stages pass with95unchangedtransitive frontend diagnostics; scopedlint excepttwo unchanged pre-existing unused-variable diagnostics inComposeBox, fullstatic silent/logging/deps/env/cycles/pack/stale pass.
- Syntheticworstcasehelperprofile100catchups/1000pages/50000rows20.19ms aggregate,10000viewportcalculations4.34ms; wall81.61ms inclsleep, CPUuser50.56ms/system7.65ms, loopmax5.41ms/p992.91ms/53samples. NoHTTP/DB/provider/livecontent, no production latency or before-after speed claim.

Independentsource review and frozen full gate are required before publication. The existing mainline audit integration is separate; no sharedmain changes here.

## Failed evidence

Originalviewportbrowser0pass2fail retained. VisualWebKit test initially timed out and then showed scrollTop clamped to-1 afternewrows; anchor/publicationordering corrections added. Cachedhistoryreveal initially mounted then disappeared; reveal now updates scroll target beforeviewport reconciliation. RebuiltVisual initial delayedfollow raced reader's scroll; replaced delayed100msfollow with layout-bound initialfollow and guarded trailingframe. All deadlines/assertions retained; added chronology and lifecycle checks. A delegated judge timedout120s and suppliednoapproval.

Independent review found three blockers in the first candidate: using maximum cached ID could accept an isolated SSE row as a contiguous join;60px handle-away disagreed with150px auto-follow; Visual normalised a missing posts field to an authoritative empty array. Separate verified-page boundaries, unified60px policy and raw-array validation fix those cases, with both-consumer browser negatives. The earlier candidate is not final qualification evidence.
