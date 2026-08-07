/**
 * agent-control/handlers/queue.ts – Handlers for /queue and /queue-all commands.
 *
 * Injects a user message directly into the agent's prompt queue, bypassing
 * the normal message pipeline. Useful for steering the agent mid-conversation.
 *
 * Consumers: agent-control-handlers.ts dispatches to these handlers.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { runPromptAndCapture } from "../agent-control-helpers.js";
import { promptWithContextPressureRetry } from "../../agent-pool/context-pressure-retry.js";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";

type QueueCommand = Extract<AgentControlCommand, { type: "queue" | "queue_all" }>;
type SteeringCommand = Extract<AgentControlCommand, { type: "steering_mode" }>;
type FollowupCommand = Extract<AgentControlCommand, { type: "followup_mode" }>;
type SteerCommand = Extract<AgentControlCommand, { type: "steer" }>;

/** Handle /queue: inject a message into the agent prompt queue. */
export async function handleQueue(session: AgentSession, command: QueueCommand): Promise<AgentControlResult> {
  const queuedText = command.message?.trim();
  const useBatch = command.type === "queue_all";
  const mode = useBatch ? "all" : "one-at-a-time";

  if (!queuedText) {
    return {
      status: "error",
      message: useBatch ? "Usage: /queue-all <message>" : "Usage: /queue <message>",
    };
  }

  if (session.followUpMode !== mode) {
    session.setFollowUpMode(mode);
  }

  try {
    if (typeof (session as { subscribe?: unknown }).subscribe === "function") {
      await runPromptAndCapture(session, queuedText, { streamingBehavior: "followUp" });
    } else {
      await promptWithContextPressureRetry(session, queuedText, { streamingBehavior: "followUp" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }

  return {
    status: "success",
    message: useBatch ? "Queued follow-up (mode: all)." : "Queued follow-up.",
    queued_followup: true,
  };
}


/** Handle /steer: inject an immediate steering instruction into the active stream. */
export async function handleSteer(session: AgentSession, command: SteerCommand): Promise<AgentControlResult> {
  const steerText = command.message?.trim();

  if (!steerText) {
    return {
      status: "error",
      message: "Usage: /steer <message>",
    };
  }

  if (!session.isStreaming) {
    try {
      await promptWithContextPressureRetry(session, steerText, { streamingBehavior: "followUp" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: "error", message };
    }

    return {
      status: "success",
      message: "Queued follow-up.",
      queued_followup: true,
    };
  }

  try {
    await session.prompt(steerText, { streamingBehavior: "steer" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      message,
      ...(!session.isStreaming ? { retry_as_followup: true } : {}),
    };
  }

  return {
    status: "success",
    message: `Steering queued: ${steerText}`,
    queued_steer: true,
  };
}

/** Handle /steering-mode: set "all" or "one-at-a-time" steering. */
export async function handleSteeringMode(session: AgentSession, command: SteeringCommand): Promise<AgentControlResult> {
  const hasArgs = command.raw.trim().split(/\s+/).length > 1;
  if (!command.mode) {
    if (hasArgs) {
      return { status: "error", message: "Usage: /steering-mode all|one" };
    }
    return { status: "success", message: `Steering mode: ${session.steeringMode}.` };
  }
  session.setSteeringMode(command.mode);
  return { status: "success", message: `Steering mode set to ${command.mode}.` };
}

/** Handle /followup-mode: set "all" or "one-at-a-time" followups. */
export async function handleFollowupMode(session: AgentSession, command: FollowupCommand): Promise<AgentControlResult> {
  const hasArgs = command.raw.trim().split(/\s+/).length > 1;
  if (!command.mode) {
    if (hasArgs) {
      return { status: "error", message: "Usage: /followup-mode all|one" };
    }
    return { status: "success", message: `Follow-up mode: ${session.followUpMode}.` };
  }
  session.setFollowUpMode(command.mode);
  return { status: "success", message: `Follow-up mode set to ${command.mode}.` };
}
