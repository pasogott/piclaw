import { html, useState, useEffect, useCallback } from '../../vendor/preact-htm.js';
import { getAgentModels, sendAgentMessage } from '../../api.js';
import { useTranslation } from '../../utils/i18n.js';
import { buildModelSearchDocument, normaliseModelCatalogue } from '../../ui/model-catalogue.ts';

const LEGACY_EFFORT_DISPLAY = { off: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'max', max: 'max' };
const DEFAULT_DISPLAY = { off: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };
function isEffortProvider(p) { return typeof p === 'string' && p.toLowerCase() === 'anthropic'; }

export function resolveModelsSettingsChatJid(runtimeWindow: ((Window & typeof globalThis) & { __piclawCurrentChatJid?: string }) | null = typeof window !== 'undefined' ? window : null) {
    const globalValue = typeof runtimeWindow?.__piclawCurrentChatJid === 'string'
        ? runtimeWindow.__piclawCurrentChatJid.trim()
        : '';
    if (globalValue) return globalValue;
    try {
        const raw = new URL(runtimeWindow?.location?.href || 'http://localhost/').searchParams.get('chat_jid');
        return raw && raw.trim() ? raw.trim() : 'web:default';
    } catch {
        return 'web:default';
    }
}

export async function sendModelsSettingsCommand(content, chatJid, sender = sendAgentMessage) {
    return sender('default', content, null, [], null, chatJid);
}

function ThinkingSlider({ thinkingLevel, supportsThinking, provider, availableLevels, onSetLevel, disabled }) {
    const { t } = useTranslation();
    const levels = (availableLevels && availableLevels.length > 1) ? availableLevels : ['off', 'minimal', 'low', 'medium', 'high'];
    const displayMap = isEffortProvider(provider) && !levels.includes('max') ? LEGACY_EFFORT_DISPLAY : DEFAULT_DISPLAY;
    const idx = Math.max(0, levels.indexOf(thinkingLevel ?? 'off'));
    if (!supportsThinking) return html`<div class="settings-thinking-slider"><label>${t('settings.models.thinkingLevel')}</label><p class="settings-hint" style="margin:4px 0 0">${t('settings.models.noThinking')}</p></div>`;
    return html`
        <div class="settings-thinking-slider">
            <label>${t('settings.models.thinkingLevelLabel')} <strong>${displayMap[levels[idx]] || levels[idx]}</strong></label>
            <div class="settings-slider-track">
                <input type="range" min="0" max=${levels.length - 1} step="1" value=${idx} disabled=${disabled}
                    onInput=${(e) => onSetLevel(levels[parseInt(e.target.value, 10)])} />
                <div class="settings-slider-labels">
                    ${levels.map((l, i) => html`<span class=${i === idx ? 'active' : ''} onClick=${() => !disabled && onSetLevel(l)}>${displayMap[l] || l}</span>`)}
                </div>
            </div>
        </div>
    `;
}

export function ModelsSection({ filter = '' }) {
    const { t } = useTranslation();
    const chatJid = resolveModelsSettingsChatJid();
    const [models, setModels] = useState(null);
    const [switching, setSwitching] = useState(false);
    const [thinkingLevel, setThinkingLevel] = useState('off');
    const [supportsThinking, setSupportsThinking] = useState(false);
    const [availableLevels, setAvailableLevels] = useState(['off']);
    const [scopedModelsOnly, setScopedModelsOnly] = useState(false);
    const [scopedBusy, setScopedBusy] = useState(false);
    const [thinkingBusy, setThinkingBusy] = useState(false);

    const loadModels = useCallback(async () => {
        const data = await getAgentModels(chatJid);
        setModels(data);
        if (data.thinking_level_label || data.thinking_level) {
            setThinkingLevel(data.thinking_level_label || data.thinking_level);
        }
        setSupportsThinking(Boolean(data.supports_thinking));
        setScopedModelsOnly(Boolean(data.scoped_models_only));
        const displayLevels = Array.isArray(data.available_thinking_level_labels) && data.available_thinking_level_labels.length > 0
            ? data.available_thinking_level_labels
            : data.available_thinking_levels;
        if (Array.isArray(displayLevels) && displayLevels.length > 0) {
            setAvailableLevels(displayLevels);
        }
        return data;
    }, [chatJid]);
    useEffect(() => {
        loadModels().catch((error) => {
            console.warn('[settings/models] Failed to load models.', error);
            setModels({ models: [], model_options: [] });
        });
    }, []);

    const switchModel = useCallback(async (label) => {
        if (switching) return; setSwitching(true);
        try { await sendModelsSettingsCommand(`/model ${label}`, chatJid); await loadModels(); }
        catch (e) { console.error('Failed to switch model:', e); }
        finally { setSwitching(false); }
    }, [switching, loadModels, chatJid]);

    const setScopedModels = useCallback(async (enabled) => {
        if (scopedBusy) return;
        setScopedBusy(true);
        setScopedModelsOnly(Boolean(enabled));
        try {
            const response = await fetch('/agent/settings/general', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scopedModelsOnly: Boolean(enabled) }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Failed to save scoped model setting.');
            await loadModels();
        } catch (e) {
            console.error('Failed to set scoped model filtering:', e);
            await loadModels().catch((reloadError) => {
                console.warn('[settings/models] Reload after scoped model filtering failure failed.', reloadError);
            });
        } finally {
            setScopedBusy(false);
        }
    }, [scopedBusy, loadModels]);

    const setLevel = useCallback(async (level) => {
        if (thinkingBusy) return; setThinkingBusy(true); setThinkingLevel(level);
        try {
            const resp = await sendModelsSettingsCommand(`/thinking ${level}`, chatJid);
            if (resp?.command?.thinking_level_label || resp?.command?.thinking_level) {
                setThinkingLevel(resp.command.thinking_level_label || resp.command.thinking_level);
            }
            setSupportsThinking(resp?.command?.supports_thinking !== false);
            // Reload to get updated available levels after model/thinking change
            await loadModels();
        } catch (e) {
            console.error('Failed to set thinking:', e);
            await loadModels().catch((reloadError) => {
                console.warn('[settings/models] Reload after thinking change failure failed.', reloadError);
            });
        }
        finally { setThinkingBusy(false); }
    }, [thinkingBusy, loadModels, chatJid]);

    if (!models) return html`<div class="settings-loading">${t('settings.models.loading')}</div>`;
    const options = normaliseModelCatalogue(models);
    const currentOption = options.find((model) => model.current);
    const provider = currentOption?.provider || '';
    const lf = filter.toLowerCase();
    const filtered = lf ? options.filter((model) => buildModelSearchDocument(model).includes(lf)) : options;

    return html`
        <div class="settings-models-split">
            <div class="settings-models-summary settings-hint">${t('settings.models.summary')}</div>
            <div class="settings-row" style="padding:0 0 10px 0; align-items:flex-start">
                <label>${t('settings.models.scopedOnly')}</label>
                <div style="display:flex; flex-direction:column; gap:4px; min-width:0">
                    <label style="display:flex; align-items:center; gap:8px; font-weight:500">
                        <input type="checkbox" checked=${scopedModelsOnly} disabled=${scopedBusy} onChange=${(e) => setScopedModels(e.target.checked)} />
                        ${t('settings.models.scopedCheckboxPre')} <code>enabledModels</code> ${t('settings.models.scopedCheckboxPost')}
                    </label>
                    <span class="settings-hint" style="margin:0">
                        ${t('settings.models.scopedHintPre')} <code>list_models</code> ${t('settings.models.scopedHintPost')}
                    </span>
                </div>
            </div>
            <div class="settings-models-list">
                <table class="settings-table settings-borderless settings-models-table">
                    <thead><tr><th style="width:32px"></th><th>${t('settings.models.colModel')}</th><th>${t('settings.models.colProvider')}</th><th>${t('settings.models.colContext')}</th><th style="text-align:center">${t('settings.models.colReasoning')}</th></tr></thead>
                    <tbody>
                        ${filtered.map((model) => html`
                            <tr class=${model.current ? 'settings-row-active' : ''}>
                                <td><input type="radio" name="settings-model" checked=${model.current} disabled=${switching} onChange=${() => switchModel(model.key)} /></td>
                                <td>${model.displayName}</td><td>${model.provider}</td>
                                <td>${model.contextWindow ? (model.contextWindow / 1000).toFixed(0) + 'K' : '\u2014'}</td>
                                <td style="text-align:center">${model.reasoning ? '\ud83e\udde0' : '\u2014'}</td>
                            </tr>
                        `)}
                        ${filtered.length === 0 && html`<tr><td colspan="5" class="settings-empty">${t('settings.models.noMatch', { filter })}</td></tr>`}
                    </tbody>
                </table>
            </div>
            <div class="settings-models-footer">
                <${ThinkingSlider}
                    thinkingLevel=${thinkingLevel}
                    supportsThinking=${supportsThinking}
                    provider=${provider}
                    availableLevels=${availableLevels}
                    onSetLevel=${setLevel}
                    disabled=${thinkingBusy || switching} />
            </div>
        </div>
    `;
}
