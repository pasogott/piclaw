import "../helpers.js";

import { describe, expect, test } from "bun:test";

import {
  DYNAMIC_TOOL_PREPARATION_TEMPLATES,
  TOOL_PREPARATION_MANIFEST,
} from "../../src/service-effects/tool-preparation/manifest.js";
import {
  candidateForSelector,
  observeWithProtection,
} from "./fixtures/protected-observer.js";
import {
  extractLiteralRegistrationParameterFields,
  readRepositorySourceTree,
} from "./fixtures/repository-tool-family-oracle.js";

const required = new Map<string, string[]>();
function requireSelectors(names: readonly string[], selectors: readonly string[]): void {
  for (const name of names) required.set(name, [...(required.get(name) ?? []), ...selectors]);
}

requireSelectors(["list_tools", "get_model_state", "list_models", "activate_tools", "reset_active_tools", "switch_model", "switch_thinking"], []);
requireSelectors(["list_scripts"], ["result.content"]);
requireSelectors(["refresh_workspace_index"], ["result.content", "result.details"]);
requireSelectors(["read", "grep", "find", "ls"], ["params.path", "result.content"]);
requireSelectors(["grep", "find", "ls"], ["params.pattern"]);
requireSelectors(["write", "edit"], ["params.path", "params.content", "params.oldText", "params.newText"]);
requireSelectors(["bash", "local_bash", "powershell"], ["params.command", "result.content", "result.details.fullOutputPath"]);
requireSelectors(["exec_batch"], ["params.commands", "result.content"]);
requireSelectors(["search_tool_output", "search_workspace"], ["params.query", "result.content"]);
requireSelectors(["search_tool_output"], ["params.handle"]);
requireSelectors(["attach_file"], ["params.path", "result.content", "result.details"]);
requireSelectors(["read_attachment"], ["params.id", "result.content", "result.details"]);
requireSelectors(["export_attachment"], ["params.id", "params.filename", "result.content", "result.details"]);
requireSelectors(["messages"], ["params.chat_jid", "params.target_chat_jid", "params.row_ids", "params.sender", "params.content", "params.content_blocks", "params.pattern", "params.query", "result.content", "result.details"]);
requireSelectors(["introspect_sql"], ["params.query", "result.content", "result.details"]);
requireSelectors(["schedule_task", "scheduled_tasks"], ["params.prompt", "params.command", "result.content", "result.details"]);
requireSelectors(["send_adaptive_card"], ["params.card", "result.content", "result.details"]);
requireSelectors(["send_dashboard_widget"], ["params.html", "result.content", "result.details"]);
requireSelectors(["chat"], ["params.content", "params.target_address", "params.target_chat_jid", "params.target_agent_name", "params.media_ids", "params.in_reply_to", "result.content", "result.details"]);
requireSelectors(["session_control"], ["params.target_address", "params.target_chat_jid", "params.target_agent_name", "result.content", "result.details"]);
requireSelectors(["session_status"], ["result.details"]);
requireSelectors(["open_workspace_file"], ["params.path"]);
requireSelectors(["env"], ["params.value", "result.content", "result.details"]);
requireSelectors(["exit_process"], ["params.reason", "params.resume_message"]);
requireSelectors(["image_process"], ["params.input", "params.output", "params.text", "result.content", "result.details"]);
requireSelectors(["context_prune", "context_tree_query"], ["result.content", "result.details"]);
requireSelectors(["bun_run"], ["params.script", "params.args", "params.cwd", "result.content", "result.details"]);
requireSelectors(["keychain"], ["params.name", "params.secret", "params.username", "result.content", "result.details"]);
requireSelectors(["ssh"], ["params.ssh_target", "params.private_key_keychain", "params.known_hosts_keychain", "result.content", "result.details"]);
requireSelectors(["cdp_browser"], ["params.expr", "params.url", "params.selector", "params.outPath", "params.headerTemplate", "params.footerTemplate", "result.content", "result.details"]);
requireSelectors(["mcp"], ["params.tool", "params.args", "params.server", "params.search", "params.describe", "params.instructions", "params.connect", "params.redirectUrl", "result.content", "result.details"]);

describe("WP-3C protected trace/projection oracle", () => {
  test("redacts every declared selector from params, results and updates", () => {
    const selectors = new Set([
      ...TOOL_PREPARATION_MANIFEST.flatMap((row) => row.protectedFields),
      ...DYNAMIC_TOOL_PREPARATION_TEMPLATES.flatMap((row) => row.protectedFields),
    ]);
    for (const [index, selector] of [...selectors].sort().entries()) {
      const secret = `fixture-secret-${index}-${selector}`;
      const candidate = candidateForSelector(selector, secret);
      const observation = observeWithProtection({
        ...candidate,
        updates: candidate.result ? [candidate.result] : [],
      }, [selector]);
      expect(JSON.stringify(observation)).not.toContain(secret);
    }
  });

  test("does not invoke thrown or changing getters and sanitizes generic errors", () => {
    const secret = "getter-and-error-secret";
    let calls = 0;
    const params = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: () => { calls += 1; if (calls > 1) throw new Error(secret); return secret; },
    });
    const result = Object.defineProperty({}, "content", {
      enumerable: true,
      get: () => { calls += 1; throw new Error(secret); },
    });
    const observation = observeWithProtection({ params, result, updates: [result], error: new Error(secret) }, [
      "params.secret", "result.content",
    ]);
    expect(calls).toBe(0);
    expect(JSON.stringify(observation)).not.toContain(secret);
    expect(observation.error).toEqual({ name: "Error", message: "tool operation failed" });
  });

  test("source-schema fixture is closed for all rows and covers every M365 parameter", () => {
    const sourceTree = readRepositorySourceTree();
    const m365Source = sourceTree.files["extensions/experimental/m365/index.ts"];
    const m365Parameters = extractLiteralRegistrationParameterFields("extensions/experimental/m365/index.ts", m365Source);
    for (const [toolName, fields] of m365Parameters) {
      required.set(toolName, [
        ...fields.map((field) => `params.${field}`),
        "result.content",
        "result.details",
      ]);
    }

    expect([...required.keys()].sort()).toEqual(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName).sort());
    expect(m365Parameters.size).toBe(25);
    for (const row of TOOL_PREPARATION_MANIFEST) {
      for (const selector of required.get(row.toolName) ?? []) {
        expect(row.protectedFields).toContain(selector);
      }
    }
  });

  test("wildcard templates redact arbitrary nested candidate data", () => {
    const secret = "dynamic-template-secret";
    for (const template of DYNAMIC_TOOL_PREPARATION_TEMPLATES) {
      const observation = observeWithProtection({
        params: { nested: { secret } },
        result: { content: [{ type: "text", text: secret }], details: { secret } },
        updates: [{ content: secret }],
        error: new Error(secret),
      }, template.protectedFields);
      expect(JSON.stringify(observation)).not.toContain(secret);
    }
  });
});
