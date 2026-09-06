import { beforeAll, afterAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { join } from "node:path";

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
let browser: Browser, server: ReturnType<typeof Bun.serve>, base: string;
const principal = (name = "alice", login = "login-a") => ({ principal: { kind: "user", mode: "family-shared", role: "member", userId: name, username: name, displayName: name, homeChatJid: `web:${name}`, authentication: { sessionId: login } } });
const posts = (content = "Alice private text") => ({ posts: [{ id: 1, timestamp: "today", data: { content, sender_name: "Alice" } }], has_more: false });
async function fixture(page: Page) {
  const state = { identity: principal(), calls: [] as Array<{ path: string; headers: Record<string, string>; body: any }> };
  await page.route("**/auth/me", route => route.fulfill({ json: state.identity }));
  await page.route("**/agent/message-recovery?**", route => route.fulfill({ json: { state: 'idle' } }));
  await page.route("**/agent/branches", route => route.fulfill({ json: { branches: [{ chat_jid: "web:alice", root_chat_jid: "web:alice", agent_name: "home" }, { chat_jid: "web:alice-two", root_chat_jid: "web:alice-two", agent_name: "second" }] } }));
  await page.route("**/timeline?**", route => { state.calls.push({ path: route.request().url(), headers: route.request().headers(), body: null }); return route.fulfill({ json: posts() }); });
  return state;
}
async function ready(page: Page) { await page.waitForFunction(() => document.getElementById("timeline")?.textContent?.includes("Alice private text")); }
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/" || path === "/index.html") return new Response(Bun.file(join(import.meta.dir, "../../web/static/family.html")), { headers: { "Content-Type": "text/html" } });
    if (["/static/common/dist/family.bundle.js", "/static/common/dist/family.bundle.css"].includes(path)) return new Response(Bun.file(join(import.meta.dir, "../../web/static", path.slice(8))));
    if (path === "/login" || path === "/blank") return new Response("<!doctype html><p>Sign in</p>", { headers: { "Content-Type": "text/html" } });
    if (path === "/old-sw.js") return new Response("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));", { headers: { "Content-Type": "text/javascript" } });
    return new Response("not found", { status: 404 });
  } }); base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => { await browser?.close(); server?.stop(true); });

browserTest("fresh login ignores legacy browser state, uses home and sends pinned text with stable retry ID", async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    const state = await fixture(page); const sends: any[] = [];
    await page.addInitScript(() => { localStorage.setItem("piclaw_last_main_chat", "web:bob"); localStorage.setItem("piclaw_btw_session", "FOREIGN_SECRET"); });
    await page.route("**/agent/default/message?**", route => { sends.push({ body: route.request().postDataJSON(), headers: route.request().headers() }); return route.fulfill(sends.length === 1 ? { status: 500, json: {} } : { status: 201, json: { queued: "message" } }); });
    await page.goto(base); await ready(page);
    expect(state.calls[0]!.path).toContain("chat_jid=web%3Aalice"); expect(state.calls[0]!.headers["x-piclaw-login-id"]).toBe("login-a");
    expect(await page.locator("body").textContent()).not.toContain("FOREIGN_SECRET");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#message-text").fill("hello"); await page.locator("#send-message").click();
    await page.waitForFunction(() => document.getElementById("family-error")?.textContent?.includes("Resend unchanged"));
    await page.locator("#send-message").click(); await page.waitForFunction(() => (document.getElementById("message-text") as HTMLTextAreaElement)?.value === "");
    expect(sends).toHaveLength(2); expect(sends[0].body.request_id).toBe(sends[1].body.request_id);
    expect(sends[0].headers["x-piclaw-account-id"]).toBe("alice"); expect(sends[1].body.content).toBe("hello");
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([2, 0]);
  } finally { await page.close(); }
}, 20000);

browserTest("foreign explicit URL does not fall back silently; Go home recovers", async () => {
  const page = await browser.newPage();
  try {
    await fixture(page);
    await page.route("**/timeline?**", route => route.fulfill(route.request().url().includes("web%3Abob") ? { status: 403, json: {} } : { json: posts() }));
    await page.goto(base + "/?chat_jid=web:bob");
    await page.waitForFunction(() => document.getElementById("family-error")?.textContent?.includes("Access denied"));
    expect(page.url()).toContain("web:bob"); expect(await page.locator("#send-message").isDisabled()).toBe(true);
    await page.locator("#go-home").click(); await ready(page); expect(page.url()).toContain("web%3Aalice");
  } finally { await page.close(); }
}, 20000);

browserTest("account/login change during a delayed response clears conversation and draft", async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page); await page.goto(base); await ready(page);
    await page.locator("#message-text").fill("unsent private draft");
    let release!: () => void, admitted!: () => void;
    const held = new Promise<void>(resolve => release = resolve), entered = new Promise<void>(resolve => admitted = resolve);
    await page.route("**/timeline?**", async route => { admitted(); await held; await route.fulfill({ json: posts("STALE_SECRET") }); });
    await page.locator("#refresh").click(); await entered;
    state.identity = principal("bob", "login-b"); release();
    await page.waitForFunction(() => document.getElementById("family-status")?.textContent?.includes("no longer bound"));
    expect(await page.locator("#timeline").textContent()).toBe(""); expect(await page.locator("#message-text").inputValue()).toBe("");
    expect(await page.locator("#send-message").isDisabled()).toBe(true);
  } finally { await page.close(); }
}, 20000);

browserTest("in-flight old session cannot overwrite newly selected session", async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); await page.goto(base); await ready(page);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => release = resolve), waiting = new Promise<void>(resolve => entered = resolve);
    await page.route("**/timeline?**", async route => {
      if (route.request().url().includes("alice-two")) return route.fulfill({ json: posts("SECOND_SESSION") });
      entered(); await held; return route.fulfill({ json: posts("STALE_SESSION") });
    });
    await page.locator("#refresh").click(); await waiting;
    await page.locator("#session-select").selectOption("web:alice-two");
    await page.waitForFunction(() => document.getElementById("timeline")?.textContent?.includes("SECOND_SESSION")); release();
    await page.waitForTimeout(100);
    expect(await page.locator("#timeline").textContent()).not.toContain("STALE_SESSION");
  } finally { await page.close(); }
}, 20000);

browserTest("blur masks private UI, changed login on focus invalidates, pagehide erases drafts", async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page); await page.goto(base); await ready(page); await page.locator("#message-text").fill("private");
    await page.evaluate(() => dispatchEvent(new Event("blur")));
    expect(await page.locator("#timeline").textContent()).toBe(""); expect(await page.locator("#compose-form").isVisible()).toBe(false);
    state.identity = principal("alice", "new-login"); await page.evaluate(() => dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => document.getElementById("family-status")?.textContent?.includes("no longer bound"));
    expect(await page.locator("#message-text").inputValue()).toBe("");
    state.identity = principal(); await page.reload(); await ready(page); await page.locator("#message-text").fill("private");
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
    expect(await page.locator("#message-text").inputValue()).toBe(""); expect(await page.locator("#timeline").textContent()).toBe("");
  } finally { await page.close(); }
}, 20000);

browserTest("pre-existing worker and caches are retired before private API calls", async () => {
  const page = await browser.newPage();
  try {
    let privateCalls = 0;
    await page.route("**/auth/me", route => { privateCalls++; return route.fulfill({ json: principal() }); });
    await page.goto(base + "/blank");
    await page.evaluate(async () => {
      await caches.open("old-piclaw").then(cache => cache.put("/old-private", new Response("secret")));
      await navigator.serviceWorker.register("/old-sw.js"); await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    });
    await page.goto(base);
    await page.waitForFunction(() => document.getElementById("family-error")?.textContent?.includes("previous service worker"));
    expect(privateCalls).toBe(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
  } finally { await page.close(); }
}, 20000);

browserTest("sign out sends the original pins, clears UI and navigates to login", async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); let headers: Record<string, string> = {};
    await page.route("**/auth/logout", route => { headers = route.request().headers(); return route.fulfill({ json: { logged_out: true } }); });
    await page.goto(base); await ready(page); await page.locator("#sign-out").click(); await page.waitForURL(base + "/login");
    expect(headers["x-piclaw-account-id"]).toBe("alice"); expect(headers["x-piclaw-login-id"]).toBe("login-a");
  } finally { await page.close(); }
}, 20000);

browserTest("held-input controls use discovered IDs, require skip confirmation and reuse failed retry key", async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); let held = true; const actions: any[] = [];
    await page.route("**/agent/message-recovery?**", route => route.fulfill({ json: held ? { state: "held", message_rowid: 42 } : { state: "idle" } }));
    await page.route("**/agent/message-recovery", route => {
      actions.push(route.request().postDataJSON());
      if (actions.length === 1) return route.fulfill({ status: 500, json: {} });
      if (actions.at(-1).action === "skip") held = false;
      return route.fulfill({ json: { recovered: true } });
    });
    await page.goto(base); await ready(page);
    expect(await page.locator("#recovery-status").textContent()).toContain("42");
    expect(await page.locator("#skip-message").isDisabled()).toBe(true);
    await page.locator("#retry-message").click();
    await page.waitForFunction(() => document.getElementById("family-error")?.textContent?.includes("same action"));
    await page.locator("#retry-message").click();
    await page.waitForFunction(() => !document.getElementById("family-error")?.textContent);
    expect(actions).toHaveLength(2); expect(actions[0].request_id).toBe(actions[1].request_id); expect(actions[0].message_rowid).toBe(42);
    await page.locator("#confirm-skip").check(); await page.locator("#skip-message").click();
    await page.waitForFunction(() => (document.getElementById("message-recovery") as HTMLElement)?.hidden);
    expect(actions[2].action).toBe("skip"); expect(actions[2].request_id).not.toBe(actions[1].request_id);
  } finally { await page.close(); }
}, 20000);
