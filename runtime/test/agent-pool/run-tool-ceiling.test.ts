import { expect, test } from "bun:test";

import { createRunToolCeilingController, type SessionWithToolControl } from "../../src/agent-pool/run-tool-ceiling.js";

function createToolSession(initial: string[]) {
  let activeTools = [...initial];
  const calls: string[][] = [];
  const session: SessionWithToolControl = {
    getActiveToolNames: () => [...activeTools],
    setActiveToolsByName: (names) => {
      activeTools = [...names];
      calls.push([...names]);
    },
  };
  return { session, calls, active: () => [...activeTools] };
}

test("run tool ceiling blocks reactivation and restores the owner", () => {
  const owner = createToolSession(["read", "bash", "write"]);
  const originalSetter = owner.session.setActiveToolsByName;
  const ceiling = createRunToolCeilingController({
    chatJid: "web:test",
    runOptions: { toolCeilingFilter: (name) => name === "read" },
  });

  expect(ceiling.apply(owner.session)).toBe(true);
  expect(owner.active()).toEqual(["read"]);
  owner.session.setActiveToolsByName?.(["bash", "read"]);
  expect(owner.active()).toEqual(["read"]);

  ceiling.release();
  expect(owner.session.setActiveToolsByName).toBe(originalSetter);
  expect(owner.active()).toEqual(["read", "bash", "write"]);
  expect(ceiling.getOwner()).toBeNull();
});

test("run tool ceiling transfers ownership without restoring an old setter onto the replacement", () => {
  const oldOwner = createToolSession(["read", "bash"]);
  const replacement = createToolSession(["read", "bash", "write"]);
  const oldSetter = oldOwner.session.setActiveToolsByName;
  const replacementSetter = replacement.session.setActiveToolsByName;
  const ceiling = createRunToolCeilingController({
    chatJid: "dream:test",
    runOptions: { toolCeilingFilter: (name) => name === "read" },
  });

  ceiling.apply(oldOwner.session);
  expect(oldOwner.active()).toEqual(["read"]);

  ceiling.apply(replacement.session);
  expect(oldOwner.session.setActiveToolsByName).toBe(oldSetter);
  expect(oldOwner.active()).toEqual(["read", "bash"]);
  expect(replacement.active()).toEqual(["read"]);
  expect(replacement.session.setActiveToolsByName).not.toBe(oldSetter);

  ceiling.release();
  expect(replacement.session.setActiveToolsByName).toBe(replacementSetter);
  expect(replacement.active()).toEqual(["read", "bash", "write"]);
});

test("run tool ceiling transfers to a replacement when the disposed owner cannot restore", () => {
  let disposed = false;
  const warnings: Array<Record<string, unknown>> = [];
  let oldTools = ["read", "bash"];
  const oldOwner: SessionWithToolControl = {
    getActiveToolNames: () => [...oldTools],
    setActiveToolsByName(names) {
      if (disposed) throw new Error("disposed session");
      oldTools = [...names];
    },
  };
  const replacement = createToolSession(["read", "bash", "write"]);
  const ceiling = createRunToolCeilingController({
    chatJid: "dream:test",
    runOptions: { toolCeilingFilter: (name) => name === "read" },
    onWarn: (_message, details) => warnings.push(details),
  });

  ceiling.apply(oldOwner);
  disposed = true;
  expect(ceiling.apply(replacement.session)).toBe(true);
  expect(replacement.active()).toEqual(["read"]);
  expect(ceiling.getOwner()).toBe(replacement.session);
  expect(warnings).toContainEqual(expect.objectContaining({ operation: "run_agent.tool_ceiling_restore_failed" }));
  ceiling.release();
  expect(replacement.active()).toEqual(["read", "bash", "write"]);
});

test("run tool ceiling rejects owners without complete tool controls", () => {
  const warnings: Array<{ message: string; details: Record<string, unknown> }> = [];
  const ceiling = createRunToolCeilingController({
    chatJid: "web:test",
    runOptions: { toolCeilingFilter: () => true },
    onWarn: (message, details) => warnings.push({ message, details }),
  });

  expect(ceiling.apply({ getActiveToolNames: () => ["read"] })).toBe(false);
  expect(warnings).toEqual([expect.objectContaining({
    details: expect.objectContaining({ operation: "run_agent.tool_ceiling" }),
  })]);
});
