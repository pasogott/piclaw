/** Shared preview-only MCP settings controller for Classic and Visual. */
export interface McpPolicy { engine: 'adapter' | 'native'; codemode: 'auto' | 'on' | 'off' }
export interface McpSettingsPayload {
    persisted: { policy: McpPolicy };
    runtime: { configuredFactory: string; observedPolicy: McpPolicy | null; connectionStatus: string; applyAvailable: boolean };
    readiness: { adapter: boolean; native: boolean; codemode: boolean };
    servers: Array<{ name: string; nativeProjectionStatus: string }>;
    plan: { policy: McpPolicy; applicable: boolean; codemodeEnabled: boolean; issues: Array<{ serverName: string | null; field: string; code: string; message: string }> };
    applyAvailable: boolean;
}
export interface McpSettingsState {
    payload: McpSettingsPayload | null;
    draft: McpPolicy;
    preview: McpSettingsPayload['plan'] | null;
    loading: boolean;
    error: string | null;
    previewed: boolean;
}
export const INITIAL_MCP_SETTINGS: McpSettingsState = { payload: null, draft: { engine: 'adapter', codemode: 'auto' }, preview: null, loading: false, error: null, previewed: false };
const isPolicy = (value: unknown): value is McpPolicy => {
    const p = value as McpPolicy | undefined;
    return !!p && ['adapter', 'native'].includes(p.engine) && ['auto', 'on', 'off'].includes(p.codemode);
};
class McpSettingsError extends Error {}
function payloadFrom(value: any): McpSettingsPayload {
    if (value?.ok !== true || !isPolicy(value.persisted?.policy) || !isPolicy(value.plan?.policy)
        || typeof value.plan.applicable !== 'boolean' || typeof value.plan.codemodeEnabled !== 'boolean'
        || !Array.isArray(value.plan.issues) || !Array.isArray(value.servers)
        || !value.runtime || typeof value.runtime.configuredFactory !== 'string' || typeof value.runtime.connectionStatus !== 'string'
        || !(value.runtime.observedPolicy === null || isPolicy(value.runtime.observedPolicy)) || typeof value.runtime.applyAvailable !== 'boolean'
        || !value.readiness || ['adapter', 'native', 'codemode'].some(key => typeof value.readiness[key] !== 'boolean') || typeof value.applyAvailable !== 'boolean'
        || value.servers.some((server: any) => typeof server?.name !== 'string' || typeof server?.nativeProjectionStatus !== 'string')
        || value.plan.issues.some((issue: any) => !(issue?.serverName === null || typeof issue?.serverName === 'string') || typeof issue?.field !== 'string' || typeof issue?.message !== 'string' || typeof issue?.code !== 'string')) throw new McpSettingsError('Invalid MCP settings response.');
    return value;
}
export function createMcpSettingsController(publish: (state: McpSettingsState) => void, request: typeof fetch = fetch) {
    let state: McpSettingsState = { ...INITIAL_MCP_SETTINGS, draft: { ...INITIAL_MCP_SETTINGS.draft } };
    let generation = 0, disposed = false;
    let controller: AbortController | null = null;
    const emit = (patch: Partial<McpSettingsState>) => { state = { ...state, ...patch }; if (!disposed) publish(state); };
    async function run(preview: boolean) {
        if (disposed) return;
        controller?.abort(); controller = new AbortController();
        const current = ++generation, signal = controller.signal, draft = { ...state.draft };
        emit({ loading: true, error: null, preview: null, previewed: false, ...(!preview ? { payload: null } : {}) });
        try {
            const response = await request(preview ? '/agent/settings/mcp/preview' : '/agent/settings/mcp', {
                credentials: 'same-origin', cache: 'no-store', signal,
                ...(preview ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) } : {}),
            });
            if (!response.ok) throw new McpSettingsError(response.status === 403 || response.status === 401 ? 'MCP settings are available only to the instance owner.' : response.status === 429 ? 'Too many requests. Wait before retrying.' : 'Could not load MCP settings. Retry when the service is available.');
            const payload = payloadFrom(await response.json());
            if (disposed || current !== generation || signal.aborted) return;
            if (preview && (payload.plan.policy.engine !== draft.engine || payload.plan.policy.codemode !== draft.codemode)) throw new McpSettingsError('MCP preview response did not match the requested policy.');
            emit({ payload, draft: preview ? draft : { ...payload.persisted.policy }, preview: payload.plan, previewed: preview, loading: false });
        } catch (error) {
            if (disposed || current !== generation || signal.aborted) return;
            // Clear server state on all failures, especially revoked owner access.
            emit({ payload: null, preview: null, previewed: false, loading: false, error: error instanceof McpSettingsError ? error.message : 'Could not load MCP settings. Retry when the service is available.' });
        }
    }
    return {
        refresh: () => run(false), preview: () => run(true),
        select(patch: Partial<McpPolicy>) {
            const policy = { ...state.draft, ...patch };
            if (disposed || !isPolicy(policy)) return;
            controller?.abort(); generation++;
            emit({ draft: policy, preview: null, previewed: false, loading: false, error: null });
        },
        dispose() { disposed = true; generation++; controller?.abort(); },
    };
}
