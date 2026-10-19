import { getExtensionKvStore, withExtensionKvAuthority, type ExtensionKvAuthority } from "../../src/extension-kv-registry.js";

type Goal = { goal_id: string; lifecycle_generation: number; status: string };
type Cursor = { entryId: number; tokens: number };
/** Apply an already-verified committed assistant entry. The SDK reader must feed
 * entries in ascending order after the Goal's start boundary. Not provider events.
 * Cursor and Goal mutation share the caller's operation-owned SQLite transaction. */
export function accountCommittedGoalEntry(addon: {
  loadThreadGoal(chat: string): Goal | null;
  accountGoalProgress(chat: string, tokens: number): unknown;
}, authority: ExtensionKvAuthority, entry: {
  goalId: string; generation: number; conversationId: number; entryId: number; tokens: number;
}): boolean {
  if (authority.extensionId !== "goal" || !entry.goalId ||
    ![entry.generation, entry.conversationId, entry.entryId].every(value => Number.isSafeInteger(value) && value > 0) ||
    !Number.isSafeInteger(entry.tokens) || entry.tokens < 0) throw Error("Invalid committed Goal usage");
  return authority.write(() => withExtensionKvAuthority(authority, () => {
    authority.assertCurrent();
    const goal = addon.loadThreadGoal(authority.chatJid);
    if (!goal || goal.goal_id !== entry.goalId || goal.lifecycle_generation !== entry.generation ||
      (goal.status !== "active" && goal.status !== "budget_limited")) throw Error("Goal usage lifecycle changed");
    const store = getExtensionKvStore();
    const key = `committed-usage:${entry.conversationId}`;
    const saved = store.get<Cursor & { goalId: string }>("goal", key, "chat", authority.chatJid);
    const prior = saved?.goalId === entry.goalId ? saved : undefined;
    if (prior) {
      if (entry.entryId < prior.entryId) throw Error("Goal usage entries out of order");
      if (entry.entryId === prior.entryId) {
        if (entry.tokens !== prior.tokens) throw Error("Committed Goal usage changed");
        return false;
      }
    }
    addon.accountGoalProgress(authority.chatJid, entry.tokens);
    store.set("goal", key, { goalId: entry.goalId, entryId: entry.entryId, tokens: entry.tokens }, "chat", authority.chatJid);
    authority.assertCurrent();
    return true;
  }));
}

/** Bind a read-only SDK receipt batch to a validated accepted Goal input. The
 * caller obtains both texts and receipts from the same captured host operation.
 * No awaits between lifecycle validation, cursor reads and atomic application. */
export function accountCommittedGoalBatch(addon: {
  loadThreadGoal(chat: string): Goal | null;
  accountGoalProgress(chat: string, tokens: number): unknown;
  goalInputIdentity(text: string): { goalId: string; generation: number } | false | null;
}, authority: ExtensionKvAuthority, texts: readonly string[], receipts: readonly {
  conversationId: number; entryId: number; tokens: number;
}[]): number {
  return authority.write(() => withExtensionKvAuthority(authority, () => {
    authority.assertCurrent();
    const identities = texts.map(text => addon.goalInputIdentity(text));
    if (!identities.length || identities.some(identity => !identity)) throw Error("Explicit accepted Goal identity required");
    const identity = identities[0]!;
    if (!identity || identities.some(other => !other || other.goalId !== identity.goalId || other.generation !== identity.generation))
      throw Error("Conflicting accepted Goal identities");
    const goal = addon.loadThreadGoal(authority.chatJid);
    if (!goal || goal.goal_id !== identity.goalId) throw Error("Goal usage lifecycle changed");
    const replayOnly = goal.status === "budget_limited" && goal.lifecycle_generation === identity.generation + 1;
    if (!replayOnly && (goal.lifecycle_generation !== identity.generation || goal.status !== "active"))
      throw Error("Goal usage lifecycle changed");
    let previous = 0, conversation: number | undefined, applied = 0;
    for (const receipt of receipts) {
      if (![receipt.entryId, receipt.conversationId].every(value => Number.isSafeInteger(value) && value > 0) ||
        !Number.isSafeInteger(receipt.tokens) || receipt.tokens < 0) throw Error("Invalid committed Goal usage");
      if (receipt.entryId <= previous || (conversation !== undefined && receipt.conversationId !== conversation))
        throw Error("Goal usage batch out of order");
      previous = receipt.entryId; conversation = receipt.conversationId;
      const cursor = getExtensionKvStore().get<Cursor & { goalId: string; acceptedGeneration?: number }>("goal", `committed-usage:${receipt.conversationId}`, "chat", authority.chatJid);
      if (replayOnly) {
        if (!cursor || cursor.goalId !== goal.goal_id || cursor.acceptedGeneration !== identity.generation || receipt.entryId > cursor.entryId ||
          (receipt.entryId === cursor.entryId && receipt.tokens !== cursor.tokens)) throw Error("Goal usage lifecycle changed");
        continue;
      }
      if (cursor?.goalId === goal.goal_id && receipt.entryId < cursor.entryId) continue;
      const current = addon.loadThreadGoal(authority.chatJid)!;
      if (accountCommittedGoalEntry(addon, authority, { ...receipt, goalId: goal.goal_id, generation: current.lifecycle_generation })) {
        applied++;
        getExtensionKvStore().set("goal", `committed-usage:${receipt.conversationId}`,
          { goalId: goal.goal_id, entryId: receipt.entryId, tokens: receipt.tokens, acceptedGeneration: identity.generation }, "chat", authority.chatJid);
      }
    }
    authority.assertCurrent();
    return applied;
  }));
}
