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
