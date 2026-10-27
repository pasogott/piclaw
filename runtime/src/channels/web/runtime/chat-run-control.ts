/**
 * channels/web/chat-run-control.ts – chat run control helpers (resume/cursor/failure handling).
 */

import { getMessageThreadRootIdById } from "../../../db.js";

/** Persistence used for thread lineage; execution state belongs to native tasks. */
export interface ChatRunControlStore {
  getThreadRootId(chatJid: string, messageId: string): number | null;
}

/** Runtime callbacks required to resume a queued chat run. */
export interface ResumeChatContext {
  defaultAgentId: string;
  enqueue(task: () => Promise<void>, key: string, laneKey?: string): void;
  processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void>;
}

const defaultStore: ChatRunControlStore = { getThreadRootId: getMessageThreadRootIdById };

/** Resolve a persisted thread root id for a chat/message pair. */
export function getThreadRootId(
  chatJid: string,
  messageId: string,
  store: ChatRunControlStore = defaultStore
): number | null {
  return store.getThreadRootId(chatJid, messageId);
}

/** Enqueue chat reprocessing for interrupted/pending web chats.
 *
 * When `threadRootId` is provided the resume key advances with the work being
 * resumed — this is the normal case for finalization hand-offs (S3) and
 * materialized-followup hand-offs (S2) which must each get their own queued
 * callback.
 *
 * When `threadRootId` is NOT provided the caller is issuing a generic "wake
 * the lane" signal (S1 — backlog wake from handleAgentMessage). In that case
 * we use a stable per-chat key so repeated wake signals collapse into a single
 * queued callback. This prevents the common pattern where:
 *   1. handleAgentMessage defers a message and queues a wake (S1)
 *   2. A running turn finishes and finalizeSuccessfulRun queues a drain (S3)
 *   3. S3 drains the backlog
 *   4. S1's queued callback runs and finds nothing → spurious no-op processChat
 * With a stable key, S1's duplicate wake is deduplicated by the queue if S3
 * (or a prior S1) already queued work for the same lane.
 */
export function resumeChat(
  chatJid: string,
  threadRootId: number | null | undefined,
  ctx: ResumeChatContext
): void {
  // Frontier-based key for targeted hand-offs (S2, S3); stable key for generic
  // wakes (S1). Targeted hand-offs need unique keys so each turn gets its own
  // queued callback. Generic wakes only need one pending callback per lane.
  const key = threadRootId != null
    ? `resume:${chatJid}:${String(threadRootId)}`
    : `resume:${chatJid}:wake`;
  ctx.enqueue(async () => {
    await ctx.processChat(chatJid, ctx.defaultAgentId, threadRootId ?? undefined);
  }, key, `chat:${chatJid}`);
}
