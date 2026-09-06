import type { AccountSettings } from '../../src/core/account-settings.js';
import { FamilyApi } from './family-api.js';

const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const encode = (value: ArrayBuffer) => btoa(Array.from(new Uint8Array(value), byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

/** Memory-only account panel. No legacy Settings, storage, global preferences or add-on calls. */
export class FamilyAccount {
  private root = node<HTMLElement>('account-settings');
  private body = node<HTMLElement>('account-details');
  private message = node<HTMLElement>('account-status');
  private username = node<HTMLInputElement>('account-username');
  private displayName = node<HTMLInputElement>('account-display-name');
  private keys = node<HTMLElement>('account-passkeys');
  private sessions = node<HTMLElement>('account-sessions');
  private confirmation = node<HTMLElement>('account-confirmation');
  private confirm = node<HTMLInputElement>('account-confirm-check');
  private confirmButton = node<HTMLButtonElement>('account-confirm-action');
  private snapshot: AccountSettings | null = null;
  private action: { path: string; endsLogin: boolean } | null = null;
  private opened = false;
  private suspended = false;
  private stopped = false;
  private busy = false;
  private generation = 0;
  private ceremony: AbortController | null = null;

  constructor(private api: FamilyApi) {
    node('open-account').addEventListener('click', () => { this.opened = true; this.suspended = false; void this.load(true); });
    node('close-account').addEventListener('click', () => { this.opened = false; this.clear(); this.ceremony?.abort(); node('open-account').focus(); });
    node('refresh-account').addEventListener('click', () => { void this.load(); });
    node('account-profile').addEventListener('submit', event => {
      event.preventDefault();
      if (this.snapshot?.capabilities.update_profile !== true) return;
      const patch = { username: this.username.value, displayName: this.displayName.value };
      void this.mutate(() => this.api.request('/account', 'PATCH', patch), 'Profile saved.');
    });
    node('account-add-passkey').addEventListener('click', () => { void this.addPasskey(); });
    node('account-remove-totp').addEventListener('click', () => {
      if (this.snapshot?.factors.totp.removable === true) this.ask('/account/factors/totp', true, 'Remove your authenticator? This signs out every device for your account.');
    });
    this.confirm.addEventListener('change', () => { this.confirmButton.disabled = !this.confirm.checked || this.busy; });
    node('account-cancel-action').addEventListener('click', () => { this.cancelConfirmation(); });
    this.confirmButton.addEventListener('click', () => {
      if (!this.action || !this.confirm.checked) return;
      const action = this.action;
      void this.mutate(() => this.api.request(action.path, 'DELETE'), 'Device signed out.', action.endsLogin);
    });
  }

  private clear(): void {
    this.generation++; this.root.hidden = true; this.body.hidden = true;
    this.snapshot = null; this.username.value = ''; this.displayName.value = '';
    this.keys.replaceChildren(); this.sessions.replaceChildren(); this.message.textContent = '';
    node('account-totp-status').textContent = ''; this.cancelConfirmation();
  }
  suspend(): void { this.suspended = true; this.clear(); }
  resume(): void {
    if (!this.suspended || this.stopped) return;
    this.suspended = false;
    if (this.opened && !this.busy) void this.load();
  }
  stop(): void { this.stopped = true; this.opened = false; this.ceremony?.abort(); this.clear(); }
  private visible(): boolean { return this.opened && !this.suspended && !this.stopped && !document.hidden; }
  private cancelConfirmation(): void {
    this.action = null; this.confirm.checked = false; this.confirmButton.disabled = true;
    this.confirmation.hidden = true; node('account-confirm-text').textContent = '';
  }
  private ask(path: string, endsLogin: boolean, text: string): void {
    if (this.busy || !this.visible()) return;
    this.action = { path, endsLogin }; this.confirm.checked = false; this.confirmButton.disabled = true;
    this.confirm.disabled = false; node<HTMLButtonElement>('account-cancel-action').disabled = false;
    node('account-confirm-text').textContent = text; this.confirmation.hidden = false; this.confirm.focus();
  }
  private disable(): void {
    for (const control of this.body.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) control.disabled = true;
  }
  private row(parent: HTMLElement, text: string, label: string, enabled: boolean, action: () => void): void {
    const item = document.createElement('li'), description = document.createElement('span'), button = document.createElement('button');
    description.textContent = text; button.type = 'button'; button.textContent = label; button.disabled = !enabled;
    button.addEventListener('click', action); item.append(description, button); parent.append(item);
  }
  private render(value: AccountSettings): void {
    // Malformed capabilities never enable a control. Identity remains pinned independently.
    if (value?.user?.id !== this.api.identity.userId || typeof value.user.username !== 'string' || typeof value.user.display_name !== 'string'
      || !value.capabilities || !value.factors?.totp || !Array.isArray(value.factors.passkeys) || !Array.isArray(value.sessions)) throw new Error('Invalid account response.');
    this.snapshot = value; this.body.hidden = false;
    this.username.value = value.user.username; this.displayName.value = value.user.display_name;
    this.username.disabled = this.displayName.disabled = node<HTMLButtonElement>('account-save-profile').disabled = value.capabilities.update_profile !== true;
    node('account-auth-notice').textContent = value.recent_auth === true ? 'Sensitive changes require a sign-in within the last five minutes.' : 'Sign in again to change your profile, factors or signed-in devices.';
    node<HTMLButtonElement>('account-add-passkey').disabled = value.capabilities.register_passkey !== true || !window.PublicKeyCredential || !navigator.credentials;
    node('account-totp-status').textContent = value.factors.totp.enrolled ? 'Authenticator enrolled' : 'No authenticator enrolled';
    node<HTMLButtonElement>('account-remove-totp').disabled = value.factors.totp.removable !== true;
    this.keys.replaceChildren(); this.sessions.replaceChildren();
    for (const key of value.factors.passkeys) {
      this.row(this.keys, `Passkey ${key.credential_id} · Added ${key.created_at} · Last used ${key.last_used_at ?? 'never'}${key.usable ? '' : ' · Not usable with current site policy'}`, 'Remove passkey', key.removable === true,
        () => this.ask(`/account/factors/passkey/${encodeURIComponent(key.credential_id)}`, true, `Remove passkey ${key.credential_id}? This signs out every device for your account.`));
    }
    if (!value.factors.passkeys.length) this.keys.textContent = 'No passkeys enrolled.';
    for (const session of value.sessions) {
      this.row(this.sessions, `${session.current ? 'This login' : 'Other login'} · ${session.auth_method} · Signed in ${session.created_at} · Expires ${session.expires_at} · ${session.session_id}`, 'Sign out device', value.capabilities.revoke_session === true,
        () => this.ask(`/account/sessions/${encodeURIComponent(session.session_id)}`, session.current, `Sign out ${session.current ? 'this' : 'the selected'} device (${session.session_id})?`));
    }
  }
  private async load(focus = false): Promise<void> {
    if (!this.visible() || this.busy) return;
    this.clear(); this.root.hidden = false; this.message.textContent = 'Loading account…';
    const generation = this.generation;
    if (focus) node('account-heading').focus();
    try {
      const value = await this.api.request('/account');
      if (!this.visible() || generation !== this.generation) return;
      this.render(value); this.message.textContent = '';
    } catch (error) {
      if (this.visible() && generation === this.generation) { this.body.hidden = true; this.message.textContent = (error as Error).message; }
    }
  }
  private async mutate(operation: () => Promise<unknown>, success: string, endsLogin = false): Promise<void> {
    if (!this.visible() || this.busy) return;
    this.busy = true; this.generation++; this.disable(); this.message.textContent = 'Saving…';
    let message = success;
    try {
      await operation();
      if (endsLogin) { this.stop(); location.replace('/login'); return; }
    } catch (error) {
      message = `${(error as Error).message} Refresh before trying again; the change may already have completed.`;
    } finally {
      this.busy = false;
      if (this.visible()) { await this.load(); if (this.visible()) this.message.textContent = message; }
    }
  }
  private async addPasskey(): Promise<void> {
    if (this.snapshot?.capabilities.register_passkey !== true) return;
    await this.mutate(async () => {
      const controller = new AbortController(); this.ceremony = controller;
      try {
        const start = await this.api.request('/account/passkeys/register/start', 'POST', {});
        if (controller.signal.aborted || !this.visible()) throw new Error('Passkey registration cancelled.');
        const options = start.options;
        const credential = await navigator.credentials.create({ signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]), publicKey: {
          ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) },
          excludeCredentials: (options.excludeCredentials ?? []).map((key: any) => ({ ...key, id: decode(key.id) })),
        } }) as PublicKeyCredential | null;
        if (!credential || controller.signal.aborted || this.stopped || !this.opened) throw new Error('Passkey registration cancelled.');
        // Native authenticator dialogs may blur the page. Never trust the old cookie on return.
        await this.api.verifyIdentity();
        if (controller.signal.aborted || this.stopped || !this.opened) return;
        const response = credential.response as AuthenticatorAttestationResponse;
        await this.api.request('/account/passkeys/register/finish', 'POST', { token: start.token, credential: {
          id: credential.id, rawId: encode(credential.rawId), type: credential.type,
          response: { clientDataJSON: encode(response.clientDataJSON), attestationObject: encode(response.attestationObject), transports: response.getTransports?.() ?? [] },
          clientExtensionResults: credential.getClientExtensionResults(), authenticatorAttachment: credential.authenticatorAttachment,
        } });
      } finally { this.ceremony = null; }
    }, 'Passkey added. Existing passkeys are unchanged.');
  }
}
