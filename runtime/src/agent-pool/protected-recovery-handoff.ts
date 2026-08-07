/**
 * protected-recovery-handoff.ts – Bounded ordinary-turn handoff for protected recovery.
 *
 * Generic recovery attempts may temporarily disable tools to obtain a safe
 * terminal response. Such an attempt cannot authoritatively finish work that
 * may still require tools. Non-web callers consume the typed handoff here;
 * web defers it so its handler can durably order the continuation with cursor
 * and terminal-message persistence.
 */

import { TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT } from "./context-pressure-retry.js";
import type { AgentOutput, RunAgentOptions, TurnOutput } from "./contracts.js";

export interface ProtectedRecoveryHandoffOptions {
  /** Web persists the continuation itself before terminal run finalization. */
  deferToolEnabledContinuation?: boolean;
}

/**
 * Run one prompt and, when required, exactly one ordinary tool-enabled turn.
 * The generated continuation never chains, even if its own recovery is also
 * protected. Caller-supplied run options (including intentional tool ceilings)
 * remain in force; only recovery's temporary all-tools suppression is absent.
 */
export async function runWithProtectedRecoveryHandoff(
  prompt: string,
  options: RunAgentOptions & ProtectedRecoveryHandoffOptions,
  run: (nextPrompt: string, nextOptions: RunAgentOptions) => Promise<AgentOutput>,
  onOutput?: (output: AgentOutput) => void,
): Promise<AgentOutput> {
  const bufferedTurns: TurnOutput[] = [];
  const originalOnTurnComplete = options.onTurnComplete;
  const shouldBufferInitialTurns = Boolean(originalOnTurnComplete)
    && !options.protectedRecoveryContinuation;
  const initialOptions = shouldBufferInitialTurns
    ? { ...options, onTurnComplete: (turn: TurnOutput) => bufferedTurns.push(turn) }
    : options;
  const initial = await run(prompt, initialOptions);
  onOutput?.(initial);

  if (
    !initial.requiresToolEnabledContinuation
    || options.protectedRecoveryContinuation
  ) {
    for (const turn of bufferedTurns) originalOnTurnComplete?.(turn);
    return initial;
  }

  // Preserve committed pre-tool progress from the protected run, but suppress
  // its terminal prose: only the ordinary continuation may authoritatively
  // close tool-dependent work. This applies equally when web defers the
  // handoff; otherwise the intentionally tool-free recovery attempt leaks a
  // misleading "tools unavailable" assistant turn before tools are restored.
  for (const turn of bufferedTurns) {
    if (turn.followedByToolUse) originalOnTurnComplete?.(turn);
  }
  if (options.deferToolEnabledContinuation) return initial;
  const continuation = await run(TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT, {
    ...options,
    protectedRecoveryContinuation: true,
  });
  onOutput?.(continuation);
  // The one-shot handoff has been spent. Preserve the continuation outcome,
  // but never expose a flag that a caller could accidentally chain again.
  if (!continuation.requiresToolEnabledContinuation) return continuation;
  const { requiresToolEnabledContinuation: _spent, ...terminal } = continuation;
  return terminal;
}
