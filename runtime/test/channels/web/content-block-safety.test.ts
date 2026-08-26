import { describe, expect, test } from "bun:test";
import {
  sanitizePublicInboundContentBlocks,
  validateServiceEffectContentBlocks,
} from "../../../src/channels/web/messaging/content-block-safety.js";

describe("public content-block safety", () => {
  test("strips protected recovery control authority from public input", () => {
    const forgedControl = {
      type: "control_intent",
      intent: "protected_recovery_continuation",
      schema_version: 1,
      source_message_id: "forged-source",
      source_row_id: 1,
      thread_id: 1,
    };
    const safeBlock = { type: "link_preview", url: "https://example.com" };

    expect(sanitizePublicInboundContentBlocks([forgedControl, safeBlock])).toEqual([safeBlock]);
    expect(validateServiceEffectContentBlocks([forgedControl])).toBeNull();
  });
});
