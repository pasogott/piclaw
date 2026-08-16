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
  inventoryRepositoryToolFamilies,
  readRepositorySourceTree,
} from "./fixtures/repository-tool-family-oracle.js";

const required = new Map<string, string[]>();
function requireSelectors(names: readonly string[], selectors: readonly string[]): void {
  for (const name of names) required.set(name, [...(required.get(name) ?? []), ...selectors]);
}

requireSelectors(["list_tools", "get_model_state", "list_models", "activate_tools", "reset_active_tools", "switch_model", "switch_thinking"], []);
requireSelectors(["list_models"], ["params.query"]);
requireSelectors(["list_scripts"], ["params.query", "params.intent", "result.content"]);
requireSelectors(["refresh_workspace_index"], ["result.content", "result.details"]);
requireSelectors(["read", "grep", "find", "ls"], ["params.path", "result.content"]);
requireSelectors(["grep", "find", "ls"], ["params.pattern"]);
requireSelectors(["write", "edit"], ["params.path", "params.content", "params.oldText", "params.newText"]);
requireSelectors(["bash", "local_bash", "powershell"], ["params.command", "result.content", "result.details.fullOutputPath"]);
requireSelectors(["exec_batch"], ["params.commands", "result.content"]);
requireSelectors(["search_tool_output", "search_workspace"], ["params.query", "result.content"]);
requireSelectors(["search_tool_output"], ["params.handle"]);
requireSelectors(["attach_file"], ["params.path", "params.name", "result.content", "result.details"]);
requireSelectors(["read_attachment"], ["params.id", "result.content", "result.details"]);
requireSelectors(["export_attachment"], ["params.id", "params.filename", "result.content", "result.details"]);
requireSelectors(["messages"], ["params.chat_jid", "params.target_chat_jid", "params.row_ids", "params.sender", "params.content", "params.content_blocks", "params.content_grep", "params.media_ids", "params.pattern", "params.query", "result.content", "result.details"]);
requireSelectors(["introspect_sql"], ["params.query", "result.content", "result.details"]);
requireSelectors(["schedule_task", "scheduled_tasks"], ["params.chat_jid", "params.prompt", "params.command", "params.cwd", "result.content", "result.details"]);
requireSelectors(["scheduled_tasks"], ["params.id"]);
requireSelectors(["send_adaptive_card"], ["params.card", "params.content", "params.card_id", "params.payload", "params.chat_jid", "params.fallback_text", "params.state", "params.last_submission", "result.content", "result.details"]);
requireSelectors(["send_dashboard_widget"], ["params.html", "params.content", "params.title", "params.open_label", "params.chat_jid", "params.widget_id", "result.content", "result.details"]);
requireSelectors(["chat"], ["params.content", "params.target_address", "params.target_chat_jid", "params.target_agent_name", "params.media_ids", "params.idempotency_key", "params.in_reply_to", "result.content", "result.details"]);
requireSelectors(["session_control"], ["params.target_address", "params.target_chat_jid", "params.target_agent_name", "params.instructions", "result.content", "result.details"]);
requireSelectors(["session_status"], ["result.details"]);
requireSelectors(["open_workspace_file"], ["params.path", "params.label"]);
requireSelectors(["env"], ["params.name", "params.value", "result.content", "result.details"]);
requireSelectors(["exit_process"], ["params.reason", "params.resume_message"]);
requireSelectors(["image_process"], ["params.input", "params.output", "params.overlay", "params.text", "result.content", "result.details"]);
requireSelectors(["context_prune", "context_tree_query"], ["result.content", "result.details"]);
requireSelectors(["bun_run"], ["params.script", "params.args", "params.cwd", "result.content", "result.details"]);
requireSelectors(["keychain"], ["params.name", "params.secret", "params.username", "result.content", "result.details"]);
requireSelectors(["ssh"], ["params.chat_jid", "params.ssh_target", "params.private_key_keychain", "params.known_hosts_keychain", "result.content", "result.details"]);
requireSelectors(["cdp_browser"], ["params.expr", "params.url", "params.selector", "params.outPath", "params.headerTemplate", "params.footerTemplate", "result.content", "result.details"]);
requireSelectors(["mcp"], ["params.tool", "params.args", "params.server", "params.search", "params.describe", "params.instructions", "params.connect", "params.redirectUrl", "result.content", "result.details"]);

const SAFE_PARAMETER_FIELDS = new Map<string, readonly string[]>([
  ["list_scripts", ["scope", "role", "limit", "include_metadata"]],
  ["activate_tools", ["names", "mode"]],
  ["attach_file", ["content_type", "kind"]],
  ["read_attachment", ["mode", "max_bytes"]],
  ["messages", ["action", "role", "after", "before", "since", "after_row", "before_row", "limit", "excerpt_chars", "offset", "context_before", "context_after", "details_max_chars", "content_lines", "regex", "context_lines", "max_matches", "capture_group", "dedupe", "sort", "type", "dry_run", "force"]],
  ["list_models", ["limit", "offset"]],
  ["switch_model", ["model"]],
  ["switch_thinking", ["level"]],
  ["introspect_sql", ["limit"]],
  ["schedule_task", ["schedule_type", "schedule_value", "model", "task_kind", "timeout_sec", "notify", "muted", "no_nudge"]],
  ["scheduled_tasks", ["action", "status", "limit", "include_latest_run_log", "allow_internal", "notify", "muted", "no_nudge", "schedule_type", "schedule_value", "model", "task_kind", "timeout_sec"]],
  ["search_workspace", ["scope", "limit", "offset", "refresh", "max_kb"]],
  ["send_adaptive_card", ["schema_version", "submit_behavior", "completed_at"]],
  ["send_dashboard_widget", ["interactive"]],
  ["chat", ["mode"]],
  ["session_control", ["action", "model", "force"]],
  ["session_status", ["action"]],
  ["open_workspace_file", ["target"]],
  ["env", ["action", "limit"]],
  ["image_process", ["action", "format", "quality", "width", "height", "fit", "left", "top", "angle", "sigma", "gravity", "preserve_transparency", "overwrite", "animated", "delay", "loop", "frame_count", "direction", "brightness", "saturation", "hue", "gamma", "contrast", "tint_color", "clahe_width", "clahe_height", "threshold_value", "median_size", "extend_top", "extend_bottom", "extend_left", "extend_right", "extend_background", "channel", "text_color", "text_size", "density", "tile_size", "affine_matrix", "strip_metadata"]],
  ["bun_run", ["timeout_sec", "capture_stdout"]],
  ["keychain", ["action", "field", "type", "limit"]],
  ["ssh", ["action", "ssh_port", "strict_host_key_checking"]],
  ["cdp_browser", ["type", "properties", "required"]],
]);

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

  test("rejects hostile outer inputs, update arrays and selector arrays without invoking accessors", () => {
    let calls = 0;
    const hostileInput = Object.defineProperty({}, "params", {
      enumerable: true,
      get: () => { calls += 1; return { secret: "outer-secret" }; },
    });
    const hostileUpdates = Object.defineProperty([], "0", {
      enumerable: true,
      get: () => { calls += 1; return { content: "update-secret" }; },
    });
    hostileUpdates.length = 1;
    const hostileSelectors = Object.defineProperty([], "0", {
      enumerable: true,
      get: () => { calls += 1; return "params.secret"; },
    });
    hostileSelectors.length = 1;
    const revoked = Proxy.revocable([], {});
    revoked.revoke();

    const inputObservation = observeWithProtection(hostileInput as never, ["params.secret"]);
    const updateObservation = observeWithProtection({ updates: hostileUpdates }, ["result.content"]);
    const selectorObservation = observeWithProtection({ params: { secret: "selector-secret" } }, hostileSelectors as never);
    expect(() => observeWithProtection({ params: {} }, revoked.proxy as never)).not.toThrow();
    expect(calls).toBe(0);
    expect(inputObservation.params).toBe("[UNOBSERVABLE]");
    expect(updateObservation.updates).toBe("[UNOBSERVABLE]");
    expect(selectorObservation.params).toBe("[UNOBSERVABLE]");
  });

  test("source schemas are closed by protected fields or explicit safe-field exceptions", () => {
    const sourceTree = readRepositorySourceTree();
    const inventory = inventoryRepositoryToolFamilies(sourceTree);
    const schemaFields = new Map<string, Set<string>>();
    const visitedSites = new Set<string>();
    for (const sites of inventory.registrationSites.values()) {
      for (const file of sites) {
        if (visitedSites.has(file)) continue;
        visitedSites.add(file);
        for (const [toolName, fields] of extractLiteralRegistrationParameterFields(file, sourceTree.files[file])) {
          const accumulated = schemaFields.get(toolName) ?? new Set<string>();
          for (const field of fields) accumulated.add(field);
          schemaFields.set(toolName, accumulated);
        }
      }
    }

    const m365Parameters = extractLiteralRegistrationParameterFields(
      "extensions/experimental/m365/index.ts",
      sourceTree.files["extensions/experimental/m365/index.ts"],
    );
    for (const [toolName, fields] of m365Parameters) {
      required.set(toolName, [...new Set(fields)].map((field) => `params.${field}`).concat("result.content", "result.details"));
    }

    expect(schemaFields.size).toBe(54);
    expect(m365Parameters.size).toBe(25);
    for (const [toolName, fields] of schemaFields) {
      const row = TOOL_PREPARATION_MANIFEST.find((candidate) => candidate.toolName === toolName)!;
      const protectedTopLevel = new Set(row.protectedFields.flatMap((selector) => {
        const match = /^params\.([^.]+)$/.exec(selector);
        return match ? [match[1]] : [];
      }));
      const safe = new Set(SAFE_PARAMETER_FIELDS.get(toolName) ?? []);
      expect([...safe].filter((field) => !fields.has(field))).toEqual([]);
      expect([...safe].filter((field) => protectedTopLevel.has(field))).toEqual([]);
      expect([...fields].filter((field) => !protectedTopLevel.has(field) && !safe.has(field))).toEqual([]);
    }

    expect([...required.keys()].sort()).toEqual(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName).sort());
    for (const row of TOOL_PREPARATION_MANIFEST) {
      for (const selector of required.get(row.toolName) ?? []) expect(row.protectedFields).toContain(selector);
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
