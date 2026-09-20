import { html, useState, useEffect, useCallback, useMemo, useRef } from '../../vendor/preact-htm.js';
import { applyOutputPad, applyThemeFromEvent, getSynthwaveGlow, setSynthwaveGlow, getThemeModePreference, setThemeModePreference } from '../../ui/theme.js';
import { LanguageSwitcher } from '../language-switcher.js';
import { useTranslation } from '../../utils/i18n.js';

function normalizeOutputPad(value: any) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(24, Math.max(0, Math.round(parsed)));
}

function normalizeAppearanceSettings(data: Record<string, any> = {}) {
    return {
        uiTheme: typeof data.uiTheme === 'string' && data.uiTheme.trim() ? data.uiTheme.trim() : 'default',
        uiTint: typeof data.uiTint === 'string' && data.uiTint.trim() ? data.uiTint.trim() : '',
        outputPad: normalizeOutputPad(data.outputPad),
    };
}

export function ThemeSection({ themes, colorKeys, settingsData, setStatus, mergeSettingsData }) {
    const { t: tr } = useTranslation();
    const [currentTheme, setCurrentTheme] = useState('default');
    const [currentTint, setCurrentTint] = useState('');
    const [glow, setGlow] = useState(getSynthwaveGlow);
    const [mode, setMode] = useState(getThemeModePreference);
    const [outputPad, setOutputPad] = useState(0);
    const [saving, setSaving] = useState(false);
    const savedSnapshotRef = useRef('');
    const saveTimerRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const applyIncoming = useCallback((data) => {
        const next = normalizeAppearanceSettings(data);
        setCurrentTheme(next.uiTheme);
        setCurrentTint(next.uiTint);
        setOutputPad(next.outputPad);
        applyOutputPad(next.outputPad);
        savedSnapshotRef.current = JSON.stringify(next);
    }, []);

    useEffect(() => {
        if (settingsData) {
            applyIncoming(settingsData);
            return;
        }
        applyIncoming({
            uiTheme: document.documentElement.dataset.colorTheme || 'default',
            uiTint: document.documentElement.dataset.tint || '',
            outputPad: document.documentElement.dataset.outputPad || '0',
        });
    }, [settingsData, applyIncoming]);

    const applyLocal = useCallback((name, tint, pad = outputPad) => {
        applyThemeFromEvent({ theme: name, tint: tint || null, outputPad: pad });
        setCurrentTheme(name || 'default');
        setCurrentTint(tint || '');
        setOutputPad(normalizeOutputPad(pad));
    }, [outputPad]);

    const currentSnapshot = useMemo(() => JSON.stringify(normalizeAppearanceSettings({
        uiTheme: currentTheme,
        uiTint: currentTint,
        outputPad,
    })), [currentTheme, currentTint, outputPad]);

    useEffect(() => {
        if (currentSnapshot === savedSnapshotRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            if (!mountedRef.current) return;
            setSaving(true);
            try {
                const response = await fetch('/agent/settings/general', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: currentSnapshot,
                });
                const payload = await response.json().catch(() => ({}));
                if (!mountedRef.current) return;
                if (!response.ok || !payload?.ok || !payload?.settings) {
                    setStatus?.(payload?.error || 'Failed to save appearance settings.', 'error');
                    return;
                }
                savedSnapshotRef.current = currentSnapshot;
                mergeSettingsData?.(payload.settings);
                setStatus?.('Appearance synced across clients.', 'success');
            } catch (error) {
                if (!mountedRef.current) return;
                console.warn('[settings/appearance] Failed to persist appearance settings.', error);
                setStatus?.('Failed to save appearance settings.', 'error');
            } finally {
                if (mountedRef.current) setSaving(false);
            }
        }, 250);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [currentSnapshot, mergeSettingsData, setStatus]);

    const keys = colorKeys || [];
    const presets = themes || [];

    return html`
        <div class="settings-section">
            <div class="settings-row settings-language-row">
                <${LanguageSwitcher} variant="inline" />
            </div>
            ${saving && html`<div class="settings-hint" style="margin:0 0 12px 0;">${tr('settings.appearance.syncing')}</div>`}
            <div class="settings-tint-row">
                <label class="settings-tint-label">
                    <input type="radio" name="settings-theme"
                        checked=${currentTheme === 'default'}
                        onChange=${() => applyLocal('default', currentTint)} />
                    <strong>${tr('settings.appearance.default')}</strong>
                    <span class="settings-hint" style="margin:0 0 0 6px">${tr('settings.appearance.autoLightDark')}</span>
                </label>
                <div class="settings-tint-picker">
                    <label class="settings-hint" style="margin:0">${tr('settings.appearance.tint')}</label>
                    <input type="color"
                        value=${currentTint || '#1d9bf0'}
                        onInput=${e => {
                            const hex = e.target.value;
                            setCurrentTint(hex);
                            if (currentTheme === 'default') {
                                applyThemeFromEvent({ theme: 'default', tint: hex });
                            }
                        }} />
                    ${currentTint && html`
                        <button class="settings-tint-clear" onClick=${() => applyLocal('default', '')}
                            title=${tr('settings.appearance.clearTint')}>\u2715</button>
                    `}
                    <span class="settings-tint-hex">${currentTint || tr('settings.appearance.none')}</span>
                </div>
            </div>

            <div class="settings-output-pad-row">
                <label class="settings-output-pad-label" for="settings-output-pad">
                    <strong>${tr('settings.appearance.outputPadding')}</strong>
                    <span class="settings-hint">${tr('settings.appearance.outputPaddingHint')}</span>
                </label>
                <div class="settings-output-pad-control">
                    <input id="settings-output-pad" type="range" min="0" max="24" step="1"
                        value=${outputPad}
                        onInput=${e => {
                            const next = normalizeOutputPad(e.target.value);
                            setOutputPad(next);
                            applyOutputPad(next);
                        }} />
                    <input class="settings-output-pad-number" type="number" min="0" max="24" step="1"
                        value=${outputPad}
                        onInput=${e => {
                            const next = normalizeOutputPad(e.target.value);
                            setOutputPad(next);
                            applyOutputPad(next);
                        }} />
                    <span class="settings-hint">px</span>
                </div>
            </div>

            <div class="settings-row"><label for="appearance-mode">Automatic theme mode (this browser)</label><select id="appearance-mode" value=${mode} onChange=${e=>{setMode(e.target.value);setThemeModePreference(e.target.value);}}><option value="auto">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
            <p class="settings-hint">Applies to Default, Solarized and GitHub automatic pairs. Named Light/Dark variants keep their explicit mode.</p>
            <label class="settings-row"><input type="checkbox" checked=${glow} onChange=${e=>{setGlow(e.target.checked);setSynthwaveGlow(e.target.checked);}} /> SynthWave glow (this browser)</label>
            <p class="settings-hint">Static syntax/accent glow only; disabled in forced-colours mode.</p>
            <table class="settings-table settings-borderless settings-theme-table">
                <thead>
                    <tr>
                        <th></th><th>Theme</th><th>Mode</th>
                        ${keys.map(k => html`<th class="settings-swatch-header">${k.replace(/([A-Z])/g, ' $1').trim()}</th>`)}
                    </tr>
                </thead>
                <tbody>
                    ${presets.filter(t => t.name !== 'default').map(t => html`
                        <tr class=${t.name === currentTheme ? 'settings-row-active' : ''}
                            style="cursor:pointer" onClick=${() => applyLocal(t.name, '')}>
                            <td><input type="radio" aria-label=${t.label} name="settings-theme" checked=${t.name === currentTheme} onChange=${() => applyLocal(t.name, '')} /></td>
                            <td><strong>${t.label}</strong></td>
                            <td>${t.mode}</td>
                            ${keys.map(k => {
                                const c = t.colors?.[k];
                                return html`<td class="settings-swatch-cell">
                                    ${c ? html`<span class="settings-color-swatch" style=${'background:' + c} title=${c}></span>` : '\u2014'}
                                </td>`;
                            })}
                        </tr>
                    `)}
                </tbody>
            </table>
        </div>
    `;
}
