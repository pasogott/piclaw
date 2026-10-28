/**
 * web/posts-service.ts – User message (post) creation and validation.
 *
 * Parses inbound post payloads from the compose box, stores them as
 * messages in the database, triggers link preview fetching, and
 * broadcasts the new post via SSE.
 *
 * Consumers: web/handlers/posts.ts calls parsePostPayload() and storePost().
 */

import type { WebChannelLike } from "./core/web-channel-contracts.js";
import { sanitizePublicInboundContentBlocks } from "./messaging/content-block-safety.js";

/** Shape of the JSON body received from the compose box on POST /post. */
export interface PostPayload {
  content?: string;
  thread_id?: number | null;
  media_ids?: number[];
  content_blocks?: unknown[];
  link_previews?: unknown[];
}

/**
 * Max allowed message content length (100 KB).
 * Prevents users from submitting extremely large messages that would
 * bloat the SQLite database and FTS index. This limit is also enforced
 * in agent-message-service.ts and handleInternalPost/handleUpdatePost.
 */
const MAX_POST_CONTENT_LENGTH = 100 * 1024;

/**
 * Validate and parse a raw POST body into a PostPayload.
 * Checks for:
 *   - Valid object body
 *   - Non-empty content field
 *   - Content length within MAX_POST_CONTENT_LENGTH
 */
export function parsePostPayload(body: unknown): { ok: boolean; error?: string; data?: PostPayload } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid JSON" };
  const data = body as PostPayload;
  if (!data.content) return { ok: false, error: "Missing 'content' field" };
  if (typeof data.content === "string" && data.content.length > MAX_POST_CONTENT_LENGTH) {
    return { ok: false, error: `Content too large (max ${MAX_POST_CONTENT_LENGTH} bytes)` };
  }
  return { ok: true, data };
}

/** Parse a comma-separated media ID string into a number array. */
export function normalizeMediaIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
}

/** Store a user post, attach media, trigger link previews, and broadcast. */
export async function storePost(
  channel: WebChannelLike,
  chatJid: string,
  data: PostPayload,
  options: { isReply: boolean; authorise?: (phase?: "before" | "after") => void; signal?: AbortSignal }
): Promise<{ status: number; body: unknown }> {
  if (options.isReply && !data.thread_id) {
    return { status: 400, body: { error: "Missing 'thread_id' field" } };
  }

  const mediaIds = normalizeMediaIds(data.media_ids);
  const contentBlocks = sanitizePublicInboundContentBlocks(data.content_blocks);
  const linkPreviews = Array.isArray(data.link_previews) ? data.link_previews : undefined;

  const storeOptions = {
    contentBlocks, linkPreviews,
    threadId: options.isReply && data.thread_id ? Number(data.thread_id) : undefined,
  };
  const interaction = channel.admitUserMessage
    ? await channel.admitUserMessage(chatJid, data.content || "", mediaIds, storeOptions,
      options.authorise ?? (() => {}), options.signal ?? new AbortController().signal)
    : channel.storeMessage(chatJid, data.content || "", false, mediaIds, storeOptions);
  if (!interaction) return { status: 500, body: { error: "Failed to store message" } };

  if (options.isReply && data.thread_id) interaction.data.thread_id = Number(data.thread_id);

  channel.broadcastEvent(options.isReply ? "new_reply" : "new_post", interaction);
  return { status: 201, body: interaction };
}
