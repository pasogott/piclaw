import { expect, test } from "bun:test";
import { initDatabase, getDb, storeChatMetadata, storeMessage, getChatCursor } from "../../../src/db.js";
import { processChat } from "../../../src/channels/web/handlers/agent.js";

function pendingInput(chatJid: string) {
  initDatabase();
  const timestamp = "2026-01-01T00:00:01.000Z";
  storeChatMetadata(chatJid, timestamp, "Web");
  const id = `input:${chatJid}`;
  const rowId = storeMessage({ id, chat_jid: chatJid, sender: "user", sender_name: "User",
    content: "accepted input", timestamp, is_from_me: false });
  return { id, rowId, timestamp };
}

test("web execution without an admitted dispatcher cannot read the legacy runner or write run markers", async () => {
  const chat = "web:no-native-dispatch";
  pendingInput(chat);
  let legacyReads = 0;
  const before = getDb().serialize();
  const channel = { agentPool: { get runAgent() { legacyReads++; throw Error("Legacy runner accessed"); } } };
  await expect(processChat(channel as any, chat, "default")).rejects.toThrow("Native input dispatch is unavailable");
  expect(legacyReads).toBe(0);
  expect(getChatCursor(chat)).toBe("");
  expect(getDb().serialize()).toEqual(before);
});

test("historical failed markers cannot skip accepted native input or be rewritten by selection", async () => {
  const chat = "web:native-with-legacy-history";
  const input = pendingInput(chat);
  const db = getDb();
  db.query(`INSERT INTO chat_cursors(chat_jid,cursor_ts,failed_prev_ts,failed_ts,failed_message_id)
    VALUES(?,'','',?,?)`).run(chat, input.timestamp, input.id);
  const calls: unknown[] = [];
  await processChat({ dispatchAcceptedInput: (...args: unknown[]) => {
    calls.push(args); return async () => "settled";
  }, broadcastEvent() {}, resumeChat() {} } as any, chat, "default");
  expect(calls).toEqual([[chat, input.id, input.rowId]]);
  expect(getChatCursor(chat)).toBe(input.timestamp);
  expect(db.query("SELECT failed_message_id FROM chat_cursors WHERE chat_jid=?").get(chat))
    .toEqual({ failed_message_id: input.id });
});

test("pending wakeups retain one input identity until settlement advances its cursor", async () => {
  const chat = "web:native-repeat-wake";
  const input = pendingInput(chat);
  const selected: unknown[] = [];
  let settled = false, resumed = 0;
  const dispatch = (...args: unknown[]) => {
    selected.push(args); return async () => settled ? "settled" : "pending";
  };
  dispatch.waitForPending = async () => "pending" as const;
  const channel = { dispatchAcceptedInput: dispatch, broadcastEvent() {}, resumeChat() { resumed++; } };
  await processChat(channel as any, chat, "default");
  expect(getChatCursor(chat)).toBe("");
  settled = true;
  await processChat(channel as any, chat, "default");
  expect(selected).toEqual([[chat,input.id,input.rowId],[chat,input.id,input.rowId]]);
  expect(getChatCursor(chat)).toBe(input.timestamp);
  expect(resumed).toBe(1);
});
