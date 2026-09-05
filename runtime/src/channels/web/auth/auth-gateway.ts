/**
 * channels/web/auth-gateway.ts – cohesive auth/session/passkey gateway for WebChannel.
 */

import {
  createTotpAuthContext,
  createWebauthnAuthContext,
  createWebauthnEnrolPageContext,
  isAuthEnabled,
  isInternalSecretEnabled,
  isPasskeyEnabled,
  isPasskeyOnly,
  isTotpEnabled,
  verifyInternalSecret,
  type WebAuthRuntimeConfig,
} from "./auth-runtime.js";
import type { TotpAuthContext, TotpFailureTrackerLike } from "./totp-auth.js";
import type { WebauthnAuthContext } from "./webauthn-auth.js";
import type { WebauthnEnrolPageContext } from "./webauthn-enrol-page.js";
import type { WebauthnChallengeTracker } from "./webauthn-challenges.js";
import { getClientKey as getRequestClientKey } from "../http/client.js";
import { createLogger } from "../../../utils/logger.js";

import { getDb, getWebSession } from "../../../db.js";
import { getUser } from "../../../db/users.js";
import { getIdentityConfig } from "../../../core/config.js";
import { resolveRequestPrincipal, type AuthenticatedPrincipal, type PrincipalResolverDeps } from "./principal.js";

const log = createLogger("web.auth-gateway");

/** External dependencies required to construct a WebAuthGateway instance. */
export interface WebAuthGatewayDeps {
  json(payload: unknown, status?: number): Response;
  challenges: WebauthnChallengeTracker;
  failureTracker: TotpFailureTrackerLike;
  logAuthWarning?(message: string): void;
  principalResolver?: PrincipalResolverDeps;
}

/** Central auth capability gateway for web request guards and endpoint contexts. */
export class WebAuthGateway {
  private readonly principals = new WeakMap<Request, AuthenticatedPrincipal | null>();

  constructor(
    private readonly config: WebAuthRuntimeConfig,
    private readonly deps: WebAuthGatewayDeps
  ) {}

  isAuthEnabled(): boolean {
    return isAuthEnabled(this.config);
  }

  isInternalSecretEnabled(): boolean {
    return isInternalSecretEnabled(this.config);
  }

  isPasskeyEnabled(): boolean {
    return isPasskeyEnabled(this.config);
  }

  isPasskeyOnly(): boolean {
    return isPasskeyOnly(this.config);
  }

  isTotpEnabled(): boolean {
    return isTotpEnabled(this.config);
  }

  isTotpSession(req: Request): boolean {
    return this.isTotpEnabled() && this.getPrincipal(req)?.authentication.method === "totp";
  }

  verifyInternalSecret(req: Request): boolean {
    return verifyInternalSecret(req, this.config);
  }

  getPrincipal(req: Request): AuthenticatedPrincipal | null {
    if (this.principals.has(req)) return this.principals.get(req)!;
    const principal = resolveRequestPrincipal(req, {
      mode: this.config.accessMode ?? "single-user",
      authEnabled: this.isAuthEnabled(),
    }, this.deps.principalResolver ?? {
      getSession: getWebSession,
      getUser: (id) => getUser(getDb(), id),
      getLocalDisplayName: () => getIdentityConfig().userName || "User",
    });
    this.principals.set(req, principal);
    return principal;
  }

  isAuthenticated(req: Request): boolean {
    return this.getPrincipal(req) !== null;
  }

  createTotpContext(): TotpAuthContext {
    return createTotpAuthContext(this.config, {
      json: this.deps.json,
      getClientKey: (req) => this.getClientKey(req),
      logAuthEvent: (req, event) => this.logAuthEvent(req, event),
      failureTracker: this.deps.failureTracker,
    });
  }

  createWebauthnContext(): WebauthnAuthContext {
    return createWebauthnAuthContext(this.config, {
      json: this.deps.json,
      getClientKey: (req) => this.getClientKey(req),
      logAuthEvent: (req, event) => this.logAuthEvent(req, event),
      challenges: this.deps.challenges,
    });
  }

  createWebauthnEnrolPageContext(): WebauthnEnrolPageContext {
    return createWebauthnEnrolPageContext(this.config, {
      json: this.deps.json,
    });
  }

  /** Update the live TOTP secret used by runtime auth checks. */
  setTotpSecret(secret: string): void {
    this.config.totpSecret = (secret || "").trim();
  }

  private getClientKey(req: Request): string {
    return getRequestClientKey(req);
  }

  private logAuthEvent(req: Request, event: string): void {
    const clientKey = this.getClientKey(req);
    if (this.deps.logAuthWarning) {
      this.deps.logAuthWarning(`[auth] ${event} (ip=${clientKey})`);
      return;
    }
    log.warn("Auth event", {
      operation: "web_auth_gateway.log_auth_event",
      event,
      clientKey,
    });
  }
}
