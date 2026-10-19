import type Database from "bun:sqlite";
import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";

/** Read the exact installed Plan module under its own scope, inside the Goal
 * terminal transaction. No global Plan API, legacy lifecycle or copied parser. */
export function createHostGoalPlanReader(root: Database, plan: {
  loadSessionPlan(chat: string): { markdown: string };
  parsePlanMarkdown(markdown: string): { plan: { step: string; status: string }[] };
}, goal: {
  summarizeGoalPlan(items: unknown): { available: boolean; total: number; allCompleted: boolean; fingerprint: string; plan: { step: string; status: string }[] };
}) {
  return (chatJid: string, assertCurrent: () => void) => {
    const check = () => { assertCurrent(); if (!root.inTransaction) throw Error("Goal Plan transaction required"); };
    check();
    const state = withExtensionKvAuthority({ extensionId: "plan-sidebar", chatJid, assertCurrent: check,
      write() { throw Error("Goal Plan read is read-only"); } }, () => {
      const stored = plan.loadSessionPlan(chatJid);
      return goal.summarizeGoalPlan(plan.parsePlanMarkdown(stored.markdown).plan);
    });
    check();
    return state;
  };
}
