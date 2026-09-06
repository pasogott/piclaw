import type Database from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { requireAccountActor } from "../db/account-administration.js";
import { ChatAccessDenied, getRootOwnership } from "../db/session-ownership.js";
import { getUser, updateUser } from "../db/users.js";
import { UserAuthFactors } from "./user-auth-factors.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
interface Invitation { token_hash: string; user_id: string; issuer_user_id: string; expires_at: number; state: string; browser_hash: string | null; enrolment_hash: string | null; origin: string | null }

/** Restricted enrolment grants. Never become account cookies or carry role/home changes. */
export class AccountInvitations {
  constructor(private readonly database: Database, private readonly factors = new UserAuthFactors(database), private readonly now = () => Date.now()) {}

  private eligible(userId: string): void {
    const user = getUser(this.database, userId);
    const root = user?.home_chat_jid ? getRootOwnership(this.database, user.home_chat_jid) : null;
    if (!user || user.enabled || !root || root.ownerUserId !== user.id || root.rootChatJid !== user.home_chat_jid
      || this.database.query("SELECT 1 FROM user_totp_factors WHERE user_id=?").get(userId)
      || this.database.query("SELECT 1 FROM webauthn_credentials WHERE user_id=?").get(userId)) throw new ChatAccessDenied();
  }

  issue(actor: AuthenticatedPrincipal, userId: string): { token: string; expiresAt: number } {
    return this.database.transaction(() => {
      requireAccountActor(this.database, actor, { admin: true, recent: true });
      this.eligible(userId);
      this.prune();
      this.database.query("DELETE FROM user_totp_enrolments WHERE user_id=?").run(userId);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = this.now() + 15 * 60_000;
      this.database.query(`INSERT INTO user_auth_invitations(token_hash,user_id,issuer_user_id,expires_at,state,created_at)
        VALUES (?,?,?,?,'issued',?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,issuer_user_id=excluded.issuer_user_id,
        expires_at=excluded.expires_at,state='issued',browser_hash=NULL,enrolment_hash=NULL,origin=NULL,created_at=excluded.created_at`)
        .run(hash(token), userId, actor.userId, expiresAt, new Date(this.now()).toISOString());
      return { token, expiresAt };
    }).immediate();
  }

  revoke(actor: AuthenticatedPrincipal, userId: string): void {
    this.database.transaction(() => {
      requireAccountActor(this.database, actor, { admin: true, recent: true });
      this.database.query("DELETE FROM user_auth_invitations WHERE user_id=?").run(userId);
      this.database.query("DELETE FROM user_totp_enrolments WHERE user_id=?").run(userId);
    }).immediate();
  }

  private valid(token: string, browser?: string, origin?: string): Invitation {
    const row = this.database.query("SELECT * FROM user_auth_invitations WHERE token_hash=? AND expires_at>?").get(hash(token), this.now()) as Invitation | null;
    if (!row) throw new ChatAccessDenied();
    const issuer = getUser(this.database, row.issuer_user_id);
    if (!issuer?.enabled || issuer.role !== "admin") throw new ChatAccessDenied();
    this.eligible(row.user_id);
    if (browser !== undefined && (row.state !== "claimed" || row.browser_hash !== hash(browser) || row.origin !== origin)) throw new ChatAccessDenied();
    return row;
  }

  async claim(token: string, origin: string): Promise<{ browserToken: string; enrolmentToken: string; secret: string; expiresAt: number; username: string }> {
    this.prune();
    const browserToken = randomBytes(32).toString("base64url");
    const userId = this.database.transaction(() => {
      const row = this.valid(token);
      if (row.state !== "issued") throw new ChatAccessDenied();
      const expiresAt = Math.min(row.expires_at, this.now() + 5 * 60_000);
      this.database.query("UPDATE user_auth_invitations SET state='claimed',browser_hash=?,origin=?,expires_at=? WHERE token_hash=?")
        .run(hash(browserToken), origin, expiresAt, row.token_hash);
      return row.user_id;
    }).immediate();
    // The claim is consumed before async cryptography. A failed response needs a new admin invitation.
    const enrolled = await this.factors.beginEnrolment(userId, () => { this.valid(token, browserToken, origin); });
    const row = this.valid(token, browserToken, origin);
    this.database.query("UPDATE user_auth_invitations SET enrolment_hash=? WHERE token_hash=?").run(hash(enrolled.token), row.token_hash);
    return { browserToken, enrolmentToken: enrolled.token, secret: enrolled.secret, expiresAt: row.expires_at, username: getUser(this.database, userId)!.username };
  }

  async confirm(token: string, browser: string, origin: string, enrolmentToken: string, code: string): Promise<boolean> {
    const row = this.valid(token, browser, origin);
    if (row.enrolment_hash !== hash(enrolmentToken)) throw new ChatAccessDenied();
    return this.factors.confirmEnrolment(row.user_id, enrolmentToken, code, () => {
      // Check grant/account again after async KDF, but allow the factor just inserted in this transaction.
      const grant = this.database.query("SELECT * FROM user_auth_invitations WHERE token_hash=? AND expires_at>?")
        .get(hash(token), this.now()) as Invitation | null;
      const user = getUser(this.database, row.user_id);
      const issuer = getUser(this.database, row.issuer_user_id);
      const home = user?.home_chat_jid ? getRootOwnership(this.database, user.home_chat_jid) : null;
      if (!grant || grant.user_id !== row.user_id || grant.state !== "claimed" || grant.browser_hash !== hash(browser) || grant.enrolment_hash !== hash(enrolmentToken) || grant.origin !== origin
        || !user || user.enabled || !issuer?.enabled || issuer.role !== "admin" || home?.ownerUserId !== user.id || home.rootChatJid !== user.home_chat_jid) throw new ChatAccessDenied();
      updateUser(this.database, user.id, { enabled: true });
      this.database.query("DELETE FROM user_auth_invitations WHERE token_hash=?").run(grant.token_hash);
      this.database.query("DELETE FROM web_sessions WHERE user_id=?").run(user.id);
    });
  }

  /** No timers here: callers prune on issue/claim; periodic cleanup is a later runtime hook. */
  prune(): void {
    this.database.query("DELETE FROM user_totp_enrolments WHERE user_id IN (SELECT user_id FROM user_auth_invitations WHERE expires_at<=?)").run(this.now());
    this.database.query("DELETE FROM user_auth_invitations WHERE expires_at<=?").run(this.now());
  }
}
