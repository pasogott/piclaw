# Web UI

Piclaw ships with a single-user streaming web UI that combines chat, workspace,
editor, terminal, viewers, and lightweight control surfaces in one app.

This page describes the supported single-user UI and gated [family development work](multi-user/README.md). Startup still rejects family and isolated modes. A restricted invitation/QR page, mode-aware login, separate text shell and personal/session/administration panels are implemented behind that gate. Remaining Settings and the complete browser workflow need integration before deployment is supported. Do not treat the single-user session picker or multiple browser tabs as separate user accounts.

## Login

The login shell loads non-secret mode/method flags before enabling credential inputs. Single-user code login remains code-only; the gated family policy adds an account username. Passkey-only and code-only policies hide unsupported controls. An explicit passkey button can replace a pending conditional prompt. Network/policy failures show retry without weakening the selected authentication method. This does not complete the family account/Settings UI or enable family startup.

## Restricted invitation setup (gated family backend)

An administrator can privately deliver `/auth/invitation#token=<grant>`. The page removes the grant from history, waits for Begin, then displays the new authenticator QR/manual key and a confirmation form. Confirmation enables only the invited account and directs the user to ordinary login. No account cookie is issued. Secrets are kept in memory and cleared on success, expiry or navigation; a failed/lost claim needs a new invitation. The gated administration panel can issue/revoke these links; neither page bypasses the family startup gate.

## Family text shell (gated)

The family router serves a separate shell rather than the classic or visual app. It selects the owned home on a fresh login, offers an owned-session picker and polls the most recent 100 text messages. Explicit foreign session links fail instead of silently selecting home. Text is rendered without HTML, rich blocks, add-ons, panes or legacy browser-storage imports. Unchanged manual send retries reuse an in-memory request ID; no automatic retry is performed.

Requests include account/login pins derived from the authenticated principal. The server compares them with the cookie, and the client rechecks identity before rendering each response. A changed or revoked login clears the page and draft. Background tabs mask private UI until revalidation; pagehide and back/forward-cache restoration discard it. Sign out revokes only the original pinned login and does not overwrite a replacement cookie from another tab.

Before fetching private data, the shell unregisters existing origin service workers and deletes Cache Storage entries. If a worker still controls the page, it stops and asks the user to close other tabs and reload. This cannot repair a legacy worker that serves an old shell without reaching the server; origin/cache migration and old-tab integration evidence remain release gates. The shell does not read or write localStorage/sessionStorage or promise filesystem isolation.

The shell polls metadata-only recovery status for the selected owned session. It shows retry/skip only for the oldest held input, requires explicit skip confirmation and reuses request IDs for unchanged manual retries. Recovery mutations still require authentication within five minutes; changing session/login clears the controls. Status reads reveal neither failure details nor prompt text.

**My account** uses a live, owner-only GET `/account` snapshot for profile fields, factor metadata, signed-in devices and capability hints. It supports username/display-name changes, adding independent passkeys, eligible factor removal and device revocation. Sensitive actions require a sign-in within five minutes. Removing a factor signs out every device; a checkbox confirms that effect. The last usable factor cannot be removed. Current-site passkey usability and the current login are identified without exposing secrets.

The panel discards account form drafts on blur, close, session switch and navigation. Passkey prompts may temporarily blur it; the original login is rechecked before a credential is submitted. Native registration is cancelled on close/navigation. Failed writes are never automatically retried. Same-account label changes update the shell without changing account/login pins.

Each owned passkey and signed-in device has a Name control, enabled by the server only for recent authentication. Names are plain-text display labels of up to 80 Unicode characters; whitespace is trimmed, controls/format characters are rejected, and blank clears the label. Duplicate names are allowed. Exact credential/login IDs remain visible and select every operation; labels never grant authority or verify a device's identity. A device label belongs to that login and disappears on expiry/revocation; a new login starts unnamed. Naming does not replace credentials, change counters or revoke logins.

Add authenticator starts a five-minute, login-bound TOTP ceremony when permitted by server policy and no factor already exists. The new QR/manual key appears once; confirm a six-digit code from the authenticator to add it without changing existing passkeys or logins. There are at most five code attempts. Cancel deletes the pending setup. Blur, close, refresh, expiry and navigation erase displayed secrets; closing alone does not send a cancellation request. A lost start response needs a new explicit setup, which supersedes the previous pending one. No stored TOTP seed can be displayed or overwritten.

**My sessions** lists owned roots, forks and archives with server-provided action eligibility. It supports root creation, fork, friendly rename, home selection, archive and restore. Archive and home changes require a checked confirmation. Archive retains history/files and requires an idle session with archived descendants; restore requires active parents and an available handle. A fork uses a stable request ID for unchanged manual retries while its form stays open. Closing or backgrounding the panel discards that form and its retry key; check the refreshed list before issuing a new operation. No writes are automatically retried.

These controls never silently navigate to a new root, fork or home. Use Open or Go home explicitly. Archiving the current conversation leaves its target selected in the URL and denies further access until it is restored or another owned session is selected. Eligibility is a snapshot; the backend independently rechecks ownership, graph, recent authentication for home selection and runtime readiness. Pending responses cannot re-enable background controls or restore cleared forms.

**Family administration** appears only when the authenticated server capability permits account management. Its separate snapshot exposes account labels, enabled/role state, invitation state and action eligibility, without foreign session identifiers or factors. It supports disabled account creation, disable/reactivate, role changes, invitation issue/revoke and other-account reset through the existing backend APIs. Each existing-account change needs the exact target username and a checked confirmation. Reset explicitly disables the target, removes every factor, signs out its devices and issues a restricted authenticator invitation. It never opens a target conversation or switches the acting account.

An issued invitation link appears once in a read-only field, with no automatic clipboard write or navigation. Blur, close, refresh, expiry, session switch and navigation erase it. Clearing the display does not revoke the grant. Late responses cannot restore a cleared link; lost results require explicit revocation/reissue. Server capabilities account for recent authentication, last-enabled-admin protection, owned home and current-site factor policy; writes independently recheck these conditions.

Each other account also has a Security action, available after recent administrator authentication. This separate view lists factor and signed-in-device names, non-secret IDs and removal eligibility. Revoke device login affects one exact login and its pending registrations; Remove factor signs out every target device and cannot remove the last usable factor. Both require the exact target username and a checkbox, and write an actor/target audit record atomically. They do not change the active account or conversation. Own security controls remain in My account. Closing/backgrounding clears details and confirmation, and stale replies cannot restore them.

The administrator Home action lists another account's eligible active owned roots by handle and branch ID, marking the current home. Assign home requires the exact account username and a checkbox. The change affects future sign-ins and targetless requests without opening content, transferring ownership, changing logins or moving existing runs/tabs. A repeated assignment to the same home has no new effect. Empty eligibility never falls back to an administrator or global root. Details clear on close/backgrounding and stale responses cannot restore them. Container destinations have separate deployment prerequisites and cannot be assigned here.

**Workspace and security** is a read-only view of sharing boundaries, memory-selection paths, broad Settings scopes and the fixed eight-tool ceiling for admitted family web turns. It separates routing, configured mode and the stored activation marker, and reports single-user as the only supported startup mode. It does not enumerate installed add-ons, credentials or configuration values, edit grants, activate a mode or restart the service. Shared files and owner-selected memory are explicitly distinguished from private volume isolation.

The tool list is a ceiling, not an active-tool inventory or general role profile. It shows effective allowed names, per-account denials and the policy revision. Unknown tools deny in the family run-tool controller, callers cannot widen its ceiling, and missing tool controls or policy snapshots fail before prompting. Other direct/queued/add-on entry points and shared-resource policy still need integrated release verification. The panel clears on close/backgrounding/identity replacement and rejects unsupported activation claims.

Administrators have a separate Tool restrictions action for each account, including their own. Checked names are denied for new model runs; clearing a denial restores only tools already inside the preview ceiling. Saving requires the exact username, a checkbox and the last-read revision, preventing one editor from overwriting another. Policy and audit commit together. Active runs retain their frozen policy through recovery; changes do not cancel them. Browser account controls are unaffected, so restricting an administrator's model tools cannot lock out administration. Form state clears on close/blur/navigation and writes never auto-retry.

The messages runner, chat directory registry, session control/inspection and session-status tool also check that run snapshot on direct invocation, before accessing data or calling runtime handlers. Family sessions install guarded local read/search definitions and deny shell/file mutation, including direct calls through the SDK registry. Guards revalidate live account/login/source ownership before execution and before releasing read output, while retaining next-run policy semantics. A tool-call hook rejects SDK-routed unknown/denied extension calls. Family hydration skips per-chat SSH setup. Installed extension code, general registration inventories and other direct model/queue paths still need integrated enforcement; the preview remains gated and permitted filesystem reads remain shared.

This preview is English-only. Avatar changes, container destination assignment, attachments, streaming and pagination are unfinished. Session merge, purge and full archive backup are unavailable. Shared/provider/deployment editors, complete setting/add-on classification and broader role/capability profiles are unfinished; single-user classic/visual Settings are unchanged. Chromium virtual-authenticator tests cover adding two independent keys; physical authenticator/device coverage is incomplete. The following sections describe the supported **single-user** UI.

## Chat and status surfaces

### Streaming chat

- thought and draft panels during streaming
- live steering and queued follow-ups
- Adaptive Cards with persisted submissions
- `/btw` side conversations
- file attachments, link previews, and threaded turns
- syntax-highlighted previews for common text/code attachments
- theme and tint controls via `/theme` and `/tint`

### Tool and turn status

The status surface is designed to keep the most useful in-flight context visible
instead of collapsing everything into generic waiting copy.

Current behavior:

- active `tool_call` / `tool_status` rows stay visible during silence probing
  instead of being replaced immediately by `Waiting for model…`
- recent-activity restore keeps the last meaningful status payload when the web
  UI reconnects or when you return to an active chat
- tool-status rows can show an age hint in the meta row, alongside git/status
  metadata, using a small clock icon and labels like `10s ago` or `2m 3s ago`
- intent panels can also show an elapsed-time hint once they have been active
  for at least 10 seconds
- recovered turns can render a compact `recovered` chip in the message metadata
  row
- timed-out turns can render a compact `timeout` chip in the message metadata
  row, plus a salvaged partial draft in the timeline fallback post

### Timeout and recovery UX

When a turn stalls or times out, Piclaw preserves partial context where possible:

- preserve the last visible tool action when possible
- preserve the last draft in the draft panel when the turn stalls
- append a local fallback timeline post containing the salvaged partial draft
- attach a visible timeout marker so the fallback is distinguishable from a
  normal answer

See [runtime-flows.md](runtime-flows.md) for the runtime-level details.

## Workspace

- sidebar file browser with auto-refresh
- drag-and-drop upload progress
- client-side 256 MB upload guard before the request starts
- file-reference pills in prompts
- folder sizes in the starburst explorer
- workspace search index status with one-click reindex from the explorer header

## Editor

- CodeMirror 6 editor
- syntax highlighting for JS/TS, Python, Go, JSON, CSS, HTML, YAML, SQL,
  XML/SVG, Markdown, and Shell
- search and replace
- dirty-state tracking
- line wrapping
- lazy-loaded local bundle with no CDN dependency

## Terminal

- bundled xterm.js web terminal
- authenticated shell session in the browser
- dock panel or standalone tab
- detachable into popout windows with live session transfer
- enabled by default on Linux and macOS
- disabled by default on Windows unless explicitly enabled
- optional Ghostty renderer available through the `@rcarmo/piclaw-addon-ghostty-terminal` add-on

Configuration details live in [configuration.md](configuration.md).

## Viewers and panes

- **Draw.io add-on** — optional self-hosted editor with SVG/PNG/XML export back to workspace
- **Office viewer add-on** — `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`, `.odp`; backend supplied by the optional Office add-on
- **CSV/TSV** — dedicated table viewer
- **PDF, images, video** — inline viewers
- **Text/code attachments** — timeline preview modal for common code/config
  formats
- **Kanban boards** — `*.kanban.md` in a drag-and-drop board editor via the
  `kanban-editor` add-on (Obsidian Kanban compatible)
- **VNC remote display** — connect to allowlisted targets from a tab; direct
  targets are enabled by default on Linux/macOS/Windows and can be disabled
  with `PICLAW_WEB_VNC_ALLOW_DIRECT=0`

## Automation and integrations

- **`/image` and `/flux`** — workspace-backed image generation commands for
  Azure OpenAI / Foundry; `/image` supports `--transparent` when the selected
  model can generate transparent PNG output
- **`image_process`** — sharp-backed workspace image manipulation for resize,
  crop, convert, optimise, metadata inspection, text/SVG/composite operations,
  and animated GIF workflows
- **`cdp_browser`** — Chromium/Edge/Chrome automation via CDP for navigation,
  DOM clicking, JS evaluation, and screenshots
- **`mcp` via `pi-mcp-adapter`** — token-efficient MCP access through
  shared `.mcp.json` plus optional Pi-specific `.pi/mcp.json` overrides
- **Remote Peer add-on** — optional paired-instance messaging and mediated work through generic core add-on transport APIs
- **[Microsoft 365 add-on](https://rcarmo.github.io/piclaw-addons/addons/m365/)** — optional browser-auth automation for Teams, Graph, OneDrive, SharePoint, and calendar flows
- **`win_*` tools** — Windows-only desktop automation via Win32 FFI

## Related docs

- [configuration.md](configuration.md) — ports, auth, terminal, VNC, runtime
  knobs, and workspace env hook
- [tools-and-skills.md](tools-and-skills.md) — internal tools, skills, and
  slash commands
- [Remote Peer add-on](https://rcarmo.github.io/piclaw-addons/addons/remote-peer/) — pairing, signed messaging, policy, and mediated work
- [Microsoft 365 add-on](https://rcarmo.github.io/piclaw-addons/addons/m365/) — Teams, Graph, Outlook, OneDrive, SharePoint, Calendar, and To Do tools
- [runtime-flows.md](runtime-flows.md) — session lifecycle, reconnect behavior,
  recovery, and timeout handling
- [web-pane-extensions.md](web-pane-extensions.md) — pane extension model
- [extension-ui-contract.md](extension-ui-contract.md) — event bridge contract
