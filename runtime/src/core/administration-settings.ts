/** Administrative account metadata; never conversation access or authentication material. */
export interface AdministrationSettings {
  recent_auth: boolean;
  capabilities: { create_user: boolean };
  users: {
    id: string; username: string; display_name: string; role: 'admin' | 'member'; enabled: boolean;
    invitation: 'none' | 'issued' | 'claimed';
    capabilities: { disable: boolean; enable: boolean; change_role: boolean; invite: boolean; revoke_invitation: boolean; reset: boolean; inspect_security: boolean; assign_home: boolean; restrict_tools: boolean };
  }[];
}
