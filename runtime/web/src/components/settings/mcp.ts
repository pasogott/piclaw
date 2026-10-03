import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { createMcpSettingsController, INITIAL_MCP_SETTINGS, type McpPolicy, type McpSettingsState } from '../../ui/mcp-settings-model.js';

export function McpSection() {
    const [state, setState] = useState<McpSettingsState>(INITIAL_MCP_SETTINGS);
    const controller = useRef<ReturnType<typeof createMcpSettingsController> | null>(null);
    useEffect(() => {
        const current = createMcpSettingsController(setState); controller.current = current;
        void current.refresh();
        return () => { current.dispose(); controller.current = null; };
    }, []);
    const select = (patch: Partial<McpPolicy>) => controller.current?.select(patch);
    return html`<section class="settings-section mcp-settings" aria-label="MCP settings">
      <h3>MCP</h3>
      <p class="settings-hint">Instance-wide engine and codemode policy. This pane previews compatibility only; it does not save settings, connect servers or interrupt chats.</p>
      <button class="settings-btn" type="button" disabled=${state.loading} onClick=${() => void controller.current?.refresh()}>Refresh MCP status</button>
      ${state.loading && html`<p role="status" aria-live="polite">Loading MCP settings…</p>`}
      ${state.error && html`<p class="settings-error" role="alert">${state.error}</p>`}
      ${state.payload && html`
        <div class="settings-row settings-row-vertical"><strong>Persisted policy</strong><span>${state.payload.persisted.policy.engine} / ${state.payload.persisted.policy.codemode}</span></div>
        <p class="settings-hint">Configured factory: ${state.payload.runtime.configuredFactory}. Effective policy and connection status: unknown.</p>
        <div class="settings-row settings-row-vertical"><label for="mcp-engine">Engine to preview</label>
          <select id="mcp-engine" value=${state.draft.engine} onChange=${(e: Event) => select({ engine: (e.target as HTMLSelectElement).value as McpPolicy['engine'] })}>
            <option value="adapter">Adapter (default)</option><option value="native">Native (unavailable)</option>
          </select>
        </div>
        <div class="settings-row settings-row-vertical"><label for="mcp-codemode">Codemode to preview</label>
          <select id="mcp-codemode" value=${state.draft.codemode} onChange=${(e: Event) => select({ codemode: (e.target as HTMLSelectElement).value as McpPolicy['codemode'] })}>
            <option value="auto">Auto (default)</option><option value="on">On</option><option value="off">Off</option>
          </select>
        </div>
        <button class="settings-btn" type="button" disabled=${state.loading} onClick=${() => void controller.current?.preview()}>Preview compatibility</button>
        <p class="settings-hint">Apply unavailable: safe instance-wide switching is not enabled. A future switch will abort active turns and reload all extensions while retaining chats and history.</p>
        ${state.previewed && state.preview && html`<div role="status" aria-live="polite"><strong>${state.preview.applicable ? 'Preview compatible — not applied.' : 'Preview blocked — not applied.'}</strong>
          ${state.preview.issues.length > 0 && html`<ul>${state.preview.issues.map(issue => html`<li>${issue.serverName ? `${issue.serverName}: ` : ''}${issue.field} — ${issue.message}</li>`)}</ul>`}
        </div>`}
        <h4>Servers: native compatibility</h4>
        <p class="settings-hint">These are configuration classifications, not live connection states. A native-blocked server may work through the adapter.</p>
        ${state.payload.servers.length ? html`<ul>${state.payload.servers.map(server => html`<li><strong>${server.name}</strong> — ${server.nativeProjectionStatus}</li>`)}</ul>` : html`<p>No servers in the prepared configuration.</p>`}
      `}
    </section>`;
}
