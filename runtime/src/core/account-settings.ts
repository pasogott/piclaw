/** Own-account metadata only. Capabilities are hints; writes recheck live authority. */
export interface AccountSettings {
  user: { id: string; username: string; display_name: string };
  recent_auth: boolean;
  capabilities: { update_profile: boolean; register_passkey: boolean; revoke_session: boolean };
  factors: {
    totp: { enrolled: boolean; removable: boolean };
    passkeys: { credential_id: string; created_at: string; last_used_at: string | null; usable: boolean; removable: boolean }[];
  };
  sessions: { session_id: string; auth_method: string; created_at: string; expires_at: string; current: boolean }[];
}
