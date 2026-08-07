/**
 * context-pressure-retry.ts – Bounded context-overflow recovery for direct session.prompt() callers.
 *
 * Most normal chat turns go through runAgentPrompt(), which has full automatic
 * recovery. A few control/slash/follow-up paths intentionally call
 * session.prompt() directly. Keep those paths from surfacing provider context
 * window 400s without first trying one compaction.
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { getChatJid } from "../core/chat-context.js";
import { isContextPressureFailure } from "./automatic-recovery.js";
import { finalizeRecoveryCompactionOutcome, runCompactionWithTimeout } from "./compaction.js";

export type DirectPromptOptions = { streamingBehavior?: "steer" | "followUp" };

export const TASK_CONTINUATION_PROMPT = "Continue the current task from persisted state without repeating completed work.";
export const RECOVERY_CONTINUATION_PROMPT = TASK_CONTINUATION_PROMPT;
export const TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT = TASK_CONTINUATION_PROMPT;

export function getSessionLeafId(session: AgentSession): string | null {
  const value = (session.sessionManager as { getLeafId?: () => unknown } | undefined)?.getLeafId?.();
  return typeof value === "string" && value ? value : null;
}

/** Detect whether session.prompt() persisted any new branch state. */
export function didPromptAdvanceSession(session: AgentSession, baselineLeafId: string | null): boolean {
  const currentLeafId = getSessionLeafId(session);
  if (!currentLeafId) return false;
  return baselineLeafId === null || currentLeafId !== baselineLeafId;
}

function getAssistantErrorFromEvent(event: AgentSessionEvent): string | null {
  if (event.type !== "message_end") return null;
  const message = (event as { message?: { role?: unknown; stopReason?: unknown; errorMessage?: unknown } }).message;
  if (message?.role !== "assistant" || message.stopReason !== "error") return null;
  const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage.trim() : "";
  return errorMessage || null;
}

/**
 * Run a direct prompt and, if the provider rejects it for context pressure,
 * compact the session once and retry without replaying a persisted user turn.
 */
export async function promptWithContextPressureRetry(
  session: AgentSession,
  text: string,
  options?: DirectPromptOptions,
): Promise<{ compacted: boolean; errorMessage?: string }> {
  let compacted = false;
  let attemptText = text;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const baselineLeafId = getSessionLeafId(session);
    let providerError: string | null = null;
    const unsubscribe = typeof (session as { subscribe?: unknown }).subscribe === "function"
      ? session.subscribe((event) => {
        providerError = getAssistantErrorFromEvent(event) ?? providerError;
      })
      : null;

    try {
      await session.prompt(attemptText, options);
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error);
    } finally {
      unsubscribe?.();
    }

    if (providerError && isContextPressureFailure(providerError) && !compacted) {
      const promptWasPersisted = didPromptAdvanceSession(session, baselineLeafId);
      const chatJid = getChatJid("direct_prompt_context_pressure");
      const compaction = await runCompactionWithTimeout(
        session,
        chatJid,
        {},
        async () => await session.compact(),
        "recovery",
        { trigger: "recovery", willRetry: true, source: "direct_prompt_context_pressure", attempt: attempt + 1 },
      );
      finalizeRecoveryCompactionOutcome(session, chatJid, compaction);
      if (!compaction.ok) throw new Error(compaction.errorMessage);
      compacted = true;
      attemptText = promptWasPersisted ? RECOVERY_CONTINUATION_PROMPT : attemptText;
      continue;
    }

    if (providerError) throw new Error(providerError);
    return { compacted };
  }

  return { compacted };
}
