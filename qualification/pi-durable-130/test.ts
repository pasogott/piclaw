import "./src/test-guard.js";
import { describe, expect, test } from "bun:test";
import { withCancel } from "@earendil-works/chord/context";
import { barrier, context, openFixture } from "./src/fixture.js";
import { verifyProvenance } from "./src/provenance.js";

async function using(run: (fixture: Awaited<ReturnType<typeof openFixture>>) => Promise<void>) {
  const fixture = await openFixture({ acquired: true });
  try { await run(fixture); } finally { await fixture.close(); }
}

describe("Q1 public candidate MemoryStorage only", () => {
  test("independent public package graph is exactly 1.3.0", async () => {
    for (const name of ["chord", "pi-ai", "pi-codemode", "pi-durable"]) {
      // Package metadata is a filesystem read, not an unexported package subpath import.
      const pkg = await Bun.file(new URL(`./node_modules/@earendil-works/${name}/package.json`, import.meta.url)).json();
      expect(pkg.version).toBe("1.3.0");
      expect(import.meta.resolve(`@earendil-works/${name}`)).toStartWith(new URL("./node_modules/", import.meta.url).href);
    }
  });
  test("registry-extracted candidate bytes match installed closure offline", async () => {
    const evidence = await verifyProvenance();
    expect(evidence.packages).toHaveLength(5);
  });
  test("test guard blocks global fetch and WebSocket without making requests", () => {
    expect(() => fetch("https://invalid.invalid")).toThrow("forbids network");
    expect(() => new WebSocket("wss://invalid.invalid")).toThrow("forbids network");
  });
  test("owner fence rejects before allocating candidate resources", async () => {
    let allocations = 0;
    await expect(openFixture({ acquired: false }, () => allocations++)).rejects.toThrow("before open");
    expect(allocations).toBe(0);
  });
  test("fresh paused open and read-only observers execute nothing", () => using(async f => {
    await f.harness.inspect(context);
    await f.root.context(context);
    const watch = await f.root.watch(context);
    watch.start(async () => {});
    const graph = await f.harness.taskGraph(context);
    await Bun.sleep(10);
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.effects).toBe(0);
    expect(f.host.admissions).toHaveLength(0);
    graph.dispose(); await watch.stop();
  }));
  test("explicit conversation abort cancels placed work before model dispatch", () => using(async f => {
    f.host.modelHold = barrier();
    const submission = await f.submit("active-abort", "hello");
    expect(await submission.abort(context)).toBe("already_placed");
    await f.root.abort(context);
    const status = await submission.status(context);
    expect(status.status).toBe("unanswered");
    if (status.status === "unanswered") expect(status.reason).toBe("aborted");
    f.host.modelHold.release();
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.admissions).toHaveLength(0);
  }));
  test("submit starts scheduling; host dedup rejects changed content; committed answer evidence", () => using(async f => {
    const submission = await f.submit("request-1", "hello");
    expect((await f.submit("request-1", "hello")).id).toBe(submission.id);
    expect(() => f.submit("request-1", "changed")).toThrow("content conflict");
    expect((await submission.wait(context)).status).toBe("done");
    const evidence = await f.settlement(submission);
    expect(evidence.answer.model?.[0]?.role).toBe("assistant");
    expect(f.host.modelCalls).toBe(1);
    expect(f.host.admissions.map(x => x.idempotencyKey)).toEqual(["model:1"]);
    expect(f.reports).toEqual([]);
    expect(f.host.credentialLookups).toBe(0);
  }));
  test("upstream requestId dedup alone does NOT reject changed content", () => using(async f => {
    const one = await f.root.submit({ type: "input", requestId: "raw", content: "hello" }, context);
    const two = await f.root.submit({ type: "input", requestId: "raw", content: "changed" }, context);
    expect(two.id).toBe(one.id);
    await one.wait(context);
    expect(f.host.modelCalls).toBe(1);
  }));
  test("model permission denies at actual dispatch, not a throwing fail-open hook", () => using(async f => {
    f.host.modelAllowed = false;
    const submission = await f.submit("denied", "hello");
    expect((await submission.wait(context)).status).toBe("unanswered");
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.denials).toEqual(["model"]);
    await expect(f.settlement(submission)).rejects.toThrow("No committed answer");
  }));
  test("owner loss after submit denies dispatch without constructing a replacement owner", () => using(async f => {
    f.host.modelHold = barrier();
    const submission = await f.submit("owner-lost", "hello");
    f.owner.acquired = false;
    f.host.modelHold.release();
    expect((await submission.wait(context)).status).toBe("unanswered");
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.denials).toEqual(["model"]);
    expect(f.host.admissions).toHaveLength(0);
  }));
  test("one delegating tool performs one gated synthetic host effect", () => using(async f => {
    const submission = await f.submit("tool", "use-tool");
    expect((await submission.wait(context)).status).toBe("done");
    expect(f.host.effects).toBe(1);
    expect(f.host.credentialLookups).toBe(0);
    expect(f.host.admissions.map(x => x.idempotencyKey.split(":")[0])).toEqual(["model", "tool", "model"]);
    expect(f.host.admissions.every(x => /^[a-f0-9]{64}$/.test(x.requestHash))).toBe(true);
    await f.settlement(submission);
  }));
  test("tool permission revoked after selection is checked immediately at host effect", () => using(async f => {
    f.host.toolHold = barrier();
    const submission = await f.submit("revoked", "use-tool");
    await f.host.toolEntered.promise;
    f.host.toolAllowed = false;
    f.host.toolHold.release();
    await submission.wait(context);
    expect(f.host.effects).toBe(0);
    expect(f.host.denials).toEqual(["tool"]);
    const entries = await f.root.entries({}, 100, undefined, context);
    expect(entries.items.some(e => e.kind === "pi.tool-result" && e.model?.some(m => m.role === "toolResult" && m.isError))).toBe(true);
  }));
  test("cancelling a wait leaves placed work alive; submission.abort only withdraws queued work", () => using(async f => {
    f.host.modelHold = barrier();
    const placed = await f.submit("placed", "hello");
    const queued = await f.submit("queued", "never execute");
    expect((await queued.status(context)).status).toBe("queued");
    const waiter = withCancel(context);
    const waiting = placed.wait(waiter.context);
    waiter.cancel(new Error("wait only"));
    await expect(waiting).rejects.toThrow();
    expect(await placed.abort(context)).toBe("already_placed");
    expect(await queued.abort(context)).toBe("aborted");
    const withdrawn = await queued.status(context);
    expect(withdrawn.status).toBe("unanswered");
    if (withdrawn.status === "unanswered") expect(withdrawn.reason).toBe("aborted");
    expect((await placed.status(context)).status).toBe("placed");
    f.host.modelHold.release();
    expect((await placed.wait(context)).status).toBe("done");
    expect(f.host.modelCalls).toBe(1);
  }));
});
