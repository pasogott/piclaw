# Native direct-runner boundary

`AgentPool.runAgent()` is a legacy compatibility API. A pool constructed with a captured native session lookup, including an empty lookup, rejects this method before eviction protection, option getters, budget work, orchestration, session construction or model calls.

The result is `{ status: "error", result: null, error: "Native execution requires an admitted operation", failureCategory: "non_recoverable" }`. Caller-supplied budget IDs or provenance cannot turn a direct prompt into accepted native work. Non-native compatibility pools retain their existing runner behaviour.

Native execution must use its qualified accepted-source dispatch: ordinary input admission, scheduled dispatch with the exact lease/source proof, or the existing bound side-prompt contract. These ports have different authority and context requirements; a side prompt is not a generic substitute for unbound background work.

This guard is a prerequisite in #1670, **not completion of the caller migration**. Dream's transient context/model policy, granted add-on execution and non-web admission still need their admitted native ports and defining provider/replay tests. The remaining legacy web path belongs to #1674. Dream, add-on operations and non-web support are not retired by this guard. Their native direct calls already failed at legacy-session construction; they now fail without creating and completing a misleading budget-work row.

Focused qualification covers real default-factory/native-pool calls for bound, missing, Dream, add-on-operation and non-web-shaped identities; exact/empty captured lookup cases; untouched database/files and zero option/factory/provider calls; and one existing non-native compatibility run. No deployment, live-state cleanup or historical-data removal is implied.
