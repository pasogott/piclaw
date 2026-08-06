import { describe, expect, test } from "bun:test";
import { resolveModelRequestAuth } from "../../src/utils/model-auth.js";

describe("model auth helper", () => {
  const model = { provider: "openai", id: "gpt-test" } as any;

  test("uses ModelRuntime auth including headers, env, and credential base URL", async () => {
    const auth = await resolveModelRequestAuth({
      getAuth: async () => ({
        auth: {
          apiKey: "runtime-key",
          headers: { "X-Test": "1", "X-Delete": null },
          baseUrl: "https://credential.example.test/v1",
        },
        env: { TEST_BASE_URL: "https://example.test" },
      }),
    } as any, model);

    expect(auth).toEqual({
      ok: true,
      apiKey: "runtime-key",
      headers: { "X-Test": "1", "X-Delete": null },
      env: { TEST_BASE_URL: "https://example.test" },
      baseUrl: "https://credential.example.test/v1",
    });
  });

  test("returns a stable error when no credentials are available", async () => {
    const auth = await resolveModelRequestAuth({ getAuth: async () => undefined } as any, model);
    expect(auth).toEqual({ ok: false, error: "No credentials available for openai/gpt-test." });
  });

  test("unwraps runtime auth failure causes", async () => {
    const auth = await resolveModelRequestAuth({
      getAuth: async () => { throw new Error("auth wrapper", { cause: new Error("refresh denied") }); },
    } as any, model);
    expect(auth).toEqual({ ok: false, error: "refresh denied" });
  });

  test("returns a stable error when the model runtime is unavailable", async () => {
    const auth = await resolveModelRequestAuth(undefined as any, model);
    expect(auth).toEqual({ ok: false, error: "No model runtime is available for openai/gpt-test." });
  });
});
