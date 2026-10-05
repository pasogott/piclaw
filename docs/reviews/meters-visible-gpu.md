# Visible meter rows and GPU details

Disabled and unavailable optional meter lines are omitted, and GPU details use a short vendor-neutral summary. Source-only frontend change; telemetry collection, stored history, hardware probing and production configuration remain unchanged.

## Behaviour

- GPU activity and memory rows have independent availability. Explicit disabled/enabled-false snapshots and null/stale/unavailable readings emit no line; valid0% and0B are retained.
- The HUD no longer converts optional null counters to zero. Swap/RSS/buffer/VRAM lines require valid counters; compact VRAM is not duplicated.
- Aggregate NVML memory telemetry supplies a memory-only generic GPU entry. Dedicated memory remains percentage-valued in the meter, and usage/capacity bytes appear in its popup. No activity value or per-device identity is invented from aggregate data.
- Popup contains device name, status, available sample age/activity/memory/capacity and a concise source-specific warning. Observed-client fdinfo memory retains the RAM/shared-buffer caveat; device-memory telemetry does not inherit that caveat. Intel engine and coverage tables/repeated notes are removed.
- Keyboard/touch opening, Escape/Close focus restoration, outside click, narrow layout and removal are preserved. If the clicked activity row disappears while a memory row remains, the popup closes rather than retaining a disconnected trigger.
- Visual's actual SystemStats strip also omits unavailable Swap/BUF/RSS/GPU items. Disabled rows do not remain as `--` placeholders; valid zero optional readings are preserved.

## Qualification so far

- Focusedfrontend+unchangedcollector tests:44passed/337assertions across4files.
- Rebuilt browser matrix:5passed/114assertions across2files; Chromium/WebKit bothskin style contexts, actualVisualstrip, zero/absent/disabled/partial/aggregateNVML/observed-client readings, shortdetails/accessibility/trigger removal/device removal.
- Webbuild9/26, five type stages and scopedlint pass with95unchangedfrontend transitive diagnostics.

Independent frontend source review cleared `b5c265339fe6` (message 62878). A delegated judge timed out and supplied no approval. The first browser matrix had two WebKit timeouts; the unchanged isolated case and rebuilt matrix passed without deadline or assertion relaxation. Focused expected labels were updated from starred Intel labels to simple generic labels; prior failures are retained.

## Full-gate correction

The first frozen `make ci-fast` run at `b5c265339fe6` failed: 6,543 passed, 8 skipped, 1 failed, 42,805 assertions across 931 files. The existing EF-S07 corruption fixture ran ten independent disk-backed vectors inside one five-second test and timed out at 5,840ms. Its unchanged isolated run passed all 31 assertions in 1.72 seconds. The failed full log is retained at `/workspace/tmp/meters-visible-full/ci-fast.log`, SHA-256 `30e11d40ef1607753ac4d5521c1889ae5ffe4b82746f8e433df22256c25fd1f7`.

Each vector is now registered as a separate test with the default five-second deadline. Fresh databases, corruption mutations, assertions and disposal remain unchanged; loop guards become callback returns after their assertions. The complete affected file passes 31 tests and 280 assertions. The first transformation's syntax failure is retained alongside the corrected result. Production storage is unchanged.

A fresh complete gate from the corrected frozen snapshot is required before publication. The isolated passes do not clear the failed full run.

No liveGPU workload, account/provider/network/production database mutation, installation or restart was performed. Generic display support does not claim new hardware collector support.
