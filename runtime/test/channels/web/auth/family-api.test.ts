import { afterEach, expect, test } from "bun:test";
import { FamilyApi, parseFamilyIdentity } from "../../../../web/src/family-api.js";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const value = { principal: { kind: "user", mode: "family-shared", role: "member", userId: "alice", username: "alice", displayName: "Alice", homeChatJid: "web:alice", authentication: { sessionId: "login-a" } } };

test("identity validates family user, login, role and home without accepting a local fallback", () => {
  expect(Object.isFrozen(parseFamilyIdentity(value))).toBe(true);
  for (const change of [{ kind: "local" }, { mode: "single-user" }, { role: "unknown" }, { homeChatJid: null }, { authentication: {} }]) {
    expect(() => parseFamilyIdentity({ principal: { ...value.principal, ...change } })).toThrow();
  }
});

test("mode changes or revocation after response parsing invalidate instead of releasing old data", async () => {
  for (const response of [() => Response.json({ principal: { ...value.principal, mode: "single-user" } }), () => Response.json({}, { status: 401 })]) {
    let invalidated = 0; const api = new FamilyApi(parseFamilyIdentity(value), () => { invalidated++; });
    globalThis.fetch = (async (url: string) => url === "/auth/me" ? response() : Response.json({ secret: "old" })) as any;
    await expect(api.request("/timeline")).rejects.toThrow(); expect(invalidated).toBe(1);
    await expect(api.request("/timeline")).rejects.toThrow("no longer active");
  }
});

test("pin conflict invalidates without retry; owned-target denial leaves home recovery available", async () => {
  for (const status of [403, 409]) {
    let calls = 0, invalidated = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({}, { status }); }) as any;
    const api = new FamilyApi(parseFamilyIdentity(value), () => { invalidated++; });
    await expect(api.request("/timeline")).rejects.toThrow(); expect(calls).toBe(1); expect(invalidated).toBe(status === 409 ? 1 : 0);
  }
});
