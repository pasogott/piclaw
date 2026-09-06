# Prepare an ownership migration copy

`piclaw access-migration` inventories an existing single-user database and prepares root ownership and handle namespaces in a **new, non-startable copy**. The source database, configuration, credentials, JIDs and session files remain unchanged. No command activates family mode or installs the copy.

## Scope

This is one stage of migration, not a supported deployment conversion. The prepared database retains its `single-user` activation value and gains an `access_migration_preparation` marker. Current access-state reads reject the marker before startup can proceed. Do not remove it or edit activation values. Older releases may not recognise preparation markers; never run any older binary against the copy.

The command adopts only `session_roots` ownership and `chat_branches.handle_owner_id` through the existing transactional helpers. It preserves message content, names, IDs, archive state, account roles/enabled state and homes. It does not create users/homes, rename colliding handles, migrate factors or grants, map non-web services, adopt child seeds, rewrite queues, copy session files, retire browser caches or migrate derived resources.

Unregistered chats, broken/cyclic/cross-root parent chains and non-web roots are quarantined in the preview and block preparation. This command cannot override quarantine. All registered roots, including archives, need an explicit existing owner. Existing ownership cannot be transferred. Account homes must remain active roots owned by that account; enabled accounts need a home. Handle collisions are checked case-insensitively within each owner's active namespace; resolve them explicitly before reviewing another preview.

## Offline workflow

1. Confirm the host, workspace/store paths and release. Use the service manager configured for that host.
2. Stop Piclaw and all other writers. Prevent automatic restart while reviewing/preparing the copy. Retain a coordinated backup of configuration, the original database and key material, session files and other state. The database snapshot made here does not include external files or keys.
3. Create an owner-only `0700` directory for the inventory, reviewed plan and destination. Use new filenames. The command rejects existing destinations, symlinks and unsafe directories.
4. Generate the preview:

   ```sh
   piclaw --workspace /path/to/workspace access-migration preview \
     --output /path/to/private-migration/inventory.json
   ```

5. Review `users`, `branches`, `owners`, topology quarantine and resource counts. These are metadata, not transcript/credential contents. Copy **only the `plan` object** to `reviewed-plan.json`, preserving its version and snapshot. Fill each null `owner_user_id` with the intended immutable account ID. Unowned roots are never auto-assigned to `default`; existing owners are prefilled and cannot be changed.
6. Prepare the copy with both acknowledgements and the exact confirmation:

   ```sh
   piclaw --workspace /path/to/workspace access-migration prepare-copy \
     --plan /path/to/private-migration/reviewed-plan.json \
     --destination /path/to/private-migration/prepared.sqlite \
     --writers-stopped --backup-set-confirmed \
     --confirm 'PREPARE OWNERSHIP COPY'
   ```

The plan must be a regular non-symlink JSON file up to 1 MiB with exactly `version`, `snapshot` and `assignments`. Each assignment has only `root_chat_jid` and `owner_user_id`. Missing, extra, unknown or duplicate mappings fail. The fingerprint covers access state, user/home metadata, topology, handle namespaces, existing owners, resource counts and SQL schema. It is a stale-review check, not a secret capability or a complete content hash.

The command acquires the workspace maintenance lock even when the runtime-lock environment override is set. It opens the existing source read-only, performs no schema initialisation, creates a verified WAL-inclusive SQLite snapshot, checks source `data_version` and inventory again, then validates and applies assignments transactionally in the copy. The destination is `0600` in the private directory and receives a final integrity check. Output reports counts and paths only. A normal failure removes only the newly created partial destination and releases the lock; source state is never edited.

## After preparation

Keep the copy for review/testing only. Do not point the service at it or replace `messages.db`. Existing children are counted as pending; the command creates no fork-provenance records and grants no hydration authority. Credentials and queued work copied into the snapshot retain their old semantics and must be handled by later migration stages. The preparation marker prevents current code from treating this incomplete state as either a single-user runtime or an activated family deployment.

A crash can leave a partial destination because filesystem creation and SQLite commit are not one transaction. Treat any output without an independently verified preparation marker/integrity check as incomplete. Never overwrite or reuse an uncertain destination; choose a fresh path. Keep the source unchanged and rerun a fresh preview if any relevant source metadata changed.

The maintenance lock excludes cooperating Piclaw processes. It does not confine privileged processes or prove that every external reader/writer is stopped. Later source changes are not replayed into the prepared copy. Promotion, coordinated rollback, complete resource/factor/queue migration, child-session adoption and activation require the remaining #1126/#1129/#1133 release work. No live migration or restart was performed when implementing this command.
