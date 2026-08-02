/**
 * settings/sessions.ts — Session management settings section.
 */
import { html, useState, useEffect, useCallback, useMemo, useRef } from '../../vendor/preact-htm.js';
import { NumberStepper } from './number-stepper.js';
import { useTranslation } from '../../utils/i18n.js';

function normalizeSessionSettings(data: Record<string, any> = {}) {
    return {
        sessionAutoRotate: data.sessionAutoRotate !== false,
        sessionMaxSizeMb: data.sessionMaxSizeMb ?? 16,
        sessionMaxLines: data.sessionMaxLines ?? 4000,
        sessionMaxCompactions: data.sessionMaxCompactions ?? 3,
        sessionIsolation: data.sessionIsolation || 'none',
        toolUseBudget: data.toolUseBudget ?? 64,
    };
}

export function SessionsSection({ settingsData, setStatus, mergeSettingsData }) {
    const { t } = useTranslation();
    const [sessionAutoRotate, setSessionAutoRotate] = useState(true);
    const [sessionMaxSizeMb, setSessionMaxSizeMb] = useState(16);
    const [sessionMaxLines, setSessionMaxLines] = useState(4000);
    const [sessionMaxCompactions, setSessionMaxCompactions] = useState(3);
    const [toolUseBudget, setToolUseBudget] = useState(64);
    const [sessionIsolation, setSessionIsolation] = useState('none');
    const [appliedHint, setAppliedHint] = useState(false);
    const savedSnapshotRef = useRef('');
    const saveTimerRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const applyIncoming = useCallback((data) => {
        const next = normalizeSessionSettings(data);
        setSessionAutoRotate(next.sessionAutoRotate);
        setSessionMaxSizeMb(next.sessionMaxSizeMb);
        setSessionMaxLines(next.sessionMaxLines);
        setSessionMaxCompactions(next.sessionMaxCompactions);
        setToolUseBudget(next.toolUseBudget);
        setSessionIsolation(next.sessionIsolation);
        savedSnapshotRef.current = JSON.stringify(next);
    }, []);

    useEffect(() => {
        applyIncoming(settingsData || {});
    }, [settingsData, applyIncoming]);

    const currentSnapshot = useMemo(() => JSON.stringify(normalizeSessionSettings({
        sessionAutoRotate, sessionMaxSizeMb, sessionMaxLines, sessionMaxCompactions, toolUseBudget, sessionIsolation,
    })), [sessionAutoRotate, sessionMaxSizeMb, sessionMaxLines, sessionMaxCompactions, toolUseBudget, sessionIsolation]);

    useEffect(() => {
        if (currentSnapshot === savedSnapshotRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            if (!mountedRef.current) return;
            try {
                const response = await fetch('/agent/settings/general', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: currentSnapshot,
                });
                const payload = await response.json().catch(() => ({}));
                if (!mountedRef.current) return;
                if (!response.ok || !payload?.ok || !payload?.settings) {
                    throw new Error(payload?.error || `Failed to save session settings (${response.status})`);
                }
                savedSnapshotRef.current = currentSnapshot;
                mergeSettingsData?.(payload.settings);
                setStatus?.(null);
                setAppliedHint(true);
                setTimeout(() => { if (mountedRef.current) setAppliedHint(false); }, 4000);
            } catch (error) {
                console.warn('[settings/sessions] Failed to persist session settings.', error);
                if (mountedRef.current) setStatus?.(String(error?.message || error), 'error');
            }
        }, 800);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [currentSnapshot, mergeSettingsData, setStatus]);

    return html`
        <div class="settings-section">
            ${appliedHint && html`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${t('settings.appliedNotice')}
                </div>
            `}
            <h3>${t('settings.sessions.lifecycle')}</h3>
            <div class="settings-row">
                <label>${t('settings.sessions.autoRotate')}</label>
                <input type="checkbox" checked=${sessionAutoRotate} onChange=${e => setSessionAutoRotate(e.target.checked)} />
            </div>
            <div class="settings-row">
                <label>${t('settings.sessions.maxSize')}</label>
                <${NumberStepper}
                    label=${t('settings.sessions.maxSizeAria')}
                    value=${sessionMaxSizeMb}
                    min=${1}
                    max=${256}
                    fallback=${32}
                    width="80px"
                    onChange=${setSessionMaxSizeMb}
                />
            </div>

            <h3 style="margin-top:20px">${t('settings.sessions.agentBehaviour')}</h3>
            <div class="settings-row">
                <label>${t('settings.sessions.toolBudget')}</label>
                <${NumberStepper}
                    label=${t('settings.sessions.toolBudgetAria')}
                    value=${toolUseBudget}
                    min=${8}
                    max=${512}
                    fallback=${64}
                    width="80px"
                    onChange=${setToolUseBudget}
                />
                <span class="settings-hint" style="margin:0">${t('settings.sessions.toolBudgetHint')}</span>
            </div>
            <div class="settings-row">
                <label>${t('settings.sessions.isolation')}</label>
                <select value=${sessionIsolation} onChange=${e => setSessionIsolation(e.target.value)}>
                    <option value="none">${t('settings.sessions.isolationNone')}</option>
                    <option value="summary">${t('settings.sessions.isolationSummary')}</option>
                    <option value="full">${t('settings.sessions.isolationFull')}</option>
                </select>
            </div>
        </div>
    `;
}
