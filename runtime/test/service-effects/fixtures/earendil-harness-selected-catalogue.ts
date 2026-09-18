import type {
  EarendilSelectedSemanticId,
  EarendilSelectedSemanticStatus,
} from "./earendil-harness-direct-probe.js";

export interface SelectedHarnessEvidenceLink {
  readonly id: EarendilSelectedSemanticId;
  readonly status: EarendilSelectedSemanticStatus;
  readonly tests: readonly string[];
}

/**
 * Closed selected-release evidence map. Test names are exact substrings of the
 * executing public-boundary suites; changing an outcome without executable
 * evidence fails the compatibility tests.
 */
export const SELECTED_HARNESS_EVIDENCE_LINKS = Object.freeze([
  { id: "HC-001", status: "partial", tests: ["HC-001 accept is durable before generation"] },
  { id: "HC-002", status: "partial", tests: ["HC-002 six-argument tools retain Piclaw authority"] },
  { id: "HC-003", status: "partial", tests: ["HC-003 parallel effects complete out of order"] },
  { id: "HC-004", status: "partial", tests: ["HC-004/HC-005/HC-022 JSONL process loss"] },
  { id: "HC-005", status: "partial", tests: ["HC-004/HC-005/HC-022 JSONL process loss"] },
  { id: "HC-006", status: "partial", tests: ["HC-006/HC-007/HC-008 lane queues"] },
  { id: "HC-007", status: "partial", tests: ["HC-006/HC-007/HC-008 lane queues"] },
  { id: "HC-008", status: "partial", tests: ["HC-006/HC-007/HC-008 lane queues"] },
  { id: "HC-009", status: "partial", tests: ["HC-009 abort uses exact operation identity", "HC-009 abort drains steer/follow-up"] },
  { id: "HC-010", status: "partial", tests: ["HC-010 manual compaction publishes one structural result", "HC-010 unsummarized navigation publishes one result, target tip"] },
  { id: "HC-011", status: "partial", tests: ["HC-011 retry wait survives reattachment", "HC-011 zero-delay retry advances once"] },
  { id: "HC-012", status: "partial", tests: ["HC-012/HC-020 deferred suspension", "HC-012 unavailable restored identity"] },
  { id: "HC-013", status: "partial", tests: ["HC-013 accepted operation restores by public inventory"] },
  { id: "HC-014", status: "partial", tests: ["HC-014 public incomplete lane state fails construction"] },
  { id: "HC-015", status: "partial", tests: ["HC-015 explicit lane acquisition is atomic"] },
  { id: "HC-016", status: "partial", tests: ["HC-016 closing accepted-undriven work"] },
  { id: "HC-017", status: "partial", tests: ["HC-017 public prompt and accept-drive agree"] },
  { id: "HC-018", status: "partial", tests: ["HC-018 lane watch buffers pre-start events", "HC-018 public reducer folds ordinary lane events"] },
  { id: "HC-019", status: "partial", tests: ["HC-019 explicit usage adjustments"] },
  { id: "HC-020", status: "partial", tests: ["HC-012/HC-020 deferred suspension", "HC-020 deferred abort cancels the exact provider handle"] },
  { id: "HC-021", status: "partial", tests: ["HC-021 abort-first prevents provider admission", "HC-021 admission-first gives the running tool"] },
  { id: "HC-022", status: "partial", tests: ["HC-004/HC-005/HC-022 JSONL process loss"] },
  { id: "HC-023", status: "partial", tests: ["HC-023 concurrent observers join one lane-owned Drive"] },
  { id: "HC-024", status: "unsupported", tests: ["HC-024/025 pins public SessionRepo scope"] },
  { id: "HC-025", status: "partial", tests: ["HC-024/025 pins public SessionRepo scope", "HC-025 pins selected repository catalogue"] },
] as const satisfies readonly SelectedHarnessEvidenceLink[]);
