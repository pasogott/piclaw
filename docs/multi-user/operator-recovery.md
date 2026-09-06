# Offline administrator recovery

`piclaw account-recovery` prepares a restricted first-factor grant for an existing administrator whose factors are lost. It does not log in as that administrator, create an account, change ownership or enable a deployment.

**Family startup is still gated.** This command accepts only an already-migrated family store with matching family configuration. It refuses single-user and isolated stores. Do not change activation markers to try it. End-to-end restart/redemption after loss of the last administrator remains an integration/release gate; this slice tests preparation and redemption on disposable fixtures only. The current startup guard is unchanged.

## Preconditions

- Use the correct host, workspace, store and installed version. Confirm the service manager for that host; do not copy service commands between container and host-native deployments.
- Stop the managed Piclaw service and every other database/authentication writer, including CLI jobs, add-ons, schedulers and backup maintenance. Disable automatic restart while recovering. The runtime lock rejects an active Piclaw or maintenance process, and SQLite rejects a competing writer. These checks do not prove that all external processes have stopped.
- Keep a coordinated backup of the database, original bootstrap key, configuration and session files. The command makes and verifies an additional SQLite snapshot, including committed WAL data. It does not back up or rotate keys, configuration or session files. Losing the existing key may also make unrelated credentials unreadable.
- Have the exact immutable administrator ID and current username. The account must already own an active home root; repair missing ownership separately.
- Choose `totp` or `passkey` according to the configured authentication policy. TOTP needs the existing bootstrap key. Passkey recovery does not require TOTP. Use the exact externally trusted HTTPS origin without a trailing slash, path, query, credentials or fragment.
- Prepare a directory owned by the invoking OS user, mode `0700`, for the backup and secret grant. Use new filenames. The command refuses existing files/symlinks and never prints the grant URL.

## Preview and issue

Use the normal workspace/profile configuration of the stopped service. The examples contain placeholders, not real account IDs or secrets.

```sh
piclaw --workspace /path/to/workspace account-recovery preview \
  --user-id user-EXAMPLE --username alice --method passkey \
  --origin https://family.example

mkdir -m 700 /path/to/private-recovery
piclaw --workspace /path/to/workspace account-recovery issue \
  --user-id user-EXAMPLE --username alice --method passkey \
  --origin https://family.example \
  --backup /path/to/private-recovery/before.sqlite \
  --output /path/to/private-recovery/grant.json \
  --writers-stopped --key-backup-confirmed --confirm 'RECOVER alice'
```

Preview returns only account identity and factor/login counts; it reads no factor secrets. Issue requires both acknowledgements and the exact confirmation string. It takes the workspace runtime lock with maintenance identity, ignores the lock-disable environment override, verifies a SQLite backup and checks for intervening writes before its write transaction. It opens an existing database directly, without running migrations or creating missing schema.

One transaction appends an `operator_recovery_events` row, disables the target, removes its factors/logins/pending ceremonies, revokes invitations it owns or issued, and creates a 15-minute grant. Other accounts and all conversation ownership remain unchanged. This offline operation can replace the final administrator's lost factors; ordinary web/admin last-administrator protection is unchanged.

The grant is written and synced to an exclusively created `0600` file before commit. An output or SQL failure rolls back database changes and removes that output when possible; the verified backup is retained. Only the audit ID, target ID and output/backup paths reach stdout. No HTTP, tool, scheduled action or settings pane issues operator grants. Installed code and privileged filesystem/database access remain trusted.

## Redemption and failure handling

The protected JSON file contains a method-specific invitation URL and expiry. Deliver it privately to the intended administrator; do not paste it into chat transcripts, logs, shell arguments or screenshots. A grant is a bearer secret. Remove the file after confirmed use according to the host's data-retention policy.

On a future release with the integrated recovery startup gate, the recipient uses the existing restricted invitation page. A stored operator audit reference, exact origin, target administrator role and existing owned home must still match. The grant does not depend on a second enabled administrator. Normal administrator reissue clears operator authority. Ordinary expiry, one-use browser binding, proof checks and revocation still apply. Passkey setup requires user verification; TOTP setup requires a valid code. Successful enrolment enables the same account and requires a separate ordinary login. Existing seeds/private keys are never revealed.

Do not restart the current gated family runtime or relax startup guards to redeem a prepared grant. The command itself never starts or restarts a service. Recovery startup/listener behaviour and physical-device verification must be completed before deployment.

If the process is interrupted, inspect the protected output and database using the same release before retrying. A crash may leave an output file for an uncommitted grant or a committed grant whose success was not printed. Never assume missing stdout means rollback. Reissuing to new paths invalidates the previous grant. Expiry does not automatically restore old factors; issue a fresh grant offline or restore the coordinated backup.

To roll back, keep every writer stopped and restore the verified pre-recovery database together with its original key/configuration/session backup. Handle WAL/SHM files through the established SQLite restore procedure, never by deleting the production database casually. Verify integrity and account state before any future authorised restart. Restoring old state can restore old factors and login tokens; account for that security effect.

The command does not provide dual-key rotation, encrypted backup storage, audit pruning, automatic service management or a guarantee against a privileged concurrent writer. Use an encrypted/private backup destination where required.
