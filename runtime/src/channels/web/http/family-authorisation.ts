import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { getDb } from "../../../db/connection.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { principalResponse } from "../auth/principal.js";
import { rememberWebOrigin } from "../auth/request-origin.js";
import { getHashtagResponse, getSearchResponse, getThreadResponse, getTimelineResponse } from "../timeline-service.js";
import type { SseAuthorisation } from "../sse/sse.js";
import { handleAuthRoutes } from "./dispatch-auth.js";
import { handleShellRoutes, type ServeStaticAsset } from "./dispatch-shell.js";
import { enforceRequestGuards } from "./request-guards.js";
import { getRouteFlags } from "./route-flags.js";

/** Absent selects the live home; explicit empty/duplicate selectors never fall back. */
function selector(url: URL, key: string): string | undefined {
  const values = url.searchParams.getAll(key);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !values[0]?.trim()) throw new ChatAccessDenied();
  return values[0].trim();
}

/** Recheck a non-secret login ID, account and parent chain without retaining a cookie. */
export function createSseAuthorisation(database: Database, principal: AuthenticatedPrincipal, chatJid: string): SseAuthorisation {
  const target = resolveAuthorisedChat(database, principal, chatJid, "session.read");
  return Object.freeze({
    chatJid: target.chatJid,
    isAuthorised: () => {
      const login = database.query("SELECT user_id, expires_at FROM web_sessions WHERE session_id = ?")
        .get(principal.authentication.sessionId ?? "") as { user_id: string; expires_at: string } | null;
      if (!login || login.user_id !== principal.userId || !Number.isFinite(Date.parse(login.expires_at)) || Date.parse(login.expires_at) <= Date.now()) return false;
      const current = resolveAuthorisedChat(database, principal, target.chatJid, "session.read");
      return current.rootBranchId === target.rootBranchId;
    },
  });
}

/** Candidate SQL is owner-bound; validate every parent chain before searching it. */
function authorisedSearchChats(database: Database, principal: AuthenticatedPrincipal, rootChatJid?: string): string[] {
  const rows = database.query(`SELECT b.chat_jid FROM session_roots o
    JOIN chat_branches r ON r.branch_id = o.root_branch_id
    JOIN chat_branches b ON b.root_chat_jid = r.chat_jid
    WHERE o.owner_user_id = ? AND (? IS NULL OR r.chat_jid = ?)`)
    .all(principal.userId, rootChatJid ?? null, rootChatJid ?? null) as { chat_jid: string }[];
  return rows.flatMap(row => {
    try { return [resolveAuthorisedChat(database, principal, row.chat_jid, "session.read").chatJid]; }
    catch (error) { if (error instanceof ChatAccessDenied) return []; throw error; }
  });
}

/** Terminal dispatcher: unlisted routes/methods never enter legacy or add-on dispatch. */
export async function handleFamilyRequest(channel: WebChannelLike, req: Request, serveStaticAsset: ServeStaticAsset): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const flags = getRouteFlags(req, path);
  const deny = () => channel.json({ error: "Session access denied." }, 403);
  if (!channel.authGateway.isAuthEnabled()) return channel.json({ error: "Family authentication unavailable." }, 503);

  const principal = channel.authGateway.getPrincipal?.(req) ?? null;
  if (path === "/auth/me") return principalResponse(req, principal?.mode === "family-shared" ? principal : null);

  const publicAsset = flags.isGetOrHead && ["/static/common/dist/login.bundle.js", "/static/common/dist/login.bundle.css"].includes(path);
  const login = flags.isLoginPage || flags.isAuthVerify || flags.isWebauthnLoginStart || flags.isWebauthnLoginFinish;
  if (login || publicAsset || (!principal && flags.isIndex)) {
    // Internal and widget credentials cannot bypass browser account authentication.
    const guard = await enforceRequestGuards({ json: (value, status) => channel.json(value, status), endpointContexts: channel.endpointContexts, authGateway: {
      isAuthEnabled: () => true,
      isInternalSecretEnabled: () => false,
      verifyInternalSecret: () => false,
      isAuthenticated: () => principal?.mode === "family-shared" && principal.kind === "user",
    } }, req, path, flags);
    if (guard) return guard;
    if (publicAsset) return channel.serveStatic(path.slice("/static/".length), req);
    return await handleAuthRoutes(channel, req, flags) ?? deny();
  }

  if (!principal || principal.mode !== "family-shared" || principal.kind !== "user") return channel.json({ error: "Unauthorized" }, 401);
  // Packaged app assets only: no docs, dynamic avatars, manifest or service-worker state.
  if (flags.isGetOrHead && (flags.isIndex || flags.isStaticAsset)) {
    return await handleShellRoutes(channel, req, path, flags, serveStaticAsset) ?? deny();
  }
  const readable = req.method === "GET" && (path === "/timeline" || path === "/search" || path === "/sse/stream"
    || /^\/hashtag\/[^/]+$/.test(path) || /^\/thread\/[1-9]\d*$/.test(path));
  if (!readable) return deny();

  try {
    const database = getDb();
    const target = resolveAuthorisedChat(database, principal, selector(url, "chat_jid"), "session.read");
    const root = selector(url, "root_chat_jid");
    if (root !== undefined) {
      const selectedRoot = resolveAuthorisedChat(database, principal, root, "session.read");
      if (selectedRoot.chatJid !== target.rootChatJid) throw new ChatAccessDenied();
    }
    rememberWebOrigin(target.chatJid, req);
    if (path === "/sse/stream") return channel.handleSse(req, createSseAuthorisation(database, principal, target.chatJid));
    const limit = channel.clampInt(url.searchParams.get("limit"), path === "/timeline" ? 10 : 50, 1, 100);
    const offset = channel.clampInt(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    let result: { status: number; body: unknown };
    if (path === "/timeline") {
      result = getTimelineResponse(target.chatJid, limit, channel.parseOptionalInt(url.searchParams.get("before")) ?? undefined, { user_name: principal.displayName });
    } else if (path === "/search") {
      const scope = selector(url, "scope") ?? "current";
      if (scope !== "current" && scope !== "root" && scope !== "all") throw new ChatAccessDenied();
      const chats = scope === "current" ? [target.chatJid] : authorisedSearchChats(database, principal, scope === "root" ? target.rootChatJid : undefined);
      const filters = { images: ["1", "true"].includes(url.searchParams.get("images") ?? ""), attachments: ["1", "true"].includes(url.searchParams.get("attachments") ?? "") };
      result = getSearchResponse(target.chatJid, (url.searchParams.get("q") ?? "").trim(), limit, offset, scope, target.rootChatJid, filters, chats);
    } else if (path.startsWith("/thread/")) {
      const id = Number(path.slice("/thread/".length));
      if (!Number.isSafeInteger(id)) throw new ChatAccessDenied();
      result = getThreadResponse(target.chatJid, id);
    } else {
      let tag: string;
      try { tag = decodeURIComponent(path.slice("/hashtag/".length)); } catch { throw new ChatAccessDenied(); }
      result = getHashtagResponse(target.chatJid, tag, limit, offset);
    }
    return channel.json(result.body, result.status);
  } catch (error) {
    if (error instanceof ChatAccessDenied) return deny();
    throw error;
  }
}
