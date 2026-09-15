# Adjacent interaction evidence

Classic source review; independent bounded review completed for these files. No browser execution. Source paths below are supplemented by named symbols in feature headers and the exact scenario index. Source tests and runtime suites do not prove every browser clause.

| Feature | Source | Related existing tests |
|---|---|---|
| [compose/compaction-model-switch.feature](../../compose/compaction-model-switch.feature) | `runtime/web/src/components/compose-box.ts`; `runtime/web/src/components/model-picker.ts` | `runtime/test/web/compose-box.test.ts` |
| [compose/compose-stability.feature](../../compose/compose-stability.feature) | `runtime/web/src/components/compose-box.ts`; `runtime/web/src/ui/upload-transfers.ts` | `runtime/test/web/compose-box.test.ts` |
| [compose/context-meter-tooltip.feature](../../compose/context-meter-tooltip.feature) | `runtime/web/src/components/compose-box.ts` | `runtime/test/web/compose-box.test.ts` |
| [compose/hamburger-layout-scale.feature](../../compose/hamburger-layout-scale.feature) | `runtime/web/src/components/timeline-menu.ts`; `runtime/web/src/components/tab-strip.ts`; `runtime/extensions/viewers/editor/markdown/theme.ts` | `runtime/test/web/tab-strip.test.ts`; `runtime/test/web/theme.test.ts` |
| [compose/instant-visibility.feature](../../compose/instant-visibility.feature) | `runtime/web/src/components/compose-box.ts`; `runtime/web/src/ui/app-timeline-scroll-orchestration.ts` | `runtime/test/web/compose-box.test.ts` |
| [compose/sse-reconnection.feature](../../compose/sse-reconnection.feature) | `runtime/web/src/ui/app-connection-lifecycle.ts` | `runtime/test/web/app-connection-lifecycle.test.ts` |
| [compose/thoughts-panel.feature](../../compose/thoughts-panel.feature) | `runtime/web/src/components/status.ts` |  |
| [mobile/pwa-manifest.feature](../../mobile/pwa-manifest.feature) | `runtime/src/channels/web/manifest.ts`; `runtime/src/channels/web/http/dispatch-shell.ts` |  |
| [mobile/swipe-independence.feature](../../mobile/swipe-independence.feature) | `runtime/web/src/ui/chat-swipe-navigation.ts` | `runtime/test/web/chat-swipe-navigation.test.ts` |
| [sessions/session-switching.feature](../../sessions/session-switching.feature) | `runtime/web/src/ui/compose-session-switcher.ts`; `runtime/web/src/ui/app-chat-pane-state.ts`; `runtime/web/src/ui/app-refresh-coordination.ts` | `runtime/test/web/compose-session-switcher.test.ts`; `runtime/test/web/app-chat-pane-state.test.ts`; `runtime/test/web/app-refresh-coordination.test.ts` |

`ux-shell-009` adds the editor Markdown theme source omitted from the original header. PWA browser installation, native keyboard focus, media upload progress and gestures still need browser runs.

## Stable scenario cross-reference

IDs below refer to the source/correction tables above by feature and current title. Review state: source checked; bounded independent packet reviewed; browser not run. A related test path is not a per-clause execution claim.

| ID | Current scenario | Feature |
|---|---|---|
| ux-compaction-001 | Render compaction using supplied status state | [compose/compaction-model-switch.feature](../../compose/compaction-model-switch.feature#L6) |
| ux-compaction-002 | Reconcile compaction events with client status | [compose/compaction-model-switch.feature](../../compose/compaction-model-switch.feature#L13) |
| ux-compaction-003 | Request stop through the visible compaction control | [compose/compaction-model-switch.feature](../../compose/compaction-model-switch.feature#L21) |
| ux-compaction-004 | Use refreshed usage rather than assume compaction always shrinks context | [compose/compaction-model-switch.feature](../../compose/compaction-model-switch.feature#L28) |
| ux-compaction-005 | Display temporary compaction suppression | [compose/compaction-model-switch.feature](../../compose/compaction-model-switch.feature#L35) |
| ux-compaction-006 | Check model context compatibility before switching | [compose/compaction-model-switch.feature](../../compose/compaction-model-switch.feature#L42) |
| ux-compaction-007 | Refresh model information after an accepted switch | [compose/compaction-model-switch.feature](../../compose/compaction-model-switch.feature#L49) |
| ux-compaction-008 | Handle a model command using the configured provider catalogue | [compose/compaction-model-switch.feature](../../compose/compaction-model-switch.feature#L56) |
| ux-compose-001 | Clear captured content while allowing a new draft | [compose/compose-stability.feature](../../compose/compose-stability.feature#L6) |
| ux-compose-002 | Restore a failed submission alongside newer text | [compose/compose-stability.feature](../../compose/compose-stability.feature#L14) |
| ux-compose-003 | Reject an entirely empty submission | [compose/compose-stability.feature](../../compose/compose-stability.feature#L23) |
| ux-compose-004 | Return a queued message replaces the current editor draft | [compose/compose-stability.feature](../../compose/compose-stability.feature#L29) |
| ux-compose-005 | Keep upload progress separate from sending state | [compose/compose-stability.feature](../../compose/compose-stability.feature#L37) |
| ux-compose-006 | Submit captures the destination chat | [compose/compose-stability.feature](../../compose/compose-stability.feature#L45) |
| ux-context-001 | Show supplied usage in the context tooltip | [compose/context-meter-tooltip.feature](../../compose/context-meter-tooltip.feature#L6) |
| ux-context-002 | Display missing token counts without inventing them | [compose/context-meter-tooltip.feature](../../compose/context-meter-tooltip.feature#L13) |
| ux-context-003 | Offer compaction only when a callback exists | [compose/context-meter-tooltip.feature](../../compose/context-meter-tooltip.feature#L20) |
| ux-context-004 | Show the supplied compaction title and elapsed label | [compose/context-meter-tooltip.feature](../../compose/context-meter-tooltip.feature#L29) |
| ux-context-005 | Apply the coded usage warning colours | [compose/context-meter-tooltip.feature](../../compose/context-meter-tooltip.feature#L37) |
| ux-shell-001 | Menu contains New file, Refresh tree, Reindex workspace | [compose/hamburger-layout-scale.feature](../../compose/hamburger-layout-scale.feature#L12) |
| ux-shell-002 | Menu contains hidden files toggle | [compose/hamburger-layout-scale.feature](../../compose/hamburger-layout-scale.feature#L20) |
| ux-shell-003 | Workspace items disabled in chat-only mode | [compose/hamburger-layout-scale.feature](../../compose/hamburger-layout-scale.feature#L27) |
| ux-shell-004 | Terminal and VNC menu controls depend on callbacks | [compose/hamburger-layout-scale.feature](../../compose/hamburger-layout-scale.feature#L32) |
| ux-shell-005 | Compose box spans full width | [compose/hamburger-layout-scale.feature](../../compose/hamburger-layout-scale.feature#L40) |
| ux-shell-006 | Hamburger button visible and above safe area | [compose/hamburger-layout-scale.feature](../../compose/hamburger-layout-scale.feature#L45) |
| ux-shell-007 | Tab close does not activate tab | [compose/hamburger-layout-scale.feature](../../compose/hamburger-layout-scale.feature#L51) |
| ux-shell-008 | Menu contains display scale control | [compose/hamburger-layout-scale.feature](../../compose/hamburger-layout-scale.feature#L58) |
| ux-compose-007 | Display an accepted text submission | [compose/instant-visibility.feature](../../compose/instant-visibility.feature#L7) |
| ux-compose-008 | Serialize text and references into one submission | [compose/instant-visibility.feature](../../compose/instant-visibility.feature#L14) |
| ux-compose-009 | Preserve the association between uploaded files and media identifiers | [compose/instant-visibility.feature](../../compose/instant-visibility.feature#L21) |
| ux-compose-010 | Do not erase newer typing after send completes | [compose/instant-visibility.feature](../../compose/instant-visibility.feature#L28) |
| ux-compose-011 | Reconcile visible messages through timeline state | [compose/instant-visibility.feature](../../compose/instant-visibility.feature#L35) |
| ux-reconnect-001 | Clear transient agent displays while disconnected | [compose/sse-reconnection.feature](../../compose/sse-reconnection.feature#L6) |
| ux-reconnect-002 | Refresh authoritative chat state after reconnect | [compose/sse-reconnection.feature](../../compose/sse-reconnection.feature#L14) |
| ux-reconnect-003 | Avoid replacing an active search with main-timeline refresh | [compose/sse-reconnection.feature](../../compose/sse-reconnection.feature#L21) |
| ux-reconnect-004 | Show version drift without automatically reloading | [compose/sse-reconnection.feature](../../compose/sse-reconnection.feature#L28) |
| ux-reconnect-005 | Avoid duplicate initial refresh after recent chat activation | [compose/sse-reconnection.feature](../../compose/sse-reconnection.feature#L36) |
| ux-thoughts-001 | Render collapsed thought content with disclosure state | [compose/thoughts-panel.feature](../../compose/thoughts-panel.feature#L6) |
| ux-thoughts-002 | Continue updating content independently of disclosure | [compose/thoughts-panel.feature](../../compose/thoughts-panel.feature#L13) |
| ux-thoughts-003 | Toggle thought panel expansion | [compose/thoughts-panel.feature](../../compose/thoughts-panel.feature#L19) |
| ux-thoughts-004 | Collapse an expanded status panel with Escape | [compose/thoughts-panel.feature](../../compose/thoughts-panel.feature#L27) |
| ux-thoughts-005 | Preserve text when changing disclosure state | [compose/thoughts-panel.feature](../../compose/thoughts-panel.feature#L34) |
| ux-pwa-001 | Serve a manifest with declared application icons | [mobile/pwa-manifest.feature](../../mobile/pwa-manifest.feature#L7) |
| ux-pwa-002 | Use configured agent-avatar URLs for manifest icons | [mobile/pwa-manifest.feature](../../mobile/pwa-manifest.feature#L14) |
| ux-pwa-003 | Fall back to static icons without an avatar | [mobile/pwa-manifest.feature](../../mobile/pwa-manifest.feature#L21) |
| ux-pwa-004 | Request sized Apple touch icons | [mobile/pwa-manifest.feature](../../mobile/pwa-manifest.feature#L27) |
| ux-pwa-005 | Prefer PNG avatars for favicon compatibility | [mobile/pwa-manifest.feature](../../mobile/pwa-manifest.feature#L42) |
| ux-pwa-006 | Vary avatar icon cache URLs with the avatar version | [mobile/pwa-manifest.feature](../../mobile/pwa-manifest.feature#L50) |
| ux-mobile-001 | Swipe on eligible timeline space | [mobile/swipe-independence.feature](../../mobile/swipe-independence.feature#L7) |
| ux-mobile-002 | Ignore gestures originating in excluded controls | [mobile/swipe-independence.feature](../../mobile/swipe-independence.feature#L15) |
| ux-mobile-003 | Permit designated thinking and status panel targets | [mobile/swipe-independence.feature](../../mobile/swipe-independence.feature#L31) |
| ux-mobile-004 | Keep swipe order stable as the selected chat changes | [mobile/swipe-independence.feature](../../mobile/swipe-independence.feature#L38) |
| ux-mobile-005 | Do not treat primarily vertical movement as chat navigation | [mobile/swipe-independence.feature](../../mobile/swipe-independence.feature#L46) |
| ux-mobile-006 | Limit horizontal wheel navigation to the supported Safari path | [mobile/swipe-independence.feature](../../mobile/swipe-independence.feature#L52) |
| ux-session-001 | Show the selected chat's timeline | [sessions/session-switching.feature](../../sessions/session-switching.feature#L6) |
| ux-session-002 | Group picker entries using the current session metadata | [sessions/session-switching.feature](../../sessions/session-switching.feature#L14) |
| ux-session-003 | Filter session entries using their search metadata | [sessions/session-switching.feature](../../sessions/session-switching.feature#L21) |
| ux-session-004 | Use archive and restore actions supplied for session entries | [sessions/session-switching.feature](../../sessions/session-switching.feature#L28) |
| ux-session-005 | Keep touch swipe eligibility independent of picker grouping | [sessions/session-switching.feature](../../sessions/session-switching.feature#L36) |
| ux-session-006 | Dismiss the session picker without choosing an entry | [sessions/session-switching.feature](../../sessions/session-switching.feature#L44) |
