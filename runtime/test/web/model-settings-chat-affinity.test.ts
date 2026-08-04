import { expect, test } from "bun:test";

import { resolveModelsSettingsChatJid, sendModelsSettingsCommand } from "../../web/src/components/settings/models.ts";

test("Models settings resolves the active branch chat for model/thinking commands", () => {
  expect(resolveModelsSettingsChatJid({
    __piclawCurrentChatJid: "web:epub",
    location: { href: "https://example.test/?chat_jid=web%3Adefault" },
  } as any)).toBe("web:epub");

  expect(resolveModelsSettingsChatJid({
    location: { href: "https://example.test/?chat_jid=web%3Aepub" },
  } as any)).toBe("web:epub");

  expect(resolveModelsSettingsChatJid({ location: { href: "https://example.test/" } } as any)).toBe("web:default");
});

test("Models settings sends thinking changes to the active branch chat", async () => {
  const calls: unknown[][] = [];
  const response = await sendModelsSettingsCommand("/thinking high", "web:epub", async (...args: unknown[]) => {
    calls.push(args);
    return { command: { thinking_level: "high" } };
  });

  expect(calls).toEqual([["default", "/thinking high", null, [], null, "web:epub"]]);
  expect(response).toEqual({ command: { thinking_level: "high" } });
});
