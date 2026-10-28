/** Pending native input discovery and stable queue wakeups. No execution recovery. */
import { getAllChatCursors, getDb, getDeferredQueuedFollowups, getMessagesSince, type DeferredQueuedFollowupRecord } from "../../../db.js";
import { createLogger } from "../../../utils/logger.js";
const log = createLogger("web.recovery");

export interface WebPendingResumeContext {
  assistantName: string;
  defaultAgentId: string;
  enqueue(task: () => Promise<void>, key: string, laneKey?: string): void;
  processChat(chatJid: string, agentId: string, threadRootId?: number): Promise<void>;
  recoveryDelayMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
}
export interface WebPendingResumeStore {
  getAllChatCursors(): Record<string, string>;
  getKnownChatJids(): string[];
  getDeferredQueuedFollowups(chatJid: string): DeferredQueuedFollowupRecord[];
  getMessagesSince(chatJid: string, since: string, assistantName: string): unknown[];
}

function getKnownChatJids(): string[] {
  const rows = getDb().prepare(`
    SELECT chat_jid FROM chat_cursors
    UNION
    SELECT jid as chat_jid FROM chats
    UNION
    SELECT chat_jid FROM messages
  `).all() as Array<{ chat_jid: string | null | undefined }>;

  return rows
    .map((row) => (typeof row.chat_jid === "string" ? row.chat_jid.trim() : ""))
    .filter((jid) => jid.length > 0);
}

const defaultStore: WebPendingResumeStore = { getAllChatCursors, getKnownChatJids, getDeferredQueuedFollowups, getMessagesSince };

/** Resume chats with pending messages after a restart. */
export function resumePendingChats(
  ctx: WebPendingResumeContext,
  chatJid?: string,
  store: WebPendingResumeStore = defaultStore
): void {
  const cursors = store.getAllChatCursors();
  const resolvedJids = chatJid && chatJid !== "all"
    ? [chatJid]
    : Array.from(new Set([...Object.keys(cursors), ...store.getKnownChatJids()]));

  for (const jid of resolvedJids) {
    const since = Object.prototype.hasOwnProperty.call(cursors, jid) ? cursors[jid] : "";
    const messages = store.getMessagesSince(jid, since, ctx.assistantName);
    const deferred = store.getDeferredQueuedFollowups(jid);
    // Payload validation belongs to admission/materialisation, not discovery;
    // attachment-only input still owns a queue wakeup.
    if (messages.length === 0 && deferred.length === 0) continue;
    // Use a stable per-chat key so repeated resume_pending triggers (for
    // example, reload IPC plus startup self-queued IPC) collapse to one queued
    // recovery task instead of duplicating the same chat turn.
    log.info("Queuing resume for pending chat", {
      operation: "resume_pending_chats.enqueue",
      chatJid: jid,
    });
    ctx.enqueue(async () => {
      if ((ctx.recoveryDelayMs ?? 0) > 0) {
        await (ctx.sleep ? ctx.sleep(ctx.recoveryDelayMs!) : Bun.sleep(ctx.recoveryDelayMs!));
      }
      await ctx.processChat(jid, ctx.defaultAgentId);
    }, `resume:${jid}`, `chat:${jid}`);
  }
}
