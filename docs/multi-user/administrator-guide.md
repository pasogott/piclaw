# Family preview administrator guide

Family administration is implemented behind the disabled family startup gate. Piclaw still supports **single-user deployments only**. These instructions describe controlled preview testing; they do not authorise deployment activation or migration-copy promotion.

For ordinary account use, read the [user guide](user-guide.md). For service, filesystem and backup work, use the [migration runbook](migration-copy.md) and [offline recovery runbook](operator-recovery.md). [Troubleshooting](troubleshooting.md) separates account problems from operator problems.

## Authority and access

**Family administration** appears only when the server grants account-management capability. Sensitive actions and security/home details need an administrator sign-in within the last five minutes. A refresh does not renew that window. The server checks authority again when the operation is applied; a visible enabled button is not permission to bypass a later rejection.

Administrators manage account labels, enabled state, roles, sign-in items, future home assignment and tool restrictions. The role does not grant conversation or avatar access, let you select a foreign session as your own, or authorise running a model as another person.

Administrators can replace another account's authentication through reset. Grant the role only to trusted people. The separate host operator controls the machine, database and shared secrets and remains outside application-level isolation. Workspace files and installed code are shared/trusted in family mode.

## Add an account

1. Open **Family administration** after a recent sign-in.
2. Under **Create disabled account**, enter **Account username**, **Account display name** and **Role**.
3. Choose **Create account** and wait for the saved list.
4. Verify the account's name and role before issuing an invitation.

Creation makes a disabled account with an owned home root. It does not mint a browser login. The account becomes usable only after a permitted factor and home are established. Usernames are unique and follow the same rules as personal profile names. New accounts normally need the Member role; administrative access is not needed for ordinary conversations.

If the response is lost, choose **Refresh accounts** and look for the account before repeating creation. Account creation is not an invitation delivery service; share the resulting invitation yourself through an appropriate private channel.

## Choose an invitation method

For an account that is disabled, has an active owned home and has no confirmed factors:

- **Issue invitation** starts first-factor authenticator/TOTP setup. It is unavailable under passkey-only policy.
- **Issue passkey invitation** starts first-factor passkey setup. It is unavailable under authenticator-only policy.

Select the action on the correct account, read the warning, type its exact current username and check the confirmation. Choose **Confirm account change**. The link is displayed once, with an expiry; it lasts up to 15 minutes, then setup is bounded to five minutes after claim.

Copy the link privately to the intended recipient. Do not paste it into a PiClaw conversation, ticket, shell command or screenshot. The page does not copy it to the clipboard or open it for you. TOTP and passkey links select different flows; do not edit a link to change its method.

Issuing again replaces the previous grant and pending setup. **Revoke invitation** revokes either method. **Clear link display**, blur or panel close only erases your displayed copy; it does not revoke the server grant. After a lost issuance response, explicitly revoke/reissue rather than assuming the grant was never created.

Ask the recipient to check the displayed account name, finish setup and sign in separately. Opening a link or displaying a TOTP key alone does not enable the account. A passkey proof must meet device user-verification requirements. Share the [invitation steps](user-guide.md#accept-an-invitation) with the recipient, without including a real link in shared documentation.

## Disable, reactivate or change a role

Choose the action on the account, type the exact username and confirm the checkbox:

- **Disable** prevents new account use and revokes its logins and pending enrolments. It preserves history, ownership and confirmed factors. Already delivered data cannot be recalled.
- **Reactivate** uses the account's existing usable factors and active owned home. It does not issue a login. If no factor is usable under current site policy, resolve that condition rather than forcing enablement.
- **Change role** changes Member to Administrator or the reverse and signs out that account's devices. Review the target role carefully.

The last enabled administrator cannot be disabled or demoted through normal administration. Keep a tested recovery path before removing administrators or factors. Role changes may remove your own administrative access if you are allowed to change your role; do not assume the panel will remain available afterward.

## Inspect or revoke another account's security items

Choose **Security** for another account after recent administrator authentication. The panel shows factor/device metadata and exact IDs. It does not reveal TOTP seeds, private keys, bearer cookies or conversation content. Use **My account** for your own sign-in items.

For a lost device login, choose **Revoke device login**, verify its ID, type the account username and confirm. This revokes that login and its pending registrations.

For a factor, choose **Remove factor** and confirm the exact item. Factor removal signs out every device for that account. The last usable factor cannot be removed through this operation; use a confirmed replacement or the explicit reset procedure below. A display label is user-authored and may be duplicated, so identify the item by its immutable ID as well.

If the account signs out, changes factors or loses administrator authority while you are inspecting it, the operation may be rejected. Refresh and assess the current state; do not repeatedly submit old item IDs.

## Reset a lost-factor account

Reset removes **all** of another account's current factors, signs out every device, disables the account and issues a replacement first-factor invitation. It preserves the user ID, role, home, history and ownership. It cannot recover or display an old seed.

1. Confirm the intended account and verify the request through your normal trusted process.
2. Choose **Reset account** for a replacement authenticator, or **Reset to passkey** for a replacement passkey.
3. Read the destructive warning, type the exact current username and check the confirmation.
4. Choose **Confirm account change** and privately deliver the new invitation.
5. Have the recipient complete enrolment and sign in again. Old credentials no longer work.

The two actions follow the configured factor policy independently. Reset to passkey does not require TOTP under passkey-only policy. Self-reset is denied, and normal reset cannot remove the last enabled administrator. If no other administrator can help, contact the host operator. The [offline preparation command](operator-recovery.md) exists, but recovery-only startup is not yet a supported deployed flow; do not disable startup guards to redeem a prepared grant.

Reset is transactional: failure to write its grant/audit rolls back the reset. A lost network response is still uncertain from the browser's perspective. Inspect the account's current state and revoke/reissue any uncertain invitation before proceeding.

## Assign another account's home

Choose **Home** to list another account's eligible active owned roots. You cannot select a root owned by somebody else, an archive or a child fork. Choose **Assign home**, read the target root's handle and ID, type the account username and confirm.

This changes future landing and targetless requests only. It does not open the conversation for you, transfer ownership, move an active turn, redirect another tab's explicit session selection or change a container destination. No eligible roots means ownership must be provisioned or repaired through a separate operator workflow. Use **My sessions** to choose your own home.

## Restrict tools for new runs

Choose **Tool restrictions** on the target account. A checked tool is denied. The preview ceiling is `read`, `ls`, `find`, `grep`, `messages`, `session_status`, `session_control` and `chat`; some actions within these tools remain read-only or unavailable.

Check the tools to deny, type the account username, check the confirmation and choose **Save tool restrictions**. Clearing a denial restores only a tool within that fixed ceiling. It cannot grant shell, raw SQL, keychain, remote execution or unknown add-on tools.

Changes affect new model runs. A running turn retains its snapshot, including recovery replacement. This is not a way to cancel a current run; account revocation has separate live checks. A stale revision is rejected rather than overwriting another administrator's newer save. Refresh and review before retrying.

Tool restrictions do not revoke account management, isolate shared files or replace provider/budget policy. Inspect **Workspace and security** for the effective allowed/denied set and sharing notice.

## Review results and uncertain changes

Every existing-account change uses explicit target confirmation. The panel clears forms, security metadata and invitation links on blur, close, session switch, navigation or account replacement. A request already admitted by the server may still finish afterward.

Use **Refresh accounts** before repeating an uncertain change. There is no automatic browser retry. For invitations, revoke/reissue explicitly. For factor/device removal, inspect the remaining items. For home/tool settings, inspect the effective state. Do not treat an error message or closed panel as proof that nothing changed.

Administrative security revocation, home changes, tool restrictions and resets have transactional audit records in the database. This preview does not provide a complete audit-log viewer or retention controls. Ask the operator for a narrowly scoped review rather than requesting another user's conversation data.

## Operator handoff

Account administration does not expose access-mode activation, container destination assignment, backup promotion, key rotation, arbitrary provider credentials, filesystem permissions, notification recipient migration or general add-on configuration.

Before any eventual deployment, the operator must complete the [migration runbook](migration-copy.md), coordinated backups/key handling, runtime/transport isolation checks, physical-device and browser-cache tests, recovery startup and the [release gates](README.md#activation-and-recovery). Prepared migration copies intentionally cannot start. Do not edit markers, transfer credential user IDs or use the single-user controls to bypass family checks.
