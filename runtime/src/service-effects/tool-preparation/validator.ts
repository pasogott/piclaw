import { TOOL_PREPARATION_POLICY } from "./policy.js";
import type { ToolContextField, ToolPreparationSpec } from "./types.js";

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
const SPEC_FIELD_SET = new Set<string>(SPEC_FIELDS);
const EFFECT_CLASSES = new Set(["query", "mutation", "mixed"]);
const REPLAY_POLICIES = new Set(["safe", "never"]);
const CONTEXT_FIELD_ORDER = Object.freeze(["chatJid", "operationId", "env", "localEnv"] as const);
const CONTEXT_FIELDS = new Set<string>(CONTEXT_FIELD_ORDER);
const SERVICE_EFFECTORS = new Set(["EF-S01", "EF-S03", "EF-S04", "EF-S05", "EF-S07"]);
const ABORT_EXPECTATIONS = new Set(["must_stop", "may_finish_late"]);
const DEFAULT_DYNAMIC_TEMPLATES = Object.freeze(["<addon-tool>", "<mcp-direct-tool>"]);
const EXACT_TOOL_NAME = /^[a-z][a-z0-9_]*$/;
const PROTECTED_PARAM_SELECTOR = /^params\.[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const PROTECTED_DETAILS_SELECTOR = /^result\.details(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export type ToolPreparationValidationCode =
  | "invalid_spec"
  | "missing_field"
  | "unexpected_field"
  | "unexpected_symbol"
  | "accessor_field"
  | "invalid_tool_name"
  | "duplicate_tool_name"
  | "invalid_current_source"
  | "invalid_effect_class"
  | "invalid_replay"
  | "unsafe_replay"
  | "invalid_context_fields"
  | "duplicate_context_field"
  | "noncanonical_context_order"
  | "invalid_service_effector"
  | "invalid_abort_expectation"
  | "invalid_protected_fields"
  | "invalid_protected_selector"
  | "duplicate_protected_field"
  | "missing_known_tool"
  | "unexpected_exact_tool"
  | "invalid_dynamic_template"
  | "missing_authoritative_policy"
  | "authoritative_policy_mismatch"
  | "missing_safe_proof"
  | "missing_context_rationale";

export interface ToolPreparationValidationIssue {
  readonly code: ToolPreparationValidationCode;
  readonly toolName: string | null;
  readonly message: string;
}

export interface ToolPreparationValidationOptions {
  readonly knownToolNames?: readonly string[];
  readonly dynamicTemplateNames?: readonly string[];
  readonly rejectUnexpectedExactTools?: boolean;
  readonly enforceAuthoritativePolicy?: boolean;
}

export interface ToolPreparationNormalizationResult {
  readonly specs: readonly ToolPreparationSpec[];
  readonly issues: readonly ToolPreparationValidationIssue[];
}

/** Snapshot, normalize and freeze preparation data without invoking accessors. */
export function normalizeToolPreparationManifest(
  candidates: readonly unknown[],
  options: ToolPreparationValidationOptions = {},
): ToolPreparationNormalizationResult {
  const issues: ToolPreparationValidationIssue[] = [];
  const specs: ToolPreparationSpec[] = [];
  const seenNames = new Set<string>();
  const dynamicNames = new Set(options.dynamicTemplateNames ?? []);

  for (const candidate of candidates) {
    const candidateIssueStart = issues.length;
    const snapshot = snapshotCandidate(candidate, issues);
    if (!snapshot) continue;
    const rawName = snapshot.toolName;
    const toolName = typeof rawName === "string" ? rawName : "";
    const isTemplate = DEFAULT_DYNAMIC_TEMPLATES.includes(toolName as typeof DEFAULT_DYNAMIC_TEMPLATES[number]);
    if (!isTemplate && !EXACT_TOOL_NAME.test(toolName)) {
      issues.push(issue("invalid_tool_name", toolName || null, "toolName must be a canonical lowercase exact name or an approved dynamic template."));
    }
    if (toolName && seenNames.has(toolName)) {
      issues.push(issue("duplicate_tool_name", toolName, `Duplicate manifest row for ${toolName}.`));
    } else if (toolName) {
      seenNames.add(toolName);
    }

    const contextFields = snapshotStringArray(snapshot.contextFields, "contextFields", toolName || null, issues);
    const protectedFields = snapshotStringArray(snapshot.protectedFields, "protectedFields", toolName || null, issues);
    validateContextFields(contextFields, toolName || null, issues);
    validateProtectedFields(protectedFields, isTemplate, toolName || null, issues);

    if (typeof snapshot.currentSource !== "string" || !snapshot.currentSource.trim()) {
      issues.push(issue("invalid_current_source", toolName || null, "currentSource must be a non-empty string."));
    }
    if (!EFFECT_CLASSES.has(String(snapshot.effectClass))) {
      issues.push(issue("invalid_effect_class", toolName || null, "effectClass must be query, mutation, or mixed."));
    }
    if (!REPLAY_POLICIES.has(String(snapshot.replay))) {
      issues.push(issue("invalid_replay", toolName || null, "replay must be safe or never."));
    }
    if ((snapshot.effectClass === "mutation" || snapshot.effectClass === "mixed") && snapshot.replay !== "never") {
      issues.push(issue("unsafe_replay", toolName || null, "Mutation and mixed families must use replay=never."));
    }
    if (snapshot.serviceEffector !== null && !SERVICE_EFFECTORS.has(String(snapshot.serviceEffector))) {
      issues.push(issue("invalid_service_effector", toolName || null, "serviceEffector must name one closed EF-S contract or be null."));
    }
    if (!ABORT_EXPECTATIONS.has(String(snapshot.abortExpectation))) {
      issues.push(issue("invalid_abort_expectation", toolName || null, "abortExpectation must be must_stop or may_finish_late."));
    }

    if (issues.length === candidateIssueStart && validShape(snapshot, contextFields, protectedFields, isTemplate)) {
      const normalized = Object.freeze({
        toolName,
        currentSource: snapshot.currentSource as string,
        effectClass: snapshot.effectClass as ToolPreparationSpec["effectClass"],
        replay: snapshot.replay as ToolPreparationSpec["replay"],
        contextFields: Object.freeze(contextFields as ToolContextField[]),
        serviceEffector: snapshot.serviceEffector as ToolPreparationSpec["serviceEffector"],
        abortExpectation: snapshot.abortExpectation as ToolPreparationSpec["abortExpectation"],
        protectedFields: Object.freeze(protectedFields),
      });
      const policyIssueStart = issues.length;
      if (isTemplate && !isConservativeTemplate(normalized)) {
        issues.push(issue("invalid_dynamic_template", normalized.toolName, `${normalized.toolName} must remain mixed/never/null-EF/may_finish_late with params.* and result.* protected.`));
      }
      validateAuthoritativePolicy(normalized, isTemplate, options.enforceAuthoritativePolicy !== false, issues);
      if (issues.length === policyIssueStart) specs.push(normalized);
    }
  }

  validateCoverage(new Set(specs.map((spec) => spec.toolName)), options, dynamicNames, issues);
  validateTemplates(specs, dynamicNames, issues);
  return Object.freeze({ specs: Object.freeze(specs), issues: Object.freeze(issues) });
}

/** Compatibility validation surface; normalized immutable rows are available above. */
export function validateToolPreparationManifest(
  candidates: readonly unknown[],
  options: ToolPreparationValidationOptions = {},
): readonly ToolPreparationValidationIssue[] {
  return normalizeToolPreparationManifest(candidates, options).issues;
}

function snapshotCandidate(candidate: unknown, issues: ToolPreparationValidationIssue[]): Record<string, unknown> | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    issues.push(issue("invalid_spec", null, "Manifest entries must be non-array objects."));
    return null;
  }
  let keys: readonly PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    keys = Reflect.ownKeys(candidate);
    descriptors = Object.getOwnPropertyDescriptors(candidate);
  } catch {
    issues.push(issue("invalid_spec", null, "Manifest entry reflection failed; hostile proxies are rejected."));
    return null;
  }
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") {
      issues.push(issue("unexpected_symbol", null, "Non-string keys are not part of the closed manifest shape."));
      continue;
    }
    if (!SPEC_FIELD_SET.has(key)) {
      issues.push(issue("unexpected_field", null, `Unexpected field ${key}.`));
      continue;
    }
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) {
      issues.push(issue("accessor_field", null, `Accessor field ${key} is rejected without invocation.`));
      continue;
    }
    snapshot[key] = descriptor.value;
  }
  for (const field of SPEC_FIELDS) {
    if (!Object.hasOwn(snapshot, field)) issues.push(issue("missing_field", null, `Missing field ${field}.`));
  }
  return snapshot;
}

function snapshotStringArray(
  value: unknown,
  field: "contextFields" | "protectedFields",
  toolName: string | null,
  issues: ToolPreparationValidationIssue[],
): string[] {
  if (!Array.isArray(value)) {
    issues.push(issue(field === "contextFields" ? "invalid_context_fields" : "invalid_protected_fields", toolName, `${field} must be a dense array of strings.`));
    return [];
  }
  let keys: readonly PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  } catch {
    issues.push(issue(field === "contextFields" ? "invalid_context_fields" : "invalid_protected_fields", toolName, `${field} reflection failed.`));
    return [];
  }
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0) {
    issues.push(issue(field === "contextFields" ? "invalid_context_fields" : "invalid_protected_fields", toolName, `${field} has an invalid length.`));
    return [];
  }
  if (keys.some((key) => typeof key !== "string" || key !== "length" && !/^(0|[1-9]\d*)$/.test(key))) {
    issues.push(issue(field === "contextFields" ? "invalid_context_fields" : "invalid_protected_fields", toolName, `${field} has non-index properties.`));
  }
  const snapshot: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      issues.push(issue(field === "contextFields" ? "invalid_context_fields" : "invalid_protected_fields", toolName, `${field} must be dense data properties containing strings.`));
      return [];
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function validateContextFields(value: readonly string[], toolName: string | null, issues: ToolPreparationValidationIssue[]): void {
  if (value.some((entry) => !CONTEXT_FIELDS.has(entry))) {
    issues.push(issue("invalid_context_fields", toolName, "contextFields contains a value outside the four-field PiclawToolContext."));
  }
  if (new Set(value).size !== value.length) issues.push(issue("duplicate_context_field", toolName, "contextFields contains duplicates."));
  const canonical = CONTEXT_FIELD_ORDER.filter((field) => value.includes(field));
  if (value.join("\0") !== canonical.join("\0")) {
    issues.push(issue("noncanonical_context_order", toolName, "contextFields must follow chatJid, operationId, env, localEnv order."));
  }
}

function validateProtectedFields(
  value: readonly string[],
  template: boolean,
  toolName: string | null,
  issues: ToolPreparationValidationIssue[],
): void {
  if (value.some((entry) => !entry.trim())) {
    issues.push(issue("invalid_protected_fields", toolName, "protectedFields must contain non-empty selectors."));
  }
  if (new Set(value).size !== value.length) issues.push(issue("duplicate_protected_field", toolName, "protectedFields contains duplicates."));
  for (const selector of value) {
    const wildcard = selector === "params.*" || selector === "result.*";
    const valid = wildcard
      ? template
      : PROTECTED_PARAM_SELECTOR.test(selector) || selector === "result.content" || PROTECTED_DETAILS_SELECTOR.test(selector);
    if (!valid) issues.push(issue("invalid_protected_selector", toolName, `Invalid protected selector ${selector}.`));
  }
}

function validateAuthoritativePolicy(
  spec: ToolPreparationSpec,
  template: boolean,
  enforce: boolean,
  issues: ToolPreparationValidationIssue[],
): void {
  if (!enforce || template) return;
  const policy = TOOL_PREPARATION_POLICY.get(spec.toolName);
  if (!policy) {
    issues.push(issue("missing_authoritative_policy", spec.toolName, `No closed repository policy exists for ${spec.toolName}.`));
    return;
  }
  const mismatch = policy.effectClass !== spec.effectClass ||
    policy.replay !== spec.replay ||
    policy.serviceEffector !== spec.serviceEffector ||
    policy.abortExpectation !== spec.abortExpectation ||
    policy.contextFields.join("\0") !== spec.contextFields.join("\0");
  if (mismatch) issues.push(issue("authoritative_policy_mismatch", spec.toolName, `${spec.toolName} conflicts with its closed effect/context/EF policy.`));
  if (spec.replay === "safe" && !policy.safeProof) {
    issues.push(issue("missing_safe_proof", spec.toolName, `${spec.toolName} has replay=safe without a deterministic query proof.`));
  }
  if (policy.contextRationale.trim().length < 20) {
    issues.push(issue("missing_context_rationale", spec.toolName, `${spec.toolName} lacks context-field rationale.`));
  }
  if (spec.serviceEffector === null && spec.effectClass !== "query" && !policy.nullAuthorityKind) {
    issues.push(issue("authoritative_policy_mismatch", spec.toolName, `${spec.toolName} lacks a null-EF boundary rationale.`));
  }
  if (spec.serviceEffector !== null && (!policy.idempotencyIdentity || policy.activationPrerequisites.length === 0)) {
    issues.push(issue("authoritative_policy_mismatch", spec.toolName, `${spec.toolName} lacks EF identity or activation prerequisites.`));
  }
}

function validateCoverage(
  names: ReadonlySet<string>,
  options: ToolPreparationValidationOptions,
  templates: ReadonlySet<string>,
  issues: ToolPreparationValidationIssue[],
): void {
  const known = new Set(options.knownToolNames ?? []);
  for (const knownName of known) {
    if (!names.has(knownName)) issues.push(issue("missing_known_tool", knownName, `Known repository tool ${knownName} lacks an exact row.`));
  }
  if (options.rejectUnexpectedExactTools) {
    for (const name of names) {
      if (!known.has(name) && !templates.has(name)) issues.push(issue("unexpected_exact_tool", name, `Exact row ${name} is not repository-owned.`));
    }
  }
}

function validateTemplates(
  specs: readonly ToolPreparationSpec[],
  templates: ReadonlySet<string>,
  issues: ToolPreparationValidationIssue[],
): void {
  const byName = new Map(specs.map((spec) => [spec.toolName, spec]));
  for (const templateName of templates) {
    const template = byName.get(templateName);
    if (!template || !isConservativeTemplate(template)) {
      issues.push(issue("invalid_dynamic_template", templateName, `${templateName} must remain mixed/never/null-EF/may_finish_late with params.* and result.* protected.`));
    }
  }
}

function isConservativeTemplate(template: ToolPreparationSpec): boolean {
  return template.effectClass === "mixed" && template.replay === "never" && template.serviceEffector === null &&
    template.abortExpectation === "may_finish_late" && template.protectedFields.includes("params.*") && template.protectedFields.includes("result.*");
}

function validShape(
  snapshot: Record<string, unknown>,
  contextFields: readonly string[],
  protectedFields: readonly string[],
  template: boolean,
): boolean {
  const name = snapshot.toolName;
  return typeof name === "string" && (EXACT_TOOL_NAME.test(name) || template) &&
    typeof snapshot.currentSource === "string" && Boolean(snapshot.currentSource.trim()) &&
    EFFECT_CLASSES.has(String(snapshot.effectClass)) && REPLAY_POLICIES.has(String(snapshot.replay)) &&
    (snapshot.serviceEffector === null || SERVICE_EFFECTORS.has(String(snapshot.serviceEffector))) &&
    ABORT_EXPECTATIONS.has(String(snapshot.abortExpectation)) &&
    contextFields.every((entry) => CONTEXT_FIELDS.has(entry)) && new Set(contextFields).size === contextFields.length &&
    protectedFields.every((entry) => Boolean(entry));
}

function issue(code: ToolPreparationValidationCode, toolName: string | null, message: string): ToolPreparationValidationIssue {
  return Object.freeze({ code, toolName, message });
}
