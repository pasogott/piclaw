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
