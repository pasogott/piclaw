# UX specification completion matrix

The audit covers **24 feature files, 241 scenarios/outlines and 25 example rows**. All scenarios have stable IDs and a source-evidence packet. Gherkin syntax, evidence paths and the audit-only change scope pass validation. Independent source reviews are recorded separately from executable tests and browser runs.

## Baselines and scope

- PR: [#1323](https://github.com/rcarmo/piclaw/pull/1323).
- Production source baseline: `f1a9d979d4ad5bb9c740b1ddf69f8c6c4ff245b4`.
- Original input: `9607cc4911f3a2a96566af2ddf127f5fabbfe16e`, 20 feature files, 28 new original scenarios.
- Reconciled PR head: `3f8ee0d2f9eddab3828f9a5d4f626716469636d8`, adding the SVG request and upstream immutable test update. It was adopted without modifying application behaviour.
- Audit changes: Gherkin and completion/index/evidence Markdown only. Executable tests, production code, dependencies and generated bundles are unchanged from that head.
- Classic is authoritative on doubt. Visual contracts have explicit skin tags. [Skin differences](audit/differences.md) and [review dispositions](audit/review.md) prevent inferred parity.
- Plan requires external add-on revision `6374ed3c85627c590794e44828d13b08587ba46b`. Tau/Vibes sources are outside this repository and were not verified.

## Completion checklist

- [x] Inventory all twenty input feature files and preserve the original twenty-eight scenario IDs.
- [x] Reconcile the subsequent SVG scenario as original-029 against the actual renderer.
- [x] Correct original and adjacent Gherkin against Classic implementation.
- [x] Add core auth/family, Settings, workspace/editor, recovery and interaction coverage.
- [x] Index every scenario below and link its source-evidence packet.
- [x] Complete bounded independent reviews and reconcile findings, rejected claims and failed attempts.
- [x] Record Visual differences, optional capabilities and safety deviations.
- [x] Validate Gherkin syntax, stable IDs, source paths, Markdown links and allowed-file scope.
- [x] Run local runtime/feature/build gates and type checking; record exact outcomes.
- [x] Run the untouched canonical contract test separately and retain its failure.
- [ ] Commit and publish audit changes to PR #1323; delivery receipt will record the commit.

## Acceptance limits

- [ ] The immutable contract oracle passes. It pins aspirational input wording/hash; it currently fails and editing it is outside scope.
- [ ] Every clause has a direct executable assertion. Related test paths are evidence leads, not per-clause coverage.
- [ ] Browser scenarios are executed. No browser suite was run in this audit.
- [ ] Full cross-skin/port parity is verified. Only the bounded differences in the linked packet were source checked.

These acceptance limits do not authorise changing production behaviour, tests, merging or reloading. [Validation](audit/validation.md) records the passing fast gate separately from the failing immutable oracle.

## Core surface inventory

| Surface | Coverage / boundary |
|---|---|
| Shell/menu/Quick Actions/pickers | original-001–008,013–015,020–022; shell and session regression features |
| Compose/queue/uploads/reconnect | original-016–019,023,026; compose/context/reconnect regression features |
| Plan | original-009–012, conditional on external add-on |
| Timeline/rendering/annotations/speech/tools | original-024–029; timeline features; thoughts/status scenarios |
| Auth/OOBE/invitations/family privacy/sign-out | auth-001–014; owner restrictions in settings-011 and original-025 |
| All sixteen Classic built-in Settings sections | settings-001–030, including General, Sessions, Recordings, Quick Actions, Tools, Add-ons, Compaction, Budget, Keyboard, Scheduled Tasks, Workspace, Environment, Providers, Models, Appearance and Keychain |
| Registered Editor/Developer settings | settings-031–032; local browser preferences, no server save |
| Workspace/viewers/editor/terminal/VNC | workspace-001–018 plus editor/terminal regressions; unsupported in-pane search not invented |
| BTW/Adaptive Cards/widgets | extra-001–005; live and persisted widget lifecycles distinguished |
| Visual search/tasks/scratchpad | extra-006–010; scoped Visual behaviour |
| Notifications/recovery | extra-011–013; General recovery preferences; outcome marker timeline feature |
| Mobile/PWA | pwa-001–006, mobile scenarios and responsive/focus dimensions in other features; installation is browser-controlled |
| Other optional add-ons and native hosts | Capability boundary only; no claim of every external add-on or native-host implementation coverage |

## Feature inventory

Paths are relative to `tests/e2e/features/`. S = coordinator source-reviewed/corrected; R = bounded independent source review with coordinator reconciliation; B = browser run. All rows have S=yes, R=recorded, B=not run. See review dispositions for packet limits.

| Feature | Scenarios / outlines | Example rows | Source packet |
|---|---:|---:|---|
| [canonical/canonical-ux.feature](canonical-ux.feature) | 29 | 6 | [original](audit/original.md) |
| [canonical/core-auth.feature](core-auth.feature) | 14 | 8 | [core-auth](audit/core-auth.md) |
| [canonical/core-interactions.feature](core-interactions.feature) | 13 | 0 | [interactions](audit/interactions.md) |
| [canonical/core-settings.feature](core-settings.feature) | 32 | 0 | [core-settings](audit/core-settings.md) |
| [canonical/workspace-flows.feature](workspace-flows.feature) | 18 | 0 | [workspace](audit/workspace.md) |
| [compose/compaction-model-switch.feature](../compose/compaction-model-switch.feature) | 8 | 0 | [adjacent](audit/adjacent.md) |
| [compose/compose-stability.feature](../compose/compose-stability.feature) | 6 | 0 | [adjacent](audit/adjacent.md) |
| [compose/context-meter-tooltip.feature](../compose/context-meter-tooltip.feature) | 5 | 0 | [adjacent](audit/adjacent.md) |
| [compose/hamburger-layout-scale.feature](../compose/hamburger-layout-scale.feature) | 9 | 0 | [adjacent](audit/adjacent.md) |
| [compose/instant-visibility.feature](../compose/instant-visibility.feature) | 5 | 0 | [adjacent](audit/adjacent.md) |
| [compose/sse-reconnection.feature](../compose/sse-reconnection.feature) | 5 | 0 | [adjacent](audit/adjacent.md) |
| [compose/theme-tint.feature](../compose/theme-tint.feature) | 15 | 0 | [settings-existing](audit/settings-existing.md) |
| [compose/thoughts-panel.feature](../compose/thoughts-panel.feature) | 5 | 0 | [adjacent](audit/adjacent.md) |
| [editor/editor-stability.feature](../editor/editor-stability.feature) | 5 | 0 | [editor-terminal](audit/editor-terminal.md) |
| [mobile/pwa-manifest.feature](../mobile/pwa-manifest.feature) | 6 | 4 | [adjacent](audit/adjacent.md) |
| [mobile/swipe-independence.feature](../mobile/swipe-independence.feature) | 6 | 7 | [adjacent](audit/adjacent.md) |
| [panes/terminal.feature](../panes/terminal.feature) | 17 | 0 | [editor-terminal](audit/editor-terminal.md) |
| [sessions/session-switching.feature](../sessions/session-switching.feature) | 6 | 0 | [adjacent](audit/adjacent.md) |
| [settings/settings-dialog.feature](../settings/settings-dialog.feature) | 5 | 0 | [settings-existing](audit/settings-existing.md) |
| [settings/settings-layering.feature](../settings/settings-layering.feature) | 4 | 0 | [settings-existing](audit/settings-existing.md) |
| [timeline/annotation-highlights.feature](../timeline/annotation-highlights.feature) | 12 | 0 | [timeline](audit/timeline.md) |
| [timeline/lightbox-dismissal.feature](../timeline/lightbox-dismissal.feature) | 4 | 0 | [timeline](audit/timeline.md) |
| [timeline/message-deletion.feature](../timeline/message-deletion.feature) | 6 | 0 | [timeline](audit/timeline.md) |
| [timeline/rendering.feature](../timeline/rendering.feature) | 6 | 0 | [timeline](audit/timeline.md) |

## Scenario index

Each link names the exact scenario line. The evidence packet maps its ID, source symbol, correction and test gaps. Generated from the Cucumber AST after final edits; example rows belong to their outline.

| Stable ID | Scenario | Feature location | Evidence |
|---|---|---|---|
| ux-original-001 | Open and dismiss the workspace menu | [canonical/canonical-ux.feature:13](canonical-ux.feature#L13) | [original](audit/original.md) |
| ux-original-002 | Toggle workspace visibility without submitting the draft | [canonical/canonical-ux.feature:21](canonical-ux.feature#L21) | [original](audit/original.md) |
| ux-original-003 | Open Quick Actions by typing outside interactive controls | [canonical/canonical-ux.feature:30](canonical-ux.feature#L30) | [original](audit/original.md) |
| ux-original-004 | Do not open timeline typeahead from excluded targets | [canonical/canonical-ux.feature:44](canonical-ux.feature#L44) | [original](audit/original.md) |
| ux-original-005 | Ignore consumed and modified typeahead events | [canonical/canonical-ux.feature:59](canonical-ux.feature#L59) | [original](audit/original.md) |
| ux-original-006 | Dismiss Quick Actions without executing a result | [canonical/canonical-ux.feature:65](canonical-ux.feature#L65) | [original](audit/original.md) |
| ux-original-007 | Insert a Quick Actions command into the composer | [canonical/canonical-ux.feature:72](canonical-ux.feature#L72) | [original](audit/original.md) |
| ux-original-008 | Discover loaded skills in the command catalogue | [canonical/canonical-ux.feature:83](canonical-ux.feature#L83) | [original](audit/original.md) |
| ux-original-009 | Save Markdown through the Plan sidebar add-on | [canonical/canonical-ux.feature:93](canonical-ux.feature#L93) | [original](audit/original.md) |
| ux-original-010 | Keep dirty Plan text when a remote update arrives | [canonical/canonical-ux.feature:103](canonical-ux.feature#L103) | [original](audit/original.md) |
| ux-original-011 | Save a Plan before submitting it to the model | [canonical/canonical-ux.feature:113](canonical-ux.feature#L113) | [original](audit/original.md) |
| ux-original-012 | Represent checklist progress using the Plan add-on | [canonical/canonical-ux.feature:122](canonical-ux.feature#L122) | [original](audit/original.md) |
| ux-original-013 | Open and dismiss the Classic session picker | [canonical/canonical-ux.feature:133](canonical-ux.feature#L133) | [original](audit/original.md) |
| ux-original-014 | Select another session through the picker | [canonical/canonical-ux.feature:142](canonical-ux.feature#L142) | [original](audit/original.md) |
| ux-original-015 | Use the session actions actually supplied by the client | [canonical/canonical-ux.feature:150](canonical-ux.feature#L150) | [original](audit/original.md) |
| ux-original-016 | Display queued follow-ups during a busy turn | [canonical/canonical-ux.feature:158](canonical-ux.feature#L158) | [original](audit/original.md) |
| ux-original-017 | Return a queued follow-up to the Classic editor | [canonical/canonical-ux.feature:165](canonical-ux.feature#L165) | [original](audit/original.md) |
| ux-original-018 | Reorder and remove queued follow-ups with reconciliation | [canonical/canonical-ux.feature:176](canonical-ux.feature#L176) | [original](audit/original.md) |
| ux-original-019 | Steer a queued item using the backend-authoritative action | [canonical/canonical-ux.feature:186](canonical-ux.feature#L186) | [original](audit/original.md) |
| ux-original-020 | Select a model for the selected chat | [canonical/canonical-ux.feature:196](canonical-ux.feature#L196) | [original](audit/original.md) |
| ux-original-021 | Navigate the Classic picker lists | [canonical/canonical-ux.feature:205](canonical-ux.feature#L205) | [original](audit/original.md) |
| ux-original-022 | Render model capabilities without inventing values | [canonical/canonical-ux.feature:219](canonical-ux.feature#L219) | [original](audit/original.md) |
| ux-original-023 | Refresh active-turn state after reconnect and request stop | [canonical/canonical-ux.feature:227](canonical-ux.feature#L227) | [original](audit/original.md) |
| ux-original-024 | Copy and delete messages using their actual controls | [canonical/canonical-ux.feature:237](canonical-ux.feature#L237) | [original](audit/original.md) |
| ux-original-025 | Retrieve explicit message IDs and bounded row windows | [canonical/canonical-ux.feature:249](canonical-ux.feature#L249) | [original](audit/original.md) |
| ux-original-026 | Keep attachment upload state separate from message submission | [canonical/canonical-ux.feature:260](canonical-ux.feature#L260) | [original](audit/original.md) |
| ux-original-027 | Display Classic tool execution status | [canonical/canonical-ux.feature:270](canonical-ux.feature#L270) | [original](audit/original.md) |
| ux-original-028 | Copy code and transfer post speech ownership | [canonical/canonical-ux.feature:280](canonical-ux.feature#L280) | [original](audit/original.md) |
| ux-original-029 | Keep model-generated fenced SVG as source code | [canonical/canonical-ux.feature:291](canonical-ux.feature#L291) | [original](audit/original.md) |
| ux-auth-001 | Family-shared code sign-in requires and normalizes the account username | [canonical/core-auth.feature:11](core-auth.feature#L11) | [core-auth](audit/core-auth.md) |
| ux-auth-002 | Single-user code sign-in omits the username field and submits only the code | [canonical/core-auth.feature:22](core-auth.feature#L22) | [core-auth](audit/core-auth.md) |
| ux-auth-003 | Single-user passkey-only mode hides the TOTP form | [canonical/core-auth.feature:31](core-auth.feature#L31) | [core-auth](audit/core-auth.md) |
| ux-auth-004 | Failed sign-in policy loading never exposes stale credential controls | [canonical/core-auth.feature:39](core-auth.feature#L39) | [core-auth](audit/core-auth.md) |
| ux-auth-005 | Explicit passkey sign-in supersedes ambient passkey work and code submission aborts passkey work | [canonical/core-auth.feature:50](core-auth.feature#L50) | [core-auth](audit/core-auth.md) |
| ux-auth-006 | Classic OOBE shows provider-missing only for an unconfigured current instance | [canonical/core-auth.feature:60](core-auth.feature#L60) | [core-auth](audit/core-auth.md) |
| ux-auth-007 | Classic OOBE stays hidden when the instance is already configured or still unresolved | [canonical/core-auth.feature:69](core-auth.feature#L69) | [core-auth](audit/core-auth.md) |
| ux-auth-008 | TOTP invitation strips the link token from the URL, claims only on click, and erases setup secrets after confirmation | [canonical/core-auth.feature:82](core-auth.feature#L82) | [core-auth](audit/core-auth.md) |
| ux-auth-009 | Recovery-only invitation completion hides the normal sign-in action | [canonical/core-auth.feature:96](core-auth.feature#L96) | [core-auth](audit/core-auth.md) |
| ux-auth-010 | Invalid or rejected invitations never reveal enrolment or auto-retry a consumed claim | [canonical/core-auth.feature:103](core-auth.feature#L103) | [core-auth](audit/core-auth.md) |
| ux-auth-011 | Passkey invitations are account-bound, proof-checked, and never sign the browser in automatically | [canonical/core-auth.feature:110](core-auth.feature#L110) | [core-auth](audit/core-auth.md) |
| ux-auth-012 | Leaving a passkey invitation flow discards the one-use ceremony | [canonical/core-auth.feature:123](core-auth.feature#L123) | [core-auth](audit/core-auth.md) |
| ux-auth-013 | Mask the family client when its page loses visibility | [canonical/core-auth.feature:137](core-auth.feature#L137) | [core-auth](audit/core-auth.md) |
| ux-auth-014 | Sign out of the family client | [canonical/core-auth.feature:146](core-auth.feature#L146) | [core-auth](audit/core-auth.md) |
| ux-extra-001 | Display and act on a side-question result | [canonical/core-interactions.feature:8](core-interactions.feature#L8) | [interactions](audit/interactions.md) |
| ux-extra-002 | Validate the identity of a card submission | [canonical/core-interactions.feature:21](core-interactions.feature#L21) | [interactions](audit/interactions.md) |
| ux-extra-003 | Display a rejected card action | [canonical/core-interactions.feature:29](core-interactions.feature#L29) | [interactions](audit/interactions.md) |
| ux-extra-004 | Interpret persisted and live widget artifacts separately | [canonical/core-interactions.feature:37](core-interactions.feature#L37) | [interactions](audit/interactions.md) |
| ux-extra-005 | Keep widget dismissal separate from queue mutation | [canonical/core-interactions.feature:46](core-interactions.feature#L46) | [interactions](audit/interactions.md) |
| ux-extra-006 | Search messages with the Visual search panel | [canonical/core-interactions.feature:54](core-interactions.feature#L54) | [interactions](audit/interactions.md) |
| ux-extra-007 | Activate a Visual search result | [canonical/core-interactions.feature:63](core-interactions.feature#L63) | [interactions](audit/interactions.md) |
| ux-extra-008 | Control an existing scheduled task | [canonical/core-interactions.feature:71](core-interactions.feature#L71) | [interactions](audit/interactions.md) |
| ux-extra-009 | Submit a scratchpad note without prematurely marking it sent | [canonical/core-interactions.feature:83](core-interactions.feature#L83) | [interactions](audit/interactions.md) |
| ux-extra-010 | Persist scratchpad split sizing | [canonical/core-interactions.feature:91](core-interactions.feature#L91) | [interactions](audit/interactions.md) |
| ux-extra-011 | Coordinate local notification ownership across clients | [canonical/core-interactions.feature:99](core-interactions.feature#L99) | [interactions](audit/interactions.md) |
| ux-extra-012 | Hide validated recovery control posts | [canonical/core-interactions.feature:110](core-interactions.feature#L110) | [interactions](audit/interactions.md) |
| ux-extra-013 | Suppress an empty informational recovery placeholder | [canonical/core-interactions.feature:117](core-interactions.feature#L117) | [interactions](audit/interactions.md) |
| ux-settings-001 | Open Settings once and dismiss it without activating the workspace underneath | [canonical/core-settings.feature:11](core-settings.feature#L11) | [core-settings](audit/core-settings.md) |
| ux-settings-002 | Cold-open Settings shows a shell immediately and then resolves General | [canonical/core-settings.feature:20](core-settings.feature#L20) | [core-settings](audit/core-settings.md) |
| ux-settings-003 | General is preloaded and other built-in sections lazy-load on first visit | [canonical/core-settings.feature:27](core-settings.feature#L27) | [core-settings](audit/core-settings.md) |
| ux-settings-004 | Searchable sections focus the header filter and responsive widths change layout classes only | [canonical/core-settings.feature:36](core-settings.feature#L36) | [core-settings](audit/core-settings.md) |
| ux-settings-005 | Compaction exposes dense aligned controls for automatic and manual policies | [canonical/core-settings.feature:45](core-settings.feature#L45) | [core-settings](audit/core-settings.md) |
| ux-settings-006 | Compaction surfaces watchdog state, active suppressions and per-chat reset actions | [canonical/core-settings.feature:53](core-settings.feature#L53) | [core-settings](audit/core-settings.md) |
| ux-settings-007 | Providers expose only the supported setup controls for each provider | [canonical/core-settings.feature:62](core-settings.feature#L62) | [core-settings](audit/core-settings.md) |
| ux-settings-008 | Models loads and mutates the authoritative catalogue for the current chat | [canonical/core-settings.feature:71](core-settings.feature#L71) | [core-settings](audit/core-settings.md) |
| ux-settings-009 | Models keeps a bounded grouped master-detail catalogue with keyboard navigation | [canonical/core-settings.feature:79](core-settings.feature#L79) | [core-settings](audit/core-settings.md) |
| ux-settings-010 | Models actions stay truthful about compatibility, confirmation and next steps | [canonical/core-settings.feature:87](core-settings.feature#L87) | [core-settings](audit/core-settings.md) |
| ux-settings-011 | Budget stays owner-bound, single-user-first and explicit about task-budget ownership | [canonical/core-settings.feature:95](core-settings.feature#L95) | [core-settings](audit/core-settings.md) |
| ux-settings-012 | Scheduled Tasks lists supported tasks and owns per-run task budget edits | [canonical/core-settings.feature:104](core-settings.feature#L104) | [core-settings](audit/core-settings.md) |
| ux-settings-013 | Environment supports refresh and overrides while protecting keychain-injected names | [canonical/core-settings.feature:112](core-settings.feature#L112) | [core-settings](audit/core-settings.md) |
| ux-settings-014 | Keychain keeps secrets encrypted, searchable and gated before reveal | [canonical/core-settings.feature:120](core-settings.feature#L120) | [core-settings](audit/core-settings.md) |
| ux-settings-015 | Add-ons support filtered catalogue actions and extension-pane registration without claiming skin parity | [canonical/core-settings.feature:132](core-settings.feature#L132) | [core-settings](audit/core-settings.md) |
| ux-settings-016 | Keyboard settings filters and edits shortcut bindings through the shared shortcut model | [canonical/core-settings.feature:140](core-settings.feature#L140) | [core-settings](audit/core-settings.md) |
| ux-settings-017 | Workspace settings own terminal, direct-VNC and tree scan preferences | [canonical/core-settings.feature:148](core-settings.feature#L148) | [core-settings](audit/core-settings.md) |
| ux-settings-018 | Appearance settings apply theme preset, custom tint and output padding from one section | [canonical/core-settings.feature:155](core-settings.feature#L155) | [core-settings](audit/core-settings.md) |
| ux-settings-019 | Save General changes after the debounce | [canonical/core-settings.feature:163](core-settings.feature#L163) | [core-settings](audit/core-settings.md) |
| ux-settings-020 | Preview avatars and toggle system meters | [canonical/core-settings.feature:173](core-settings.feature#L173) | [core-settings](audit/core-settings.md) |
| ux-settings-021 | Reveal and copy the widget token | [canonical/core-settings.feature:183](core-settings.feature#L183) | [core-settings](audit/core-settings.md) |
| ux-settings-022 | Confirm widget-token regeneration | [canonical/core-settings.feature:194](core-settings.feature#L194) | [core-settings](audit/core-settings.md) |
| ux-settings-023 | Change session lifecycle and agent behaviour settings | [canonical/core-settings.feature:205](core-settings.feature#L205) | [core-settings](audit/core-settings.md) |
| ux-settings-024 | Load and inspect session recordings | [canonical/core-settings.feature:216](core-settings.feature#L216) | [core-settings](audit/core-settings.md) |
| ux-settings-025 | Start and stop a recording for the entered chat | [canonical/core-settings.feature:226](core-settings.feature#L226) | [core-settings](audit/core-settings.md) |
| ux-settings-026 | Delete a recording and preview redaction | [canonical/core-settings.feature:238](core-settings.feature#L238) | [core-settings](audit/core-settings.md) |
| ux-settings-027 | Filter and collapse the Tools catalogue | [canonical/core-settings.feature:250](core-settings.feature#L250) | [core-settings](audit/core-settings.md) |
| ux-settings-028 | Persist search mode and tool-result compaction choices | [canonical/core-settings.feature:260](core-settings.feature#L260) | [core-settings](audit/core-settings.md) |
| ux-settings-029 | Edit Quick Actions selections before explicitly saving | [canonical/core-settings.feature:270](core-settings.feature#L270) | [core-settings](audit/core-settings.md) |
| ux-settings-030 | Inspect notification capability and instance TOTP setup | [canonical/core-settings.feature:283](core-settings.feature#L283) | [core-settings](audit/core-settings.md) |
| ux-settings-031 | Save local editor preferences from the registered pane | [canonical/core-settings.feature:291](core-settings.feature#L291) | [core-settings](audit/core-settings.md) |
| ux-settings-032 | Gate developer preferences behind local developer mode | [canonical/core-settings.feature:299](core-settings.feature#L299) | [core-settings](audit/core-settings.md) |
| ux-workspace-001 | Create a new untitled markdown file in the resolved folder | [canonical/workspace-flows.feature:11](workspace-flows.feature#L11) | [workspace](audit/workspace.md) |
| ux-workspace-002 | Rename a selected non-root workspace entry | [canonical/workspace-flows.feature:22](workspace-flows.feature#L22) | [workspace](audit/workspace.md) |
| ux-workspace-003 | Delete a selected file after confirmation | [canonical/workspace-flows.feature:33](workspace-flows.feature#L33) | [workspace](audit/workspace.md) |
| ux-workspace-004 | Toggle hidden files and reload the visible tree state | [canonical/workspace-flows.feature:42](workspace-flows.feature#L42) | [workspace](audit/workspace.md) |
| ux-workspace-005 | Expose reindex controls without a verified in-pane file-search field | [canonical/workspace-flows.feature:51](workspace-flows.feature#L51) | [workspace](audit/workspace.md) |
| ux-workspace-006 | Single-click previews files and double-click enters rename | [canonical/workspace-flows.feature:58](workspace-flows.feature#L58) | [workspace](audit/workspace.md) |
| ux-workspace-007 | Upload files to the resolved folder with progress and overwrite prompts | [canonical/workspace-flows.feature:68](workspace-flows.feature#L68) | [workspace](audit/workspace.md) |
| ux-workspace-008 | Render workspace previews by preview kind and content type | [canonical/workspace-flows.feature:79](workspace-flows.feature#L79) | [workspace](audit/workspace.md) |
| ux-workspace-009 | Gate open-in-tab and open-in-editor actions by file capabilities | [canonical/workspace-flows.feature:90](workspace-flows.feature#L90) | [workspace](audit/workspace.md) |
| ux-workspace-010 | Show dirty tab affordances and compare-to-saved gating | [canonical/workspace-flows.feature:97](workspace-flows.feature#L97) | [workspace](audit/workspace.md) |
| ux-workspace-011 | Close tabs with MRU fallback while preserving pinned tabs in bulk close flows | [canonical/workspace-flows.feature:105](workspace-flows.feature#L105) | [workspace](audit/workspace.md) |
| ux-workspace-012 | Rename tracked tab identities without dropping active or MRU state | [canonical/workspace-flows.feature:115](workspace-flows.feature#L115) | [workspace](audit/workspace.md) |
| ux-workspace-013 | Gate dock, popout, reattach, and standalone viewer routes from the tab context menu | [canonical/workspace-flows.feature:124](workspace-flows.feature#L124) | [workspace](audit/workspace.md) |
| ux-workspace-014 | Surface terminal load, availability, reconnect, and exit states | [canonical/workspace-flows.feature:133](workspace-flows.feature#L133) | [workspace](audit/workspace.md) |
| ux-workspace-015 | Surface VNC configuration, read-only, and runtime error gates | [canonical/workspace-flows.feature:145](workspace-flows.feature#L145) | [workspace](audit/workspace.md) |
| ux-workspace-016 | Save changed editor content | [canonical/workspace-flows.feature:157](workspace-flows.feature#L157) | [workspace](audit/workspace.md) |
| ux-workspace-017 | Avoid writing an unchanged editor document | [canonical/workspace-flows.feature:166](workspace-flows.feature#L166) | [workspace](audit/workspace.md) |
| ux-workspace-018 | Resolve an editor file conflict with the supplied actions | [canonical/workspace-flows.feature:173](workspace-flows.feature#L173) | [workspace](audit/workspace.md) |
| ux-compaction-001 | Render compaction using supplied status state | [compose/compaction-model-switch.feature:6](../compose/compaction-model-switch.feature#L6) | [adjacent](audit/adjacent.md) |
| ux-compaction-002 | Reconcile compaction events with client status | [compose/compaction-model-switch.feature:13](../compose/compaction-model-switch.feature#L13) | [adjacent](audit/adjacent.md) |
| ux-compaction-003 | Request stop through the visible compaction control | [compose/compaction-model-switch.feature:21](../compose/compaction-model-switch.feature#L21) | [adjacent](audit/adjacent.md) |
| ux-compaction-004 | Use refreshed usage rather than assume compaction always shrinks context | [compose/compaction-model-switch.feature:28](../compose/compaction-model-switch.feature#L28) | [adjacent](audit/adjacent.md) |
| ux-compaction-005 | Display temporary compaction suppression | [compose/compaction-model-switch.feature:35](../compose/compaction-model-switch.feature#L35) | [adjacent](audit/adjacent.md) |
| ux-compaction-006 | Check model context compatibility before switching | [compose/compaction-model-switch.feature:42](../compose/compaction-model-switch.feature#L42) | [adjacent](audit/adjacent.md) |
| ux-compaction-007 | Refresh model information after an accepted switch | [compose/compaction-model-switch.feature:49](../compose/compaction-model-switch.feature#L49) | [adjacent](audit/adjacent.md) |
| ux-compaction-008 | Handle a model command using the configured provider catalogue | [compose/compaction-model-switch.feature:56](../compose/compaction-model-switch.feature#L56) | [adjacent](audit/adjacent.md) |
| ux-compose-001 | Clear captured content while allowing a new draft | [compose/compose-stability.feature:6](../compose/compose-stability.feature#L6) | [adjacent](audit/adjacent.md) |
| ux-compose-002 | Restore a failed submission alongside newer text | [compose/compose-stability.feature:14](../compose/compose-stability.feature#L14) | [adjacent](audit/adjacent.md) |
| ux-compose-003 | Reject an entirely empty submission | [compose/compose-stability.feature:23](../compose/compose-stability.feature#L23) | [adjacent](audit/adjacent.md) |
| ux-compose-004 | Return a queued message replaces the current editor draft | [compose/compose-stability.feature:29](../compose/compose-stability.feature#L29) | [adjacent](audit/adjacent.md) |
| ux-compose-005 | Keep upload progress separate from sending state | [compose/compose-stability.feature:37](../compose/compose-stability.feature#L37) | [adjacent](audit/adjacent.md) |
| ux-compose-006 | Submit captures the destination chat | [compose/compose-stability.feature:45](../compose/compose-stability.feature#L45) | [adjacent](audit/adjacent.md) |
| ux-context-001 | Show supplied usage in the context tooltip | [compose/context-meter-tooltip.feature:6](../compose/context-meter-tooltip.feature#L6) | [adjacent](audit/adjacent.md) |
| ux-context-002 | Display missing token counts without inventing them | [compose/context-meter-tooltip.feature:13](../compose/context-meter-tooltip.feature#L13) | [adjacent](audit/adjacent.md) |
| ux-context-003 | Offer compaction only when a callback exists | [compose/context-meter-tooltip.feature:20](../compose/context-meter-tooltip.feature#L20) | [adjacent](audit/adjacent.md) |
| ux-context-004 | Show the supplied compaction title and elapsed label | [compose/context-meter-tooltip.feature:29](../compose/context-meter-tooltip.feature#L29) | [adjacent](audit/adjacent.md) |
| ux-context-005 | Apply the coded usage warning colours | [compose/context-meter-tooltip.feature:37](../compose/context-meter-tooltip.feature#L37) | [adjacent](audit/adjacent.md) |
| ux-shell-001 | Menu contains New file, Refresh tree, Reindex workspace | [compose/hamburger-layout-scale.feature:12](../compose/hamburger-layout-scale.feature#L12) | [adjacent](audit/adjacent.md) |
| ux-shell-002 | Menu contains hidden files toggle | [compose/hamburger-layout-scale.feature:20](../compose/hamburger-layout-scale.feature#L20) | [adjacent](audit/adjacent.md) |
| ux-shell-003 | Workspace items disabled in chat-only mode | [compose/hamburger-layout-scale.feature:27](../compose/hamburger-layout-scale.feature#L27) | [adjacent](audit/adjacent.md) |
| ux-shell-004 | Terminal and VNC menu controls depend on callbacks | [compose/hamburger-layout-scale.feature:32](../compose/hamburger-layout-scale.feature#L32) | [adjacent](audit/adjacent.md) |
| ux-shell-005 | Compose box spans full width | [compose/hamburger-layout-scale.feature:40](../compose/hamburger-layout-scale.feature#L40) | [adjacent](audit/adjacent.md) |
| ux-shell-006 | Hamburger button visible and above safe area | [compose/hamburger-layout-scale.feature:45](../compose/hamburger-layout-scale.feature#L45) | [adjacent](audit/adjacent.md) |
| ux-shell-007 | Tab close does not activate tab | [compose/hamburger-layout-scale.feature:51](../compose/hamburger-layout-scale.feature#L51) | [adjacent](audit/adjacent.md) |
| ux-shell-008 | Menu contains display scale control | [compose/hamburger-layout-scale.feature:58](../compose/hamburger-layout-scale.feature#L58) | [adjacent](audit/adjacent.md) |
| ux-shell-009 | Inline code in editor preview is monospaced | [compose/hamburger-layout-scale.feature:65](../compose/hamburger-layout-scale.feature#L65) | [adjacent](audit/adjacent.md) |
| ux-compose-007 | Display an accepted text submission | [compose/instant-visibility.feature:7](../compose/instant-visibility.feature#L7) | [adjacent](audit/adjacent.md) |
| ux-compose-008 | Serialize text and references into one submission | [compose/instant-visibility.feature:14](../compose/instant-visibility.feature#L14) | [adjacent](audit/adjacent.md) |
| ux-compose-009 | Preserve the association between uploaded files and media identifiers | [compose/instant-visibility.feature:21](../compose/instant-visibility.feature#L21) | [adjacent](audit/adjacent.md) |
| ux-compose-010 | Do not erase newer typing after send completes | [compose/instant-visibility.feature:28](../compose/instant-visibility.feature#L28) | [adjacent](audit/adjacent.md) |
| ux-compose-011 | Reconcile visible messages through timeline state | [compose/instant-visibility.feature:35](../compose/instant-visibility.feature#L35) | [adjacent](audit/adjacent.md) |
| ux-reconnect-001 | Clear transient agent displays while disconnected | [compose/sse-reconnection.feature:6](../compose/sse-reconnection.feature#L6) | [adjacent](audit/adjacent.md) |
| ux-reconnect-002 | Refresh authoritative chat state after reconnect | [compose/sse-reconnection.feature:14](../compose/sse-reconnection.feature#L14) | [adjacent](audit/adjacent.md) |
| ux-reconnect-003 | Avoid replacing an active search with main-timeline refresh | [compose/sse-reconnection.feature:21](../compose/sse-reconnection.feature#L21) | [adjacent](audit/adjacent.md) |
| ux-reconnect-004 | Show version drift without automatically reloading | [compose/sse-reconnection.feature:28](../compose/sse-reconnection.feature#L28) | [adjacent](audit/adjacent.md) |
| ux-reconnect-005 | Avoid duplicate initial refresh after recent chat activation | [compose/sse-reconnection.feature:36](../compose/sse-reconnection.feature#L36) | [adjacent](audit/adjacent.md) |
| ux-theme-001 | /theme with no arguments shows available themes | [compose/theme-tint.feature:11](../compose/theme-tint.feature#L11) | [settings-existing](audit/settings-existing.md) |
| ux-theme-002 | /theme ristretto applies dark theme visually | [compose/theme-tint.feature:17](../compose/theme-tint.feature#L17) | [settings-existing](audit/settings-existing.md) |
| ux-theme-003 | /theme default restores from ristretto visually | [compose/theme-tint.feature:30](../compose/theme-tint.feature#L30) | [settings-existing](audit/settings-existing.md) |
| ux-theme-004 | /theme dark returns error — not a valid theme name | [compose/theme-tint.feature:41](../compose/theme-tint.feature#L41) | [settings-existing](audit/settings-existing.md) |
| ux-theme-005 | /theme survives page refresh | [compose/theme-tint.feature:48](../compose/theme-tint.feature#L48) | [settings-existing](audit/settings-existing.md) |
| ux-theme-006 | /tint hex changes accent and background on default theme | [compose/theme-tint.feature:56](../compose/theme-tint.feature#L56) | [settings-existing](audit/settings-existing.md) |
| ux-theme-007 | /tint named color works on default theme | [compose/theme-tint.feature:68](../compose/theme-tint.feature#L68) | [settings-existing](audit/settings-existing.md) |
| ux-theme-008 | Switching tints visibly changes accent color | [compose/theme-tint.feature:78](../compose/theme-tint.feature#L78) | [settings-existing](audit/settings-existing.md) |
| ux-theme-009 | /tint off clears tint and restores vanilla default | [compose/theme-tint.feature:86](../compose/theme-tint.feature#L86) | [settings-existing](audit/settings-existing.md) |
| ux-theme-010 | /tint with no args shows usage | [compose/theme-tint.feature:96](../compose/theme-tint.feature#L96) | [settings-existing](audit/settings-existing.md) |
| ux-theme-011 | /tint invalid value returns error | [compose/theme-tint.feature:102](../compose/theme-tint.feature#L102) | [settings-existing](audit/settings-existing.md) |
| ux-theme-012 | /tint survives page refresh | [compose/theme-tint.feature:109](../compose/theme-tint.feature#L109) | [settings-existing](audit/settings-existing.md) |
| ux-theme-013 | Tint on default, switch to ristretto, switch back | [compose/theme-tint.feature:117](../compose/theme-tint.feature#L117) | [settings-existing](audit/settings-existing.md) |
| ux-theme-014 | /tint on ristretto switches to default+tint | [compose/theme-tint.feature:127](../compose/theme-tint.feature#L127) | [settings-existing](audit/settings-existing.md) |
| ux-theme-015 | Round-trip visual consistency | [compose/theme-tint.feature:135](../compose/theme-tint.feature#L135) | [settings-existing](audit/settings-existing.md) |
| ux-thoughts-001 | Render collapsed thought content with disclosure state | [compose/thoughts-panel.feature:6](../compose/thoughts-panel.feature#L6) | [adjacent](audit/adjacent.md) |
| ux-thoughts-002 | Continue updating content independently of disclosure | [compose/thoughts-panel.feature:13](../compose/thoughts-panel.feature#L13) | [adjacent](audit/adjacent.md) |
| ux-thoughts-003 | Toggle thought panel expansion | [compose/thoughts-panel.feature:19](../compose/thoughts-panel.feature#L19) | [adjacent](audit/adjacent.md) |
| ux-thoughts-004 | Collapse an expanded status panel with Escape | [compose/thoughts-panel.feature:27](../compose/thoughts-panel.feature#L27) | [adjacent](audit/adjacent.md) |
| ux-thoughts-005 | Preserve text when changing disclosure state | [compose/thoughts-panel.feature:34](../compose/thoughts-panel.feature#L34) | [adjacent](audit/adjacent.md) |
| ux-editor-001 | Switching files does not cause visible flicker | [editor/editor-stability.feature:14](../editor/editor-stability.feature#L14) | [editor-terminal](audit/editor-terminal.md) |
| ux-editor-002 | Closing an unsaved tab shows confirmation | [editor/editor-stability.feature:22](../editor/editor-stability.feature#L22) | [editor-terminal](audit/editor-terminal.md) |
| ux-editor-003 | Clicking a tab activates it immediately | [editor/editor-stability.feature:30](../editor/editor-stability.feature#L30) | [editor-terminal](audit/editor-terminal.md) |
| ux-editor-004 | Markdown preview is stable during splitter resize | [editor/editor-stability.feature:40](../editor/editor-stability.feature#L40) | [editor-terminal](audit/editor-terminal.md) |
| ux-editor-005 | Zen mode keeps editor content visible while other shell panes are hidden | [editor/editor-stability.feature:49](../editor/editor-stability.feature#L49) | [editor-terminal](audit/editor-terminal.md) |
| ux-pwa-001 | Serve a manifest with declared application icons | [mobile/pwa-manifest.feature:7](../mobile/pwa-manifest.feature#L7) | [adjacent](audit/adjacent.md) |
| ux-pwa-002 | Use configured agent-avatar URLs for manifest icons | [mobile/pwa-manifest.feature:14](../mobile/pwa-manifest.feature#L14) | [adjacent](audit/adjacent.md) |
| ux-pwa-003 | Fall back to static icons without an avatar | [mobile/pwa-manifest.feature:21](../mobile/pwa-manifest.feature#L21) | [adjacent](audit/adjacent.md) |
| ux-pwa-004 | Request sized Apple touch icons | [mobile/pwa-manifest.feature:27](../mobile/pwa-manifest.feature#L27) | [adjacent](audit/adjacent.md) |
| ux-pwa-005 | Prefer PNG avatars for favicon compatibility | [mobile/pwa-manifest.feature:42](../mobile/pwa-manifest.feature#L42) | [adjacent](audit/adjacent.md) |
| ux-pwa-006 | Vary avatar icon cache URLs with the avatar version | [mobile/pwa-manifest.feature:50](../mobile/pwa-manifest.feature#L50) | [adjacent](audit/adjacent.md) |
| ux-mobile-001 | Swipe on eligible timeline space | [mobile/swipe-independence.feature:7](../mobile/swipe-independence.feature#L7) | [adjacent](audit/adjacent.md) |
| ux-mobile-002 | Ignore gestures originating in excluded controls | [mobile/swipe-independence.feature:15](../mobile/swipe-independence.feature#L15) | [adjacent](audit/adjacent.md) |
| ux-mobile-003 | Permit designated thinking and status panel targets | [mobile/swipe-independence.feature:31](../mobile/swipe-independence.feature#L31) | [adjacent](audit/adjacent.md) |
| ux-mobile-004 | Keep swipe order stable as the selected chat changes | [mobile/swipe-independence.feature:38](../mobile/swipe-independence.feature#L38) | [adjacent](audit/adjacent.md) |
| ux-mobile-005 | Do not treat primarily vertical movement as chat navigation | [mobile/swipe-independence.feature:46](../mobile/swipe-independence.feature#L46) | [adjacent](audit/adjacent.md) |
| ux-mobile-006 | Limit horizontal wheel navigation to the supported Safari path | [mobile/swipe-independence.feature:52](../mobile/swipe-independence.feature#L52) | [adjacent](audit/adjacent.md) |
| ux-terminal-001 | Open terminal standalone without garbled output | [panes/terminal.feature:12](../panes/terminal.feature#L12) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-002 | Execute ls -al in terminal | [panes/terminal.feature:20](../panes/terminal.feature#L20) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-003 | Terminal opens clean without IME active | [panes/terminal.feature:28](../panes/terminal.feature#L28) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-004 | Close terminal via tab close button (click) | [panes/terminal.feature:35](../panes/terminal.feature#L35) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-005 | Close terminal via tab close button (tap) | [panes/terminal.feature:43](../panes/terminal.feature#L43) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-006 | Pop out terminal to new window (desktop) | [panes/terminal.feature:50](../panes/terminal.feature#L50) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-007 | Terminal theme matches UI theme | [panes/terminal.feature:57](../panes/terminal.feature#L57) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-008 | Toggle terminal dock via keyboard shortcut | [panes/terminal.feature:70](../panes/terminal.feature#L70) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-009 | Toggle terminal dock via tab strip button | [panes/terminal.feature:79](../panes/terminal.feature#L79) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-010 | Dock splitter resizes terminal height | [panes/terminal.feature:87](../panes/terminal.feature#L87) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-011 | Terminal dock is interactive alongside editor | [panes/terminal.feature:98](../panes/terminal.feature#L98) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-012 | Dock hidden in zen mode | [panes/terminal.feature:107](../panes/terminal.feature#L107) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-013 | Zen mode hides all chrome except the terminal/editor | [panes/terminal.feature:119](../panes/terminal.feature#L119) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-014 | Zen mode has a hover-discoverable exit control | [panes/terminal.feature:127](../panes/terminal.feature#L127) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-015 | Clicking zen exit indicator reverts to normal layout | [panes/terminal.feature:135](../panes/terminal.feature#L135) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-016 | Escape key exits zen mode | [panes/terminal.feature:144](../panes/terminal.feature#L144) | [editor-terminal](audit/editor-terminal.md) |
| ux-terminal-017 | Hover-reveal tab strip in zen mode | [panes/terminal.feature:152](../panes/terminal.feature#L152) | [editor-terminal](audit/editor-terminal.md) |
| ux-session-001 | Show the selected chat's timeline | [sessions/session-switching.feature:6](../sessions/session-switching.feature#L6) | [adjacent](audit/adjacent.md) |
| ux-session-002 | Group picker entries using the current session metadata | [sessions/session-switching.feature:14](../sessions/session-switching.feature#L14) | [adjacent](audit/adjacent.md) |
| ux-session-003 | Filter session entries using their search metadata | [sessions/session-switching.feature:21](../sessions/session-switching.feature#L21) | [adjacent](audit/adjacent.md) |
| ux-session-004 | Use archive and restore actions supplied for session entries | [sessions/session-switching.feature:28](../sessions/session-switching.feature#L28) | [adjacent](audit/adjacent.md) |
| ux-session-005 | Keep touch swipe eligibility independent of picker grouping | [sessions/session-switching.feature:36](../sessions/session-switching.feature#L36) | [adjacent](audit/adjacent.md) |
| ux-session-006 | Dismiss the session picker without choosing an entry | [sessions/session-switching.feature:44](../sessions/session-switching.feature#L44) | [adjacent](audit/adjacent.md) |
| ux-settings-dialog-001 | Rapid shortcut presses open exactly one settings dialog | [settings/settings-dialog.feature:11](../settings/settings-dialog.feature#L11) | [settings-existing](audit/settings-existing.md) |
| ux-settings-dialog-002 | Second settings open is instant | [settings/settings-dialog.feature:18](../settings/settings-dialog.feature#L18) | [settings-existing](audit/settings-existing.md) |
| ux-settings-dialog-003 | Settings shows loading shell then content | [settings/settings-dialog.feature:27](../settings/settings-dialog.feature#L27) | [settings-existing](audit/settings-existing.md) |
| ux-settings-dialog-004 | User can type a number in stepper fields | [settings/settings-dialog.feature:35](../settings/settings-dialog.feature#L35) | [settings-existing](audit/settings-existing.md) |
| ux-settings-dialog-005 | Non-General panes load only on click | [settings/settings-dialog.feature:43](../settings/settings-dialog.feature#L43) | [settings-existing](audit/settings-existing.md) |
| ux-settings-layering-001 | Settings backdrop covers workspace pane | [settings/settings-layering.feature:11](../settings/settings-layering.feature#L11) | [settings-existing](audit/settings-existing.md) |
| ux-settings-layering-002 | Settings dialog is above all other elements | [settings/settings-layering.feature:19](../settings/settings-layering.feature#L19) | [settings-existing](audit/settings-existing.md) |
| ux-settings-layering-003 | Backdrop is partially opaque (not fully transparent or opaque) | [settings/settings-layering.feature:28](../settings/settings-layering.feature#L28) | [settings-existing](audit/settings-existing.md) |
| ux-settings-layering-004 | Only settings dialog is interactive above the backdrop | [settings/settings-layering.feature:35](../settings/settings-layering.feature#L35) | [settings-existing](audit/settings-existing.md) |
| ux-timeline-001 | iPad image tap opens the inline annotator | [timeline/annotation-highlights.feature:13](../timeline/annotation-highlights.feature#L13) | [timeline](audit/timeline.md) |
| ux-timeline-002 | Two-finger gestures pinch instead of drawing | [timeline/annotation-highlights.feature:22](../timeline/annotation-highlights.feature#L22) | [timeline](audit/timeline.md) |
| ux-timeline-003 | Applying crop reduces the working image and resets crop state | [timeline/annotation-highlights.feature:30](../timeline/annotation-highlights.feature#L30) | [timeline](audit/timeline.md) |
| ux-timeline-004 | Done uploads a flattened PNG and queues a preview | [timeline/annotation-highlights.feature:40](../timeline/annotation-highlights.feature#L40) | [timeline](audit/timeline.md) |
| ux-timeline-005 | Cancel closes the annotator without queuing a preview | [timeline/annotation-highlights.feature:49](../timeline/annotation-highlights.feature#L49) | [timeline](audit/timeline.md) |
| ux-timeline-006 | Non-iPad image activation opens the lightbox instead | [timeline/annotation-highlights.feature:57](../timeline/annotation-highlights.feature#L57) | [timeline](audit/timeline.md) |
| ux-timeline-007 | SVG sources are rasterized before PNG export | [timeline/annotation-highlights.feature:66](../timeline/annotation-highlights.feature#L66) | [timeline](audit/timeline.md) |
| ux-timeline-008 | Selecting text shows highlight colors | [timeline/annotation-highlights.feature:79](../timeline/annotation-highlights.feature#L79) | [timeline](audit/timeline.md) |
| ux-timeline-009 | Clicking a highlight color persists the saved selection snapshot | [timeline/annotation-highlights.feature:86](../timeline/annotation-highlights.feature#L86) | [timeline](audit/timeline.md) |
| ux-timeline-010 | Highlights persist via post annotations | [timeline/annotation-highlights.feature:95](../timeline/annotation-highlights.feature#L95) | [timeline](audit/timeline.md) |
| ux-timeline-011 | Desktop highlight toolbar stays near the selection | [timeline/annotation-highlights.feature:102](../timeline/annotation-highlights.feature#L102) | [timeline](audit/timeline.md) |
| ux-timeline-012 | Coarse-pointer highlight toolbar docks away from the selection | [timeline/annotation-highlights.feature:110](../timeline/annotation-highlights.feature#L110) | [timeline](audit/timeline.md) |
| ux-timeline-013 | Escape key dismisses the lightbox | [timeline/lightbox-dismissal.feature:12](../timeline/lightbox-dismissal.feature#L12) | [timeline](audit/timeline.md) |
| ux-timeline-014 | Non-Escape keys do not dismiss the lightbox | [timeline/lightbox-dismissal.feature:20](../timeline/lightbox-dismissal.feature#L20) | [timeline](audit/timeline.md) |
| ux-timeline-015 | Clicking anywhere inside the modal dismisses the lightbox | [timeline/lightbox-dismissal.feature:27](../timeline/lightbox-dismissal.feature#L27) | [timeline](audit/timeline.md) |
| ux-timeline-016 | Tapping the modal surface on a touch device dismisses the lightbox | [timeline/lightbox-dismissal.feature:34](../timeline/lightbox-dismissal.feature#L34) | [timeline](audit/timeline.md) |
| ux-timeline-017 | Delete a single message without visible replies | [timeline/message-deletion.feature:12](../timeline/message-deletion.feature#L12) | [timeline](audit/timeline.md) |
| ux-timeline-018 | Backend reply detection asks for a second confirmation before retrying cascade | [timeline/message-deletion.feature:21](../timeline/message-deletion.feature#L21) | [timeline](audit/timeline.md) |
| ux-timeline-019 | Cancelling the backend follow-up prompt preserves the message | [timeline/message-deletion.feature:30](../timeline/message-deletion.feature#L30) | [timeline](audit/timeline.md) |
| ux-timeline-020 | Deleting a message with 3 visible replies asks for cascade confirmation | [timeline/message-deletion.feature:38](../timeline/message-deletion.feature#L38) | [timeline](audit/timeline.md) |
| ux-timeline-021 | Confirming cascade deletes the parent and visible replies together | [timeline/message-deletion.feature:45](../timeline/message-deletion.feature#L45) | [timeline](audit/timeline.md) |
| ux-timeline-022 | Cancelling cascade preserves the parent and visible replies | [timeline/message-deletion.feature:55](../timeline/message-deletion.feature#L55) | [timeline](audit/timeline.md) |
| ux-timeline-023 | Markdown tables render as full-width tables with automatic layout | [timeline/rendering.feature:11](../timeline/rendering.feature#L11) | [timeline](audit/timeline.md) |
| ux-timeline-024 | Code blocks expose a copy button in the top-right corner | [timeline/rendering.feature:18](../timeline/rendering.feature#L18) | [timeline](audit/timeline.md) |
| ux-timeline-025 | Resource links and link previews open in a new tab | [timeline/rendering.feature:26](../timeline/rendering.feature#L26) | [timeline](audit/timeline.md) |
| ux-timeline-026 | Outcome chips render after the timestamp in post metadata | [timeline/rendering.feature:34](../timeline/rendering.feature#L34) | [timeline](audit/timeline.md) |
| ux-timeline-027 | Read aloud appears only when browser speech support and speakable text both exist | [timeline/rendering.feature:41](../timeline/rendering.feature#L41) | [timeline](audit/timeline.md) |
| ux-timeline-028 | Starting read aloud on another post transfers playback ownership | [timeline/rendering.feature:49](../timeline/rendering.feature#L49) | [timeline](audit/timeline.md) |
