import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import type { PreparedInputText } from "../../src/channels/web/core/web-channel-contracts.js";

interface GoalInputAddon {
  prepareGoalInput(text: string, chatJid: string): {
    decision: { action: "continue" } | { action: "handled" } | { action: "transform"; text: string };
    assertCurrent(): void;
  };
}

/** Read-only preparation before an accepted operation exists. The host must
 * validate the mapped chat and writer on preparation and every admission check. */
export function createHostGoalInput(addon: GoalInputAddon, assertAdmission: (chatJid: string) => void) {
  const prepare = addon.prepareGoalInput.bind(addon);
  return (chatJid: string, text: string): PreparedInputText => {
    const scope = <T>(body: () => T) => withExtensionKvAuthority({ extensionId: "goal", chatJid,
      assertCurrent() { assertAdmission(chatJid); },
      write() { throw Error("Goal input preparation is read-only"); },
    }, body);
    assertAdmission(chatJid);
    const prepared = scope(() => prepare(text, chatJid));
    if (prepared.decision.action === "handled") throw Error("Goal input is no longer executable");
    const content = prepared.decision.action === "transform" ? prepared.decision.text : text;
    return Object.freeze({ text: content, assertCurrent() {
      assertAdmission(chatJid);
      scope(() => prepared.assertCurrent());
    } });
  };
}
