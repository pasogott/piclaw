import { expect, test } from "bun:test";
import { createHostFetch } from "../../runtime/durable-engine/src/host-fetch.ts";
import { context } from "./src/fixture.ts";

test("codemode fetch returns bounded structured text and omits private headers", async () => {
  let checks = 0;
  const tool = createHostFetch({ async captureSource() { return () => { checks++; }; }, fetch: (async (_url, options) => {
    expect(options).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    return new Response('{"value":7}', { headers: { "content-type": "application/json", "set-cookie": "SECRET" } });
  }) });
  const result = await tool.execute({ url: "http://127.0.0.1/data" }, {} as any, context);
  expect(result.structuredOutput).toMatchObject({ status: 200, ok: true, body: '{"value":7}', headers: { "content-type": "application/json" } });
  expect(JSON.stringify(result)).not.toContain("SECRET");
  expect(checks).toBeGreaterThan(2);
});

test("fetch denies revoked sources, credential URLs and oversized bodies", async () => {
  let calls = 0;
  const request = (async () => { calls++; return new Response("oversize"); });
  const denied = createHostFetch({ async captureSource() { return () => { throw Error("revoked"); }; }, fetch: request });
  await expect(denied.execute({ url: "https://example.com" }, {} as any, context)).rejects.toThrow("revoked");
  const tool = createHostFetch({ async captureSource() { return () => {}; }, fetch: request });
  await expect(tool.execute({ url: "https://user:secret@example.com" }, {} as any, context)).rejects.toThrow("without credentials");
  expect(calls).toBe(0);
  await expect(tool.execute({ url: "https://example.com", max_bytes: 2 }, {} as any, context)).rejects.toThrow("max_bytes");
});
