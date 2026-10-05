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

Independent finalsource review and frozen full gate are required before publication. A delegated judge timed out and supplied no approval. Firstmatrix had two WebKit timeouts; unchanged isolatedcase and final rebuiltmatrix passed without deadline/assertion relaxation. Firstfocusedexpected labels updated from starred Intel labels to simple generic labels; priorfailures retained.

No liveGPU workload, account/provider/network/production database mutation, installation or restart was performed. Generic display support does not claim new hardware collector support.
