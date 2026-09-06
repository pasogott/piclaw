# Family preview user guide

Piclaw currently supports **single-user deployments only**. Family and isolated modes cannot start in a supported installation. This guide covers the implemented family preview for controlled testing and explains which workflows still need release verification. It is not an instruction to enable family mode or change a database marker.

For the supported single-user app, see [Web UI](../web-ui.md). For family testing, use this guide with the [administrator guide](administrator-guide.md) and [troubleshooting](troubleshooting.md). Operators have separate [migration](migration-copy.md) and [offline recovery](operator-recovery.md) runbooks. Developers can check [implementation status](README.md).

## Accounts, conversations and shared files

- Your **account** identifies you for sign-in, personal preferences and conversation ownership.
- A **root session** starts an independent conversation tree. A **fork** is a child conversation copied from a stable point in an owned session. Forks can have their own children.
- Your **home** is the root used after a fresh sign-in or when you have not selected a conversation.
- A **handle** is a friendly session name such as `research`. Renaming it does not change the conversation's internal ID or stored history. Different accounts can use the same handle; your active sessions must have distinct names within your account.

The family preview checks conversation ownership. An administrator can manage account metadata and authentication, but the role alone does not open another person's conversation or avatar. An administrator can reset another account's sign-in factors; treat that as a powerful, trusted role.

**Workspace files are shared between tool-capable users.** Skills, add-ons, provider configuration and permitted integration credentials belong to the instance. Personal memory is selected by immutable account ID, but those files still live on the shared filesystem. Do not put private material in shared workspace files expecting account-level file isolation. The host operator and privileged installed code remain trusted.

## Accept an invitation

An administrator first creates a disabled account with its own home. The invitation lets you prove possession of a first sign-in factor. It does not sign you in as someone else or give you access before setup is confirmed.

Use the exact trusted HTTPS address supplied by your operator. Do not ignore a certificate warning or switch to an unrecognised hostname. Passkeys belong to their configured site. Certificate/device onboarding is separate from this preview and needs operator help when trust is not established.

The link is private and expires after 15 minutes. Open the complete link privately; do not paste it into a conversation, bug report or screenshot. The page removes the token from the address bar. Reloading loses the page's copy of the token, so do not reload midway through setup. No claim occurs until you press Begin.

### Authenticator invitation

1. Choose **Begin authenticator setup**. You have five minutes to finish.
2. Check the displayed account name. If it is not yours, stop and contact the administrator.
3. Scan the QR code with an authenticator app, or enter the manual setup key in that app. Keep both private.
4. Enter the current six-digit code and choose **Confirm account setup**.
5. Wait for **Account setup complete. Sign in to continue.**, then choose **Sign in**.

Possession of a displayed setup key alone does not enable the account. Confirmation requires a valid code. There are at most five confirmation attempts; after repeated failures ask for a new invitation. If setup just succeeded but sign-in rejects the same code, wait for the authenticator's next code: accepted timesteps cannot be reused.

### Passkey invitation

1. Choose **Begin passkey setup**, then check the displayed account.
2. Choose **Create account passkey** to open the browser/device registration prompt.
3. Complete the device verification requested by the prompt. The credential must support account discovery and user verification.
4. Wait for the setup-complete message, then use the separate sign-in page.

Only one proof attempt is allowed for a passkey invitation. If it fails or is cancelled, request a new invitation rather than repeatedly submitting the same proof. **Cancel setup** clears the page; it does not revoke the server grant. The administrator can revoke it, or it will expire. A device prompt may temporarily take focus; the page rechecks the restricted setup session when the prompt returns. Ordinary blur or navigation discards passkey setup.

Physical security keys and mobile-platform flows still need release validation. Successful Chromium virtual-authenticator tests do not establish support for every device.

## Sign in and switch accounts

The sign-in page loads the site's enabled methods before accepting input:

- For an authenticator, enter **Account username** and **Authenticator code**, then choose **Verify code**.
- For a passkey, choose **Sign in with a passkey** and select the credential for your account. The browser may also offer passkey autofill.
- In passkey-only mode the code form is hidden. In authenticator-only mode the passkey option is hidden.

There are no passwords, email recovery or SSO in this account flow. Use an enabled alternative or contact an administrator if you lose access. Repeated failures are rate-limited; stop guessing and follow the retry notice.

A fresh sign-in opens your home. To change accounts, use **Sign out**, then sign in to the other account. The **Owned session** selector changes conversations within the current account; it does not change who you are signed in as.

Tabs in one browser profile share the site's login cookie. Signing in as another account can invalidate an older tab. That tab clears its conversation and draft rather than continuing under the replacement login. Use separate browser profiles when testing two accounts concurrently; a second tab is not an independent account session.

## Read and send messages

1. Check your displayed account name and select an **Owned session**, or choose **Go home**.
2. Read the current conversation. The preview shows up to the most recent 100 text messages and refreshes by polling every five seconds while active.
3. Enter plain text in **Message** and choose **Send**.
4. Wait for the queued/running status and reply. **Refresh** requests the latest state.

The family shell does not offer the classic app's rich rendering, attachments, add-on panes, terminal, live streaming or message-editing controls. Leading slash commands and `@` mentions are unsupported as prompts. Do not use the single-user UI instructions to bypass these restrictions.

If sending reports an uncertain result, refresh before changing the text. Resending the unchanged message in the same page/conversation reuses its request ID, helping prevent duplicate admission. Editing the text, switching sessions or reloading may create a new request. The page never retries a failed send automatically.

Opening an inaccessible or nonexistent conversation URL produces an error. It does not silently redirect to another conversation. Choose **Go home** as a separate action if you want to leave that URL.

### Held inputs

For an admitted message that is held after a failure or expired login:

1. Sign in again if your authentication is more than five minutes old.
2. Read the oldest held input in the conversation history.
3. Choose **Retry held message**, or check the confirmation and choose **Skip held message**.

Retry permits another attempt; it does not undo side effects from a previous attempt. If the earlier run may have changed an external system, check that system before retrying. Skip keeps the message in history without executing it. Only the oldest eligible input is offered. An unchanged manual recovery retry reuses its request ID while the page retains that action.

For a **Legacy input** held by migration, Retry is unavailable. Check the confirmation and choose **Dismiss legacy input without running**. Dismissal keeps the original content and author, and releases later eligible queue entries. If you want to execute something from old history, review it and send a new supported plain-text prompt yourself. Dismissal neither copies the old text into compose nor submits a prompt.

A **Recovery is blocked** notice needs operator inspection; do not invent an input ID or edit stored authority to bypass it.

## Manage your account

Open **My account**. A disabled control can mean the operation is prohibited, your authentication is too old, the browser lacks support, or the server is still loading. **Refresh account** reloads the current permissions and values.

Changes to names, sign-in factors, device logins and security labels require authentication within the last five minutes. Sign out and sign in again when asked. Refreshing the page does not renew that authentication window. Avatar and preference changes need a live login but do not require the five-minute window.

### Profile

Edit **Username** or **Display name**, then choose **Save profile**. Usernames contain 1–64 lowercase letters, digits, underscores or hyphens and start with a letter or digit. Names must be unique; reserved system names cannot be newly claimed. Display names accept up to 128 Unicode characters without control characters or newlines.

Renaming preserves your immutable account identity, credentials, owned conversations and saved preferences. Future UI/model context uses the updated name; earlier messages retain their original author labels. Use the new username for authenticator sign-in.

### Avatar

1. Under **Account avatar**, choose a static PNG, JPEG or WebP file.
2. Choose **Save avatar** and wait for confirmation.
3. To remove it, check **Remove my saved avatar** and choose **Confirm avatar removal**.

Files must be no larger than 2 MiB and four million pixels. The server validates the image, removes source metadata and saves a 256-pixel square. Animated images and SVG are rejected. Choosing a file does not upload or preview it automatically. The avatar appears only in your account panel in this preview; it does not change the shared avatar, assistant icon or another account.

**Refresh avatar** reloads the saved state. If another tab changed it, refresh before trying again. File selections are discarded on blur, close and navigation.

### Add a passkey

Choose **Add another passkey** and complete the native prompt. You can have several independent passkeys; adding a second does not replace the first. Keep a working alternative before removing a lost or obsolete key. The UI rechecks your original account/login after the prompt returns.

Each passkey row shows an exact credential ID, creation/use information and whether it is usable under the current site policy. A saved passkey for a different RP/site may not be a usable alternative here.

### Add an authenticator

If policy allows TOTP and none is enrolled, choose **Add authenticator**. Scan the new QR code or enter the private manual key, then submit the current code with **Confirm authenticator**. Setup lasts five minutes and allows five attempts. Confirmation adds the factor without replacing your passkeys or signing devices out.

**Cancel authenticator setup** revokes that pending setup. Closing or blurring the panel clears the displayed secret; closing alone does not revoke the server reservation. Starting a new setup supersedes the previous pending one. A confirmed old seed cannot be displayed again or overwritten through this form.

### Name or remove security items

Use **Name** beside a passkey or device login to assign a display label of up to 80 Unicode characters. Blank clears it; duplicate names are allowed. Labels are not verified device identities. Check the exact credential/login ID before a destructive action.

Choose **Remove passkey** or **Remove authenticator**, read the warning and confirm. Removing a factor signs out every device for your account. The last usable factor allowed by current policy cannot be removed. Register and verify an alternative first, or ask an administrator about recovery.

### Signed-in devices

Under **Signed-in devices**, identify **This login** or the other login you want to revoke. Choose **Sign out device**, read the exact ID in the confirmation and confirm. Revoking the current login returns you to sign-in. A device label belongs to that login and disappears when it expires or is revoked; a new login starts unnamed.

## Set personal preferences

Open **My preferences**. These settings belong to your immutable account across devices; they do not edit shared files or global Settings.

### Appearance and response guidance

Select **System**, **Light** or **Dark** appearance. Optionally enter up to 2,000 characters of **Response guidance**, such as “Use British English and concise bullets”, then choose **Save preferences**.

**Use defaults** fills the form with System appearance and empty guidance. You must still save. Another tab's newer save is not silently overwritten: a revision conflict requires **Refresh preferences** and a fresh edit. Unsaved edits are not durable drafts.

Saved guidance applies to new model runs. It cannot change permissions, account identity or higher-priority instructions. A run already in progress keeps its original guidance. Account theme updates can arrive with polling without replacing your unsaved form fields.

### Model and thinking defaults

Under **Model defaults for empty roots**, choose an available model and, optionally, one of its supported thinking levels. Choose **Save model defaults**. Leaving thinking at the instance default inherits the instance's setting for that model, or its general default, subject to model support.

This choice applies when an empty owned root first opens in the runtime. Existing conversations, resumed sessions and forks retain their saved selection. Saving a default does not switch the conversation currently open. **Use instance defaults** clears the personal override in the form; save to apply it.

The displayed effective value describes the configured default, not a running conversation. An unavailable saved choice remains visible and blocks initial creation until you choose another available model or reset. Use **Refresh model defaults** after the operator changes the catalogue. Provider credentials and model availability are managed for the shared instance, not through this form.

## Manage your sessions

Open **My sessions** to see your roots, forks, home and archives. A saved metadata change does not automatically navigate away from the current conversation. Use **Open** or **Go home** explicitly afterward.

### Create a root or fork

- For an independent conversation, enter **New root handle** and choose **Create root**.
- To continue from an owned source's stable conversation boundary, choose **Fork**, enter the new handle and choose **Save session change**.

Handles use up to 64 letters, digits, underscores or hyphens. Root creation rejects active-name collisions. Fork creation may choose a suffixed available name; check the saved list. A fork copies conversation state, not workspace files. If no stable boundary is available, wait for the running turn to settle before trying again.

An unchanged manual fork retry reuses its request ID while that action form stays open. After an uncertain response, inspect the list before closing/reopening or creating another fork.

### Rename and change home

Choose **Rename**, edit the handle and save. It changes the friendly name only; IDs, history and ownership stay intact.

Choose **Set home** for an active owned root, read the warning and confirm. This requires recent authentication. A fork or archive cannot be home. Home changes affect future landing/targetless requests, not conversations already selected in other tabs.

### Archive and restore

Choose **Archive**, review the warning and confirm. The session must be idle, cannot be your current home and cannot have active descendants. Archive descendants first; there is no automatic cascading archive. Change home first if you need to archive the old home.

Archiving retains history, files and ownership but removes normal active access. Choose **Restore** under an active parent to bring it back. If its old handle is taken, supply another name and save. Restore does not automatically open or execute the session.

Merge, purge/delete and full archive backup are not available in this panel. The developer API offers a bounded text-only archived transcript export; it is not a full backup or a family UI download feature.

## Browser state and privacy

The family shell keeps its choices and drafts in page memory, not local/session storage. Closing or reloading the page can lose unsaved work. Account/session/settings forms clear on blur, close, session switch or navigation. Backgrounding masks private UI until identity is checked again; it is not a substitute for signing out on a shared device.

A request already sent may finish after you close its panel or tab. On return, refresh the relevant list to see what happened before repeating a change. Late responses from a different login are not allowed to repopulate the old account's UI.

The shell attempts to remove old service workers and offline caches before fetching private data. If an old worker still controls the page, it stops and asks you to close other PiClaw tabs and reload. This does not prove complete migration of every old browser/PWA installation. Do not reuse an old offline installation for shared-account testing without the operator's migration checks.

## Workspace and security

Open **Workspace and security** to see sharing boundaries, memory selection, available preview tools, account restrictions and the difference between configured and activated modes. It is read-only; there is no activation switch or restart button.

Administrators may deny tools within the fixed preview set. A new run sees the new restrictions; an already-running turn keeps its policy snapshot. Account disable/revocation has separate live checks. Removing a tool denial does not grant shell, raw SQL, keychain access or arbitrary add-on operations.

## Current limits and getting help

The preview does not yet provide supported family/isolated startup, production promotion of migration copies, per-user containers, full classic/visual parity, attachment/steering/command composition, live session model switching, provider login, generic add-on panes, shell/terminal/VNC access, family scheduling/Dream/push workflows, cross-account sharing, merge/purge or a complete recovery-only startup path.

Consult [troubleshooting](troubleshooting.md) before retrying an uncertain operation. Contact your account administrator for invitations, factor resets or account policy. Contact the host operator for certificates, old browser caches, backups, migration quarantine, prepared-copy errors and unavailable startup modes. Send only the minimum diagnostic information requested; never include setup keys, invitation links, cookies, private transcripts or credential files.
