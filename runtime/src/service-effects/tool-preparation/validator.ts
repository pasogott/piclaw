import type { ToolPreparationSpec } from "./types.js";

const SPEC_FIELDS = Object.freeze([
  "toolName",
  "currentSource",
  "effectClass",
  "replay",
  "contextFields",
  "serviceEffector",
  "abortExpectation",
  "protectedFields",
] as const);
const EFFECT_CLASSES = new Set(["query", "mutation", "mixed"]);
const REPLAY_POLICIES = new Set(["safe", "never"]);
const CONTEXT_FIELDS = new Set(["chatJid", "operationId", "env", "localEnv"]);
const SERVICE_EFFECTORS = new Set(["EF-S01", "EF-S03", "EF-S04", "EF-S05", "EF-S07"]);
const ABORT_EXPECTATIONS = new Set(["must_stop", "may_finish_late"]);

export type ToolPreparationValidationCode =
  | "invalid_spec"
  | "missing_field"
  | "unexpected_field"
  | "invalid_tool_name"
  | "duplicate_tool_name"
  | "invalid_current_source"
  | "invalid_effect_class"
  | "invalid_replay"
  | "unsafe_replay"
  | "invalid_context_fields"
  | "duplicate_context_field"
  | "invalid_service_effector"
  | "invalid_abort_expectation"
  | "invalid_protected_fields"
  | "duplicate_protected_field"
  | "missing_known_tool"
  | "unexpected_exact_tool"
  | "invalid_dynamic_template";

export interface ToolPreparationValidationIssue {
  readonly code: ToolPreparationValidationCode;
  readonly toolName: string | null;
  readonly message: string;
}

export interface ToolPreparationValidationOptions {
  readonly knownToolNames?: readonly string[];
  readonly dynamicTemplateNames?: readonly string[];
  readonly rejectUnexpectedExactTools?: boolean;
}

/** Validate inert preparation data without importing or constructing any tool. */
export function validateToolPreparationManifest(
  candidates: readonly unknown[],
  options: ToolPreparationValidationOptions = {},
): readonly ToolPreparationValidationIssue[] {
  const issues: ToolPreparationValidationIssue[] = [];
  const names = new Set<string>();
  const records = new Map<string, Record<string, unknown>>();

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      issues.push(issue("invalid_spec", null, "Manifest entries must be non-array objects."));
      continue;
    }

    const rawName = candidate.toolName;
    const toolName = typeof rawName === "string" ? rawName.trim() : "";
    if (!toolName || rawName !== toolName) {
      issues.push(issue("invalid_tool_name", toolName || null, "toolName must be an exact non-empty name without surrounding whitespace."));
    }
    if (toolName && names.has(toolName)) {
      issues.push(issue("duplicate_tool_name", toolName, `Duplicate manifest row for ${toolName}.`));
    } else if (toolName) {
      names.add(toolName);
      records.set(toolName, candidate);
    }

    for (const field of SPEC_FIELDS) {
      if (!Object.hasOwn(candidate, field)) issues.push(issue("missing_field", toolName || null, `Missing field ${field}.`));
    }
    for (const field of Object.keys(candidate)) {
      if (!(SPEC_FIELDS as readonly string[]).includes(field)) issues.push(issue("unexpected_field", toolName || null, `Unexpected field ${field}.`));
    }

    if (typeof candidate.currentSource !== "string" || !candidate.currentSource.trim()) {
      issues.push(issue("invalid_current_source", toolName || null, "currentSource must be a non-empty string."));
    }
    if (!EFFECT_CLASSES.has(String(candidate.effectClass))) {
      issues.push(issue("invalid_effect_class", toolName || null, "effectClass must be query, mutation, or mixed."));
    }
    if (!REPLAY_POLICIES.has(String(candidate.replay))) {
      issues.push(issue("invalid_replay", toolName || null, "replay must be safe or never."));
    }
    if ((candidate.effectClass === "mutation" || candidate.effectClass === "mixed") && candidate.replay !== "never") {
      issues.push(issue("unsafe_replay", toolName || null, "Mutation and mixed families must use replay=never."));
    }

    validateStringArray(candidate.contextFields, CONTEXT_FIELDS, "contextFields", toolName || null, issues);
    if (candidate.serviceEffector !== null && !SERVICE_EFFECTORS.has(String(candidate.serviceEffector))) {
      issues.push(issue("invalid_service_effector", toolName || null, "serviceEffector must name one closed EF-S contract or be null."));
    }
    if (!ABORT_EXPECTATIONS.has(String(candidate.abortExpectation))) {
      issues.push(issue("invalid_abort_expectation", toolName || null, "abortExpectation must be must_stop or may_finish_late."));
    }
    validateProtectedFields(candidate.protectedFields, toolName || null, issues);
  }

  const known = new Set(options.knownToolNames ?? []);
  const templates = new Set(options.dynamicTemplateNames ?? []);
  for (const knownName of known) {
    if (!names.has(knownName)) issues.push(issue("missing_known_tool", knownName, `Known repository tool ${knownName} lacks an exact row.`));
  }
  if (options.rejectUnexpectedExactTools) {
    for (const name of names) {
      if (!known.has(name) && !templates.has(name)) issues.push(issue("unexpected_exact_tool", name, `Exact row ${name} is not repository-owned.`));
    }
  }

  for (const templateName of templates) {
    const template = records.get(templateName);
    if (!template) {
      issues.push(issue("invalid_dynamic_template", templateName, `Missing dynamic template ${templateName}.`));
      continue;
    }
    const protectedFields = Array.isArray(template.protectedFields) ? template.protectedFields : [];
    if (
      template.effectClass !== "mixed" ||
      template.replay !== "never" ||
      template.serviceEffector !== null ||
      template.abortExpectation !== "may_finish_late" ||
      !protectedFields.includes("params.*") ||
      !protectedFields.includes("result.*")
    ) {
      issues.push(issue("invalid_dynamic_template", templateName, `${templateName} must remain mixed/never/null-EF/may_finish_late with params.* and result.* protected.`));
    }
  }

  return Object.freeze(issues);
}

function validateStringArray(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string,
  toolName: string | null,
  issues: ToolPreparationValidationIssue[],
): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !allowed.has(entry))) {
    issues.push(issue("invalid_context_fields", toolName, `${field} contains a value outside the four-field PiclawToolContext.`));
    return;
  }
  if (new Set(value).size !== value.length) issues.push(issue("duplicate_context_field", toolName, `${field} contains duplicates.`));
}

function validateProtectedFields(value: unknown, toolName: string | null, issues: ToolPreparationValidationIssue[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    issues.push(issue("invalid_protected_fields", toolName, "protectedFields must be an explicit array of non-empty selectors."));
    return;
  }
  if (new Set(value).size !== value.length) issues.push(issue("duplicate_protected_field", toolName, "protectedFields contains duplicates."));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function issue(code: ToolPreparationValidationCode, toolName: string | null, message: string): ToolPreparationValidationIssue {
  return Object.freeze({ code, toolName, message });
}
