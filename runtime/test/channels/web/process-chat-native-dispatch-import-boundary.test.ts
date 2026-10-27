import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const source = resolve(import.meta.dir, "../../../src");

for (const mode of ["settled", "pending"] as const) {
  test(`native accepted dispatch ${mode} path does not evaluate legacy processChat lifecycle modules`, async () => {
    const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-boundary-"));
    const script = `
      import { plugin } from "bun";
      const source = ${JSON.stringify(source)};
      const attempts = [];
      plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
        build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
          if (!args.path.startsWith(source + "/")) return;
          attempts.push(args.path);
          throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
        });
      }});

      const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
      const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
      const chatJid = "web:native-dispatch-boundary";
      const messageId = "msg-native-boundary";
      const messageTs = "2026-01-01T00:00:01.000Z";
      initDatabase();
      storeChatMetadata(chatJid, messageTs, "boundary-user");
      storeMessage({
        id: messageId,
        chat_jid: chatJid,
        sender: "boundary-user",
        sender_name: "Boundary User",
        content: "hello",
        timestamp: messageTs,
        is_from_me: false,
      });

      let resumed = 0;
      let waitCalls = 0;
      const mode = ${JSON.stringify(mode)};
      const dispatchAcceptedInput = () => async () => mode === "pending" ? "pending" : "settled";
      dispatchAcceptedInput.waitForPending = async () => {
        waitCalls += 1;
        return "settled";
      };
      const channel = {
        dispatchAcceptedInput,
        resumeChat() { resumed += 1; },
        broadcastEvent() {},
      };

      await processChat(channel, chatJid, "default");
      console.log(JSON.stringify({
        mode,
        attempts,
        resumed,
        waitCalls,
        cursor: getChatCursor(chatJid),
      }));
    `;

    try {
      const child = Bun.spawn([process.execPath, "--eval", script], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          PICLAW_WORKSPACE: resolve(root, "workspace"),
          PICLAW_STORE: resolve(root, "store"),
          PICLAW_DATA: resolve(root, "data"),
          PI_CODING_AGENT_DIR: resolve(root, "agent"),
          PICLAW_DB_IN_MEMORY: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
      const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
      expect(result.attempts).toEqual([]);
      expect(result.cursor).toBe("2026-01-01T00:00:01.000Z");
      expect(result.resumed).toBe(1);
      expect(result.waitCalls).toBe(mode === "pending" ? 1 : 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
}

test("native coordinator without admitted source fails before legacy processChat lifecycle modules", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-missing-admission-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-missing-admission";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({
      id: "msg-native-missing-admission",
      chat_jid: chatJid,
      sender: "boundary-user",
      sender_name: "Boundary User",
      content: "hello",
      timestamp: messageTs,
      is_from_me: false,
    });

    let failure = "";
    const dispatchAcceptedInput = () => undefined;
    dispatchAcceptedInput.waitForPending = async () => "pending";
    const channel = {
      dispatchAcceptedInput,
      resumeChat() {},
      broadcastEvent() {},
    };

    try {
      await processChat(channel, chatJid, "default");
      throw new Error("Expected processChat to fail when admitted source is missing");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Native input has no admitted source")) {
      throw new Error("Unexpected missing-admission failure: " + failure);
    }

    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), failure }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(String(result.failure)).toContain("Native input has no admitted source");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("native accepted dispatch throw path fails before legacy lifecycle when pending observer is missing", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-throw-no-observer-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-throw-no-observer";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({
      id: "msg-native-throw-no-observer",
      chat_jid: chatJid,
      sender: "boundary-user",
      sender_name: "Boundary User",
      content: "hello",
      timestamp: messageTs,
      is_from_me: false,
    });

    let failure = "";
    const dispatchAcceptedInput = () => {
      throw new Error("synthetic dispatch throw");
    };
    const channel = {
      dispatchAcceptedInput,
      resumeChat() {},
      broadcastEvent() {},
    };

    try {
      await processChat(channel, chatJid, "default");
      throw new Error("Expected missing pending observer failure");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Accepted dispatch requires host pending observation")) {
      throw new Error("Unexpected dispatch-throw failure: " + failure);
    }

    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), failure }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(String(result.failure)).toContain("Accepted dispatch requires host pending observation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("native accepted dispatch pending observer unresolved path exits without cursor advance or legacy lifecycle", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-pending-unresolved-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-pending-unresolved";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({
      id: "msg-native-pending-unresolved",
      chat_jid: chatJid,
      sender: "boundary-user",
      sender_name: "Boundary User",
      content: "hello",
      timestamp: messageTs,
      is_from_me: false,
    });

    let resumed = 0;
    let waitCalls = 0;
    const dispatchAcceptedInput = () => async () => "pending";
    dispatchAcceptedInput.waitForPending = async () => {
      waitCalls += 1;
      return "pending";
    };
    const channel = {
      dispatchAcceptedInput,
      resumeChat() { resumed += 1; },
      broadcastEvent() {},
    };

    await processChat(channel, chatJid, "default");
    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), resumed, waitCalls }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(result.resumed).toBe(0);
    expect(result.waitCalls).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("native accepted dispatch must be callable before legacy lifecycle fallback", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-noncallable-dispatch-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-noncallable-dispatch";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({
      id: "msg-native-noncallable-dispatch",
      chat_jid: chatJid,
      sender: "boundary-user",
      sender_name: "Boundary User",
      content: "hello",
      timestamp: messageTs,
      is_from_me: false,
    });

    let failure = "";
    const dispatchAcceptedInput = () => ({ status: "pending" });
    dispatchAcceptedInput.waitForPending = async () => "settled";
    const channel = {
      dispatchAcceptedInput,
      resumeChat() {},
      broadcastEvent() {},
    };

    try {
      await processChat(channel, chatJid, "default");
      throw new Error("Expected non-callable dispatch rejection");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Accepted dispatch must be callable")) {
      throw new Error("Unexpected non-callable dispatch failure: " + failure);
    }

    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), failure }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(String(result.failure)).toContain("Accepted dispatch must be callable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("native accepted dispatch invalid status is rejected before legacy lifecycle modules", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-invalid-dispatch-status-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-invalid-dispatch-status";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({ id: "msg-native-invalid-dispatch-status", chat_jid: chatJid, sender: "boundary-user", sender_name: "Boundary User", content: "hello", timestamp: messageTs, is_from_me: false });

    let failure = "";
    const dispatchAcceptedInput = () => async () => "invalid-status";
    dispatchAcceptedInput.waitForPending = async () => "settled";
    const channel = { dispatchAcceptedInput, resumeChat() {}, broadcastEvent() {} };

    try { await processChat(channel, chatJid, "default"); throw new Error("Expected invalid dispatch status rejection"); }
    catch (error) { failure = String(error); }

    if (!failure.includes("Accepted dispatch returned invalid status")) {
      throw new Error("Unexpected invalid dispatch failure: " + failure);
    }

    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), failure }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], { cwd: root, env: { PATH: process.env.PATH, HOME: root, PICLAW_WORKSPACE: resolve(root, "workspace"), PICLAW_STORE: resolve(root, "store"), PICLAW_DATA: resolve(root, "data"), PI_CODING_AGENT_DIR: resolve(root, "agent"), PICLAW_DB_IN_MEMORY: "1" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(String(result.failure)).toContain("Accepted dispatch returned invalid status");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("native pending observer invalid status is rejected before legacy lifecycle modules", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-invalid-pending-status-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-invalid-pending-status";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({ id: "msg-native-invalid-pending-status", chat_jid: chatJid, sender: "boundary-user", sender_name: "Boundary User", content: "hello", timestamp: messageTs, is_from_me: false });

    let failure = "";
    const dispatchAcceptedInput = () => async () => "pending";
    dispatchAcceptedInput.waitForPending = async () => "invalid-status";
    const channel = { dispatchAcceptedInput, resumeChat() {}, broadcastEvent() {} };

    try { await processChat(channel, chatJid, "default"); throw new Error("Expected invalid pending status rejection"); }
    catch (error) { failure = String(error); }

    if (!failure.includes("Accepted pending observer returned invalid status")) {
      throw new Error("Unexpected invalid pending observer failure: " + failure);
    }

    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), failure }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], { cwd: root, env: { PATH: process.env.PATH, HOME: root, PICLAW_WORKSPACE: resolve(root, "workspace"), PICLAW_STORE: resolve(root, "store"), PICLAW_DATA: resolve(root, "data"), PI_CODING_AGENT_DIR: resolve(root, "agent"), PICLAW_DB_IN_MEMORY: "1" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(String(result.failure)).toContain("Accepted pending observer returned invalid status");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("native pending observer must be callable before legacy lifecycle fallback", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-noncallable-pending-observer-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-noncallable-pending-observer";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({ id: "msg-native-noncallable-pending-observer", chat_jid: chatJid, sender: "boundary-user", sender_name: "Boundary User", content: "hello", timestamp: messageTs, is_from_me: false });

    let failure = "";
    const dispatchAcceptedInput = () => async () => "settled";
    dispatchAcceptedInput.waitForPending = "non-callable";
    const channel = {
      dispatchAcceptedInput,
      resumeChat() {},
      broadcastEvent() {},
    };

    try {
      await processChat(channel, chatJid, "default");
      throw new Error("Expected non-callable pending observer rejection");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Accepted pending observer must be callable")) {
      throw new Error("Unexpected non-callable pending observer failure: " + failure);
    }

    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), failure }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });

    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(String(result.failure)).toContain("Accepted pending observer must be callable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("native accepted dispatch coordinator must be callable before legacy lifecycle fallback", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-noncallable-coordinator-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-noncallable-coordinator";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({ id: "msg-native-noncallable-coordinator", chat_jid: chatJid, sender: "boundary-user", sender_name: "Boundary User", content: "hello", timestamp: messageTs, is_from_me: false });

    let failure = "";
    const channel = {
      dispatchAcceptedInput: { waitForPending: async () => "settled" },
      resumeChat() {},
      broadcastEvent() {},
    };

    try {
      await processChat(channel, chatJid, "default");
      throw new Error("Expected non-callable coordinator rejection");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Accepted dispatch coordinator must be callable")) {
      throw new Error("Unexpected non-callable coordinator failure: " + failure);
    }

    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), failure }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });

    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(String(result.failure)).toContain("Accepted dispatch coordinator must be callable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("native status updater must be callable before accepted dispatch execution", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-noncallable-status-updater-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-noncallable-status-updater";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({ id: "msg-native-noncallable-status-updater", chat_jid: chatJid, sender: "boundary-user", sender_name: "Boundary User", content: "hello", timestamp: messageTs, is_from_me: false });

    let failure = "";
    let dispatchCalls = 0;
    const dispatchAcceptedInput = () => async () => { dispatchCalls += 1; return "settled"; };
    dispatchAcceptedInput.waitForPending = async () => "settled";
    const channel = {
      dispatchAcceptedInput,
      updateAgentStatus: "invalid-status-updater",
      resumeChat() {},
      broadcastEvent() {},
    };

    try {
      await processChat(channel, chatJid, "default");
      throw new Error("Expected non-callable status updater rejection");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Native status updater must be callable")) {
      throw new Error("Unexpected non-callable status updater failure: " + failure);
    }

    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), failure, dispatchCalls }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });

    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(result.dispatchCalls).toBe(0);
    expect(String(result.failure)).toContain("Native status updater must be callable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("native status broadcaster must be callable before accepted dispatch execution", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-noncallable-status-broadcaster-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-noncallable-status-broadcaster";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({ id: "msg-native-noncallable-status-broadcaster", chat_jid: chatJid, sender: "boundary-user", sender_name: "Boundary User", content: "hello", timestamp: messageTs, is_from_me: false });

    let failure = "";
    let dispatchCalls = 0;
    const dispatchAcceptedInput = () => async () => { dispatchCalls += 1; return "settled"; };
    dispatchAcceptedInput.waitForPending = async () => "settled";
    const channel = {
      dispatchAcceptedInput,
      updateAgentStatus() {},
      resumeChat() {},
      broadcastEvent: "invalid-broadcaster",
    };

    try {
      await processChat(channel, chatJid, "default");
      throw new Error("Expected non-callable status broadcaster rejection");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Native status broadcaster must be callable")) {
      throw new Error("Unexpected non-callable status broadcaster failure: " + failure);
    }

    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), failure, dispatchCalls }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });

    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(result.dispatchCalls).toBe(0);
    expect(String(result.failure)).toContain("Native status broadcaster must be callable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("native resume hook must be callable before accepted dispatch execution", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-process-chat-noncallable-resume-hook-"));
  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-process-chat-runtime-fence", setup(build) {
      build.onLoad({ filter: /\\/channels\\/web\\/runtime\\/process-chat-(preflight|streaming|finalization)-runtime\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_PROCESS_CHAT_FENCE:" + args.path);
      });
    }});

    const { initDatabase, storeChatMetadata, storeMessage, getChatCursor } = await import(source + "/db.js");
    const { processChat } = await import(source + "/channels/web/handlers/agent.ts");
    const chatJid = "web:native-noncallable-resume-hook";
    const messageTs = "2026-01-01T00:00:01.000Z";
    initDatabase();
    storeChatMetadata(chatJid, messageTs, "boundary-user");
    storeMessage({ id: "msg-native-noncallable-resume-hook", chat_jid: chatJid, sender: "boundary-user", sender_name: "Boundary User", content: "hello", timestamp: messageTs, is_from_me: false });

    let failure = "";
    let dispatchCalls = 0;
    const dispatchAcceptedInput = () => async () => { dispatchCalls += 1; return "settled"; };
    dispatchAcceptedInput.waitForPending = async () => "settled";
    const channel = {
      dispatchAcceptedInput,
      updateAgentStatus() {},
      resumeChat: "invalid-resume-hook",
      broadcastEvent() {},
    };

    try {
      await processChat(channel, chatJid, "default");
      throw new Error("Expected non-callable resume hook rejection");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Native resume hook must be callable")) {
      throw new Error("Unexpected non-callable resume hook failure: " + failure);
    }

    console.log(JSON.stringify({ attempts, cursor: getChatCursor(chatJid), failure, dispatchCalls }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });

    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(result.cursor).toBe("");
    expect(result.dispatchCalls).toBe(0);
    expect(String(result.failure)).toContain("Native resume hook must be callable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
