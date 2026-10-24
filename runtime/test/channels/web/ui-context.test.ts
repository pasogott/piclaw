/**
 * test/channels/web/ui-context.test.ts – Tests for the extension UI context.
 *
 * Verifies UiBridge and UIContext handle confirm/input dialogs, timeouts,
 * cancellation and chat-scoped state correctly.
 */

import { describe, test, expect, spyOn } from "bun:test";
import "../../helpers.js";
import { UiBridge } from "../../../src/channels/web/theming/ui-bridge.js";
import { createUiContext } from "../../../src/channels/web/ui-context.js";

function makeChannel(options: { chatStateTtlMs?: number } = {}) {
  const events: Array<{ type: string; payload: any }> = [];
  const channel = {
    broadcastEvent: (type: string, payload: any) => events.push({ type, payload }),
  };
  const uiBridge = new UiBridge(channel as any, {
    ...(options.chatStateTtlMs == null ? {} : { chatStateTtlMs: options.chatStateTtlMs }),
  });
  (channel as any).uiBridge = uiBridge;
  return { channel, events, uiBridge };
}

describe("ui-context", () => {
  test("openWorkspaceFile requires acknowledgement and reports UI timeout", async () => {
    const { events, uiBridge } = makeChannel();
    let expire!: () => void;
    const originalSetTimeout = globalThis.setTimeout;
    const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms: number) => {
      expect(ms).toBe(15000);
      expire = callback;
      return originalSetTimeout(() => {}, 60000);
    }) as typeof setTimeout);
    try {
      const result = uiBridge.openWorkspaceFile("web:default", "diagram.drawio", "Diagram");
      const pending = [...uiBridge.pendingUiRequests.values()][0]!;
      clearTimeout(pending.timeoutId);
      expect(events[0]?.payload.options).toEqual({ timeout: 15000, action: "open_workspace_file", path: "diagram.drawio", label: "Diagram", target: "tab" });
      expire();
      expect(await result).toEqual({ ok: false, opened: false, reason: "ui_timeout", detail: "The browser did not confirm opening the workspace file." });
      expect(uiBridge.pendingUiRequests.size).toBe(0);
      expect(events.at(-1)?.type).toBe("extension_ui_timeout");
      for (const value of [null, false, {}, { ok: true, opened: true, target: "tab" }, { ok: false, opened: false, reason: "blocked" }]) {
        const opened = uiBridge.openWorkspaceFile("web:default", "diagram.drawio", "Diagram");
        const [id, request] = [...uiBridge.pendingUiRequests.entries()][0]!;
        clearTimeout(request.timeoutId);
        uiBridge.pendingUiRequests.delete(id);
        request.resolve(value);
        expect(await opened).toEqual(value && typeof value === "object" && ("ok" in value) ? value : { ok: false, opened: false, reason: "ui_not_opened", detail: "The browser did not confirm opening the workspace file." });
      }
    } finally { timer.mockRestore(); }
  });
  test("createUiContext handles confirm/input/editor and editor updates", async () => {
    const { channel, events, uiBridge } = makeChannel();
    const ui = createUiContext(channel as any, "web:default");

    const confirmPromise = ui.confirm("Confirm", "Are you sure?", { timeout: 50 });
    let requestId = Array.from(uiBridge.pendingUiRequests.keys())[0] as string;
    let pending = uiBridge.pendingUiRequests.get(requestId)!;
    clearTimeout(pending.timeoutId);
    uiBridge.pendingUiRequests.delete(requestId);
    pending.resolve(true);
    expect(await confirmPromise).toBe(true);

    const inputPromise = ui.input("Input", "Type here", { timeout: 50 });
    requestId = Array.from(uiBridge.pendingUiRequests.keys())[0] as string;
    pending = uiBridge.pendingUiRequests.get(requestId)!;
    clearTimeout(pending.timeoutId);
    uiBridge.pendingUiRequests.delete(requestId);
    pending.resolve("hello");
    expect(await inputPromise).toBe("hello");

    const editorPromise = ui.editor("Editor", "prefill");
    requestId = Array.from(uiBridge.pendingUiRequests.keys())[0] as string;
    pending = uiBridge.pendingUiRequests.get(requestId)!;
    clearTimeout(pending.timeoutId);
    uiBridge.pendingUiRequests.delete(requestId);
    pending.resolve("edited");
    expect(await editorPromise).toBe("edited");

    const customPromise = (ui.custom as any)(() => null, {
      timeout: 25,
      action: "open_workspace_file",
      path: "notes/index.md",
      target: "popout",
    });
    requestId = Array.from(uiBridge.pendingUiRequests.keys())[0] as string;
    pending = uiBridge.pendingUiRequests.get(requestId)!;
    clearTimeout(pending.timeoutId);
    expect(events.filter((event) => event.type === "extension_ui_request").at(-1)?.payload?.options?.action).toBe("open_workspace_file");
    uiBridge.pendingUiRequests.delete(requestId);
    pending.resolve({ ok: true, opened: true });
    expect(await customPromise).toEqual({ ok: true, opened: true });

    ui.setStatus("key", "Working");
    ui.setWorkingMessage("Busy");
    ui.setTitle("Title");
    ui.setWidget("widget", [{ type: "text", text: "hi" }], { compact: true });

    ui.setEditorText("Alpha");
    expect(ui.getEditorText()).toBe("Alpha");
    ui.pasteToEditor("Beta");
    expect(ui.getEditorText()).toBe("AlphaBeta");

    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("extension_ui_status");
    expect(eventTypes).toContain("extension_ui_working");
    expect(eventTypes).toContain("extension_ui_title");
    expect(eventTypes).toContain("extension_ui_widget");
    expect(eventTypes).toContain("extension_ui_editor_text");
  });

  test("createUiContext does not expose form prompts until the web form bridge exists", () => {
    const { channel } = makeChannel();
    const ui = createUiContext(channel as any, "web:default") as any;

    // pi-mcp-adapter 2.9.0 only enables MCP elicitation when ctx.ui.form exists.
    // Keep this absent until Piclaw has a real web form renderer/response path,
    // so MCP servers cannot advertise a prompt mode that Piclaw cannot render.
    expect(typeof ui.form).toBe("undefined");
  });

  test("createUiContext timeout resolves undefined", async () => {
    const { channel, events, uiBridge } = makeChannel();
    const ui = createUiContext(channel as any, "web:default");

    const selectPromise = ui.select("Pick", ["a", "b"], { timeout: 10 });
    await Bun.sleep(20);
    expect(await selectPromise).toBeUndefined();

    const timeoutEvent = events.find((event) => event.type === "extension_ui_timeout");
    expect(timeoutEvent).toBeDefined();
    expect(uiBridge.pendingUiRequests.size).toBe(0);
  });

  test("chat-scoped UI contexts expose no mutable legacy session lifecycle", () => {
    const { channel, uiBridge } = makeChannel();
    expect("bindSession" in uiBridge).toBe(false);
    const ui = createUiContext(channel as any, "web:default");
    for (const retired of ["waitForIdle", "newSession", "fork", "navigateTree", "switchSession", "reload"])
      expect(retired in ui).toBe(false);
  });

  test("UiBridge prunes stale per-chat state and rejects stale pending requests", async () => {
    const { uiBridge } = makeChannel({ chatStateTtlMs: 10 });
    const staleUi = uiBridge.createUiContext("web:stale");
    staleUi.setEditorText("Alpha");
    staleUi.setTheme("tango");
    const pendingConfirm = staleUi.confirm("Confirm", "Are you sure?", { timeout: 1000 });

    await Bun.sleep(20);

    const freshUi = uiBridge.createUiContext("web:fresh");
    freshUi.setEditorText("Beta");

    await expect(pendingConfirm).rejects.toThrow("Web UI chat state expired");
    expect(uiBridge.pendingUiRequests.size).toBe(0);
    expect(uiBridge.editorTextByChat.has("web:stale")).toBe(false);
    expect(uiBridge.themeByChat.has("web:stale")).toBe(false);
    expect(uiBridge.editorTextByChat.get("web:fresh")).toBe("Beta");
  });
});
