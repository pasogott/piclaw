import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { getDb } from "../../../db/connection.js";
import { requireAccountActor } from "../../../db/account-administration.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import { getChatCursor, getFailedRun, clearFailedRun, setChatCursor } from "../../../db/chat-cursors.js";
import { getMessagesSince } from "../../../db/messages.js";
import { getIdentityConfig } from "../../../core/config.js";
import { readFamilyMessageAdmission } from "./family-message-authority.js";

export interface MessageRecoveryInput { chatJid: string; messageRowId: number; requestId: string; action: "retry" | "skip" }

/** Called under the same per-chat queue lane; every predicate is checked again at commit. */
export function recoverFamilyMessage(actor: AuthenticatedPrincipal, input: MessageRecoveryInput) {
  if (!Number.isSafeInteger(input.messageRowId) || input.messageRowId <= 0 || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)
    || !["retry", "skip"].includes(input.action)) throw new Error("Invalid recovery request.");
  const db = getDb();
  return db.transaction(() => {
    requireAccountActor(db, actor, { recent: true });
    resolveAuthorisedChat(db, actor, input.chatJid, "session.write");
    const admission = db.query("SELECT message_id FROM message_execution_authorities WHERE message_rowid=? AND chat_jid=? AND owner_user_id=?")
      .get(input.messageRowId, input.chatJid, actor.userId) as { message_id: string } | null;
    if (!admission) throw new ChatAccessDenied();
    const row = readFamilyMessageAdmission(input.chatJid, admission.message_id);
    const duplicate = db.query("SELECT id,message_rowid,action FROM message_recovery_authorities WHERE owner_user_id=? AND request_id=?")
      .get(actor.userId, input.requestId) as { id: number; message_rowid: number; action: string } | null;
    if (duplicate) {
      if (duplicate.message_rowid !== input.messageRowId || duplicate.action !== input.action) throw new ChatAccessDenied();
      return { created: false, recovery_id: duplicate.id, action: input.action, message_rowid: input.messageRowId };
    }
    const cursor = db.query("SELECT inflight_message_id,preflight_message_id FROM chat_cursors WHERE chat_jid=?").get(input.chatJid) as { inflight_message_id: string | null; preflight_message_id: string | null } | null;
    if (cursor?.inflight_message_id || cursor?.preflight_message_id) throw new Error("Message recovery requires an idle chat.");
    const failed = getFailedRun(input.chatJid);
    const head = getMessagesSince(input.chatJid, getChatCursor(input.chatJid), getIdentityConfig().assistantName)[0];
    // Only the oldest unconsumed, admitted input can be skipped or retried. Never rewind a completed turn.
    if (!head || head.id !== row.message_id || (failed && failed.messageId !== row.message_id)) throw new ChatAccessDenied();
    const now = new Date().toISOString();
    const inserted = db.query("INSERT INTO message_recovery_authorities(message_rowid,owner_user_id,login_session_id,request_id,action,failure_created_at,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(row.message_rowid, actor.userId, actor.authentication.sessionId!, input.requestId, input.action, failed?.createdAt ?? null, now);
    if (input.action === "skip") setChatCursor(input.chatJid, head.timestamp);
    clearFailedRun(input.chatJid);
    return { created: true, recovery_id: Number(inserted.lastInsertRowid), action: input.action, message_rowid: input.messageRowId };
  }).immediate();
}
