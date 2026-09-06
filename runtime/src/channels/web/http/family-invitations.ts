import { getDb } from "../../../db/connection.js";
import { AccountInvitations } from "../../../secure/account-invitations.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { checkCsrfOrigin, rateLimitResponse } from "./security.js";
import { isRateLimited } from "./rate-limit.js";

/** Public but narrowly scoped enrolment ceremony. Successful confirmation is not a login. */
export async function handleFamilyInvitationRoutes(channel: WebChannelLike, req: Request): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (path !== "/auth/invitation/claim" && path !== "/auth/invitation/confirm") return null;
  const deny = () => channel.json({ error: "Invalid or expired invitation." }, 403);
  if (req.method !== "POST" || !req.headers.get("origin") || !checkCsrfOrigin(req)) return deny();
  if (!channel.authGateway.createTotpContext().isTotpEnabled()) return deny();
  if (isRateLimited(req, "auth/invitation", 5 * 60_000, 20)) return rateLimitResponse("Too many enrolment attempts. Try again later.");
  const origin = req.headers.get("origin")!;
  try {
    const body = await req.json();
    const claim = path.endsWith("/claim");
    const allowed = claim ? ["token"] : ["token", "enrolment_token", "code"];
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))
      || typeof body.token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(body.token)) return deny();
    const invitations = new AccountInvitations(getDb());
    if (claim) {
      const result = await invitations.claim(body.token, origin);
      const response = channel.json({ enrolment_token: result.enrolmentToken, secret: result.secret, expires_at: result.expiresAt, username: result.username });
      response.headers.set("Set-Cookie", `piclaw_enrolment=${result.browserToken}; Path=/auth/invitation; HttpOnly; Secure; SameSite=Strict; Max-Age=300`);
      return response;
    }
    const cookies = (req.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith("piclaw_enrolment="));
    if (cookies.length !== 1 || typeof body.enrolment_token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(body.enrolment_token)
      || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) return deny();
    const browser = cookies[0]!.slice("piclaw_enrolment=".length);
    if (!/^[a-zA-Z0-9_-]{43}$/.test(browser) || !(await invitations.confirm(body.token, browser, origin, body.enrolment_token, body.code))) return deny();
    const response = channel.json({ enrolled: true, login_required: true });
    response.headers.set("Set-Cookie", "piclaw_enrolment=; Path=/auth/invitation; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
    return response;
  } catch { return deny(); }
}
