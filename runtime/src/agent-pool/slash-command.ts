/**
 * agent-pool/slash-command.ts – Execute user slash commands via the agent session.
 *
 * When a user sends a message starting with `/`, it may be a skill invocation
 * (`/skill:web-search`), a prompt template, or an extension command. This module
 * routes the raw text through the pi-agent session's prompt() method, captures
 * the streaming output, and returns a structured result.
 *
 * The session's event subscription captures both streaming text deltas and
 * final message_end events to build the complete response text.
 *
 * Consumers:
 *   - agent-pool.ts calls executeSlashCommand() when a message is identified
 *     as a slash command (starts with "/" and matches a known skill/template/
 *     extension command).
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { parseSlashCommand } from "../agent-control/agent-control-parser.js";
export { isSlashCommandInvocation } from "../agent-control/agent-control-parser.js";

import type { AgentControlResult } from "../agent-control/agent-control-types.js";
import { getAgentRuntimeConfig } from "../core/config.js";
import { withChatContext } from "../core/chat-context.js";
import { detectChannel } from "../router.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { promptWithContextPressureRetry } from "./context-pressure-retry.js";
import { waitForSessionIdle } from "./prompt-utils.js";

const log = createLogger("agent-pool.slash-command");

interface TextContentBlock {
  type?: unknown;
  text?: unknown;
}

interface SlashCommandMessage {
  role?: unknown;
  content?: unknown;
  customType?: unknown;
}

interface CapturedSlashMessage {
  role: string;
  text: string;
  customType?: string;
}

type SlashCommandKind = "skill" | "template" | "extension";

function extractTextFromContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const contentBlock = block as TextContentBlock;
        if (contentBlock?.type !== "text") return "";
        return typeof contentBlock.text === "string" ? contentBlock.text : "";
      })
      .join("");
  }
  return "";
}

function toMessageRole(value: unknown): string {
  return typeof value === "string" ? value : "unknown";
}

function resolveSlashCommandKind(
  session: AgentSession,
  rawCommand: string,
  commandName: string,
): { known: true; kind: SlashCommandKind } | { known: false; message: string } {
  const skills = session.resourceLoader.getSkills().skills;
  const templates = session.promptTemplates;
  const extensionRunner = session.extensionRunner;

  if (rawCommand.startsWith("skill:")) {
    const skillName = rawCommand.slice(6).split(/\s+/)[0];
    const known = skills.some((skill) => skill.name === skillName);
    if (!known) {
      return {
        known: false,
        message: `Unknown skill: /skill:${skillName}. Use /commands to list available commands.`,
      };
    }
    return { known: true, kind: "skill" };
  }

  if (templates.some((template) => template.name === commandName)) {
    return { known: true, kind: "template" };
  }

  if (extensionRunner?.getCommand(commandName)) {
    return { known: true, kind: "extension" };
  }

  return {
    known: false,
    message: `Unknown command: /${commandName}. Use /commands to list available commands.`,
  };
}

async function executeExtensionSlashCommand(
  session: AgentSession,
  commandName: string,
  args: string,
): Promise<void> {
  const extensionRunner = session.extensionRunner;
  const command = extensionRunner?.getCommand(commandName);
  if (!command || !extensionRunner) {
    throw new Error(`Unknown extension command: /${commandName}`);
  }

  const ctx = extensionRunner.createCommandContext();
  try {
    await command.handler(args, ctx);
  } catch (err) {
    extensionRunner.emitError({
      extensionPath: `command:${commandName}`,
      event: "command",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Execute a /skill or /prompt-template slash command within a session. */
export async function executeSlashCommand(
  session: AgentSession,
  chatJid: string,
  rawText: string
): Promise<AgentControlResult> {
  const startTime = Date.now();
  const agentRuntimeConfig = getAgentRuntimeConfig();
  try {
    log.info("Executing slash command", {
      operation: "execute_slash_command",
      chatJid,
      rawText,
    });

    const parsed = parseSlashCommand(rawText);
    if (!parsed) {
      return { status: "error", message: "Not a slash command." };
    }

    const { rawCommand, commandName } = parsed;
    const kind = resolveSlashCommandKind(session, rawCommand, commandName);
    if (!kind.known) {
      return { status: "error", message: kind.message };
    }

    // Collect textual output from events (both streaming deltas and final message_end)
    let assistantBuffer = "";
    const customBuffers: string[] = [];
    const capturedMessages: CapturedSlashMessage[] = [];

    const onEvent = (event: AgentSessionEvent) => {
      try {
        if (event.type === "message_update") {
          const messageUpdate = event.assistantMessageEvent;
          if (messageUpdate?.type === "text_delta") {
            assistantBuffer += messageUpdate.delta || "";
          }
          return;
        }

        if (event.type !== "message_end") return;

        const message = event.message as SlashCommandMessage;
        const text = extractTextFromContent(message.content);
        if (text) {
          capturedMessages.push({
            role: toMessageRole(message.role),
            text,
            customType: typeof message.customType === "string" ? message.customType : undefined,
          });
        }

        if (message.role === "assistant") {
          assistantBuffer = text || assistantBuffer;
          return;
        }

        if (text) {
          customBuffers.push(text);
        }
      } catch (err) {
        debugSuppressedError(log, "Failed to capture a slash-command streaming event snapshot.", err, {
          operation: "execute_slash_command.capture_event",
          chatJid,
        });
      }
    };

    const unsub = session.subscribe(onEvent);

    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (agentRuntimeConfig.timeoutMs > 0) {
      timeoutId = setTimeout(async () => {
        timedOut = true;
        log.error("Slash command timed out", {
          operation: "execute_slash_command.timeout",
          chatJid,
          timeoutMs: agentRuntimeConfig.timeoutMs,
        });
        try {
          await session.abort();
        } catch (err) {
          debugSuppressedError(log, "Failed to abort timed-out slash-command session.", err, {
            operation: "execute_slash_command.timeout_abort",
            chatJid,
            timeoutMs: agentRuntimeConfig.timeoutMs,
          });
        }
      }, agentRuntimeConfig.timeoutMs);
    }

    const channel = detectChannel(chatJid);
    try {
      await withChatContext(chatJid, channel, async () => {
        if (kind.kind === "extension") {
          const args = rawCommand === commandName ? "" : rawCommand.slice(commandName.length).trimStart();
          await executeExtensionSlashCommand(session, commandName, args);
        } else {
          await promptWithContextPressureRetry(session, rawText);
          await waitForSessionIdle(session);
        }
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      unsub();
    }

    if (timedOut) {
      return { status: "error", message: `Timed out after ${agentRuntimeConfig.timeoutMs}ms` };
    }

    const finalText = (assistantBuffer && assistantBuffer.trim())
      ? assistantBuffer.trim()
      : customBuffers.join("\n\n").trim();
    const message = finalText || capturedMessages.map((captured) => captured.text).join("\n\n").trim();

    log.info("Slash command completed", {
      operation: "execute_slash_command.complete",
      chatJid,
      durationMs: Date.now() - startTime,
      outputChars: message.length,
    });
    return {
      status: "success",
      message,
      messages: capturedMessages,
      ...(kind.kind === "extension" ? { refresh_runtime: true } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("Slash command failed", {
      operation: "execute_slash_command",
      chatJid,
      errorMessage: message,
      err: error,
    });
    return { status: "error", message };
  }
}
