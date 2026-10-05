import { html, useEffect, useMemo, useRef } from '../vendor/preact-htm.js';

export const INTEL_GPU_STALE_AFTER_MS = 6000;
export const INTEL_GPU_MISSING_VALUE = '—';

function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function toNonNegativeCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function clampPercent(value) {
    const number = toFiniteNumber(value);
    return number === null || number < 0 || number > 100 ? null : number;
}

function formatCompactBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return INTEL_GPU_MISSING_VALUE;
    if (bytes === 0) return '0B';
    const units = ['B', 'K', 'M', 'G', 'T'];
    let unitIndex = 0;
    let scaled = bytes;
    while (scaled >= 1024 && unitIndex < units.length - 1) {
        scaled /= 1024;
        unitIndex += 1;
    }
    const digits = scaled >= 100 || unitIndex === 0 ? 0 : scaled >= 10 ? 0 : 1;
    return `${scaled.toFixed(digits)}${units[unitIndex]}`;
}

export function formatOptionalPercent(value) {
    const number = clampPercent(value);
    return number === null ? INTEL_GPU_MISSING_VALUE : `${Math.round(number)}%`;
}

export function formatOptionalBytesCompact(value) {
    const number = toFiniteNumber(value);
    return number === null || number < 0 ? INTEL_GPU_MISSING_VALUE : formatCompactBytes(number);
}

export function formatBytesExplicit(value) {
    const bytes = toFiniteNumber(value);
    if (bytes === null || bytes < 0) return INTEL_GPU_MISSING_VALUE;
    if (bytes === 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let unitIndex = 0;
    let scaled = bytes;
    while (scaled >= 1024 && unitIndex < units.length - 1) {
        scaled /= 1024;
        unitIndex += 1;
    }
    const digits = scaled >= 100 || unitIndex === 0 ? 0 : scaled >= 10 ? 1 : 2;
    return `${scaled.toFixed(digits)} ${units[unitIndex]}`;
}

export function sanitizeNullableSeries(input, maxPoints = 30) {
    const series = Array.isArray(input)
        ? input.map((value) => {
            if (value === null || value === undefined || value === '') return null;
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        })
        : [];
    return series.length > maxPoints ? series.slice(series.length - maxPoints) : series;
}

export function buildNullableSparklinePath(series, width = 56, height = 16, options = {}) {
    const points = sanitizeNullableSeries(series);
    const finitePoints = points.filter((value) => Number.isFinite(value));
    if (finitePoints.length === 0) return '';

    const minValue = Number.isFinite(options.min) ? Number(options.min) : Math.min(...finitePoints);
    const maxValue = Number.isFinite(options.max) ? Number(options.max) : Math.max(...finitePoints);
    const singleValueY = (height / 2).toFixed(2);
    const path = [];

    let previousIndex = -2;
    let segmentCount = 0;
    for (let index = 0; index < points.length; index += 1) {
        const value = points[index];
        if (!Number.isFinite(value)) {
            previousIndex = -2;
            continue;
        }
        const x = points.length === 1 ? width / 2 : (index / (points.length - 1 || 1)) * width;
        const normalized = maxValue > minValue
            ? (value - minValue) / (maxValue - minValue)
            : null;
        const y = normalized === null
            ? singleValueY
            : (height - normalized * height).toFixed(2);
        const isContinuation = previousIndex === index - 1;
        path.push(`${isContinuation ? 'L' : 'M'} ${x.toFixed(2)} ${y}`);
        if (!isContinuation) {
            segmentCount += 1;
            path.push(`L ${x.toFixed(2)} ${y}`);
        }
        previousIndex = index;
    }

    return segmentCount > 0 ? path.join(' ') : '';
}

function normalizeEngineClassName(name) {
    const raw = String(name || '').trim();
    const lower = raw.toLowerCase();
    if (!raw) return 'Unknown';
    if (lower === 'render' || /^rcs\d*$/.test(lower)) return 'Render';
    if (lower === 'compute' || /^ccs\d*$/.test(lower)) return 'Compute';
    if (lower === 'copy' || lower === 'blitter' || /^bcs\d*$/.test(lower)) return 'Blitter';
    if (lower === 'video' || /^vcs\d*$/.test(lower)) return 'Video';
    if (lower === 'video-enhance' || lower === 'video enhance' || /^vecs\d*$/.test(lower)) return 'Video Enhance';
    if (lower === 'gsc' || /^gsc\d*$/.test(lower)) return 'GSC';
    return raw;
}

function humanizeStatus(status) {
    const normalized = ['ok', 'partial', 'unavailable', 'stale'].includes(String(status))
        ? String(status)
        : 'unavailable';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatAgeLabel(ageMs) {
    if (ageMs === null || !Number.isFinite(ageMs) || ageMs < 0) return 'Unknown';
    if (ageMs < 1000) return '<1s old';
    if (ageMs < 60_000) return `${(ageMs / 1000).toFixed(ageMs >= 10_000 ? 0 : 1)}s old`;
    if (ageMs < 3_600_000) return `${(ageMs / 60_000).toFixed(ageMs >= 600_000 ? 0 : 1)}m old`;
    return `${(ageMs / 3_600_000).toFixed(ageMs >= 36_000_000 ? 0 : 1)}h old`;
}

function normalizeReasons(input) {
    return Array.isArray(input)
        ? input
            .map((reason) => String(reason || '').trim())
            .filter(Boolean)
            .slice(0, 8)
        : [];
}

function statusToneClass(status) {
    return ['ok', 'partial', 'stale', 'unavailable'].includes(String(status))
        ? `is-${status}`
        : 'is-unavailable';
}

export function normalizeIntelGpuSnapshots(input, options = {}) {
    const snapshots = Array.isArray(input)
        ? input.filter(s => s?.provider === 'intel-drm-fdinfo' && s?.driver === 'i915').slice(0, 8)
        : [];
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const lastSuccessAtMs = Number.isFinite(Number(options.lastSuccessAtMs)) ? Number(options.lastSuccessAtMs) : null;
    const transportStale = lastSuccessAtMs !== null && nowMs - lastSuccessAtMs > INTEL_GPU_STALE_AFTER_MS;

    return snapshots.map((snapshot, index) => {
        const id = String(snapshot?.id || `intel-gpu-${index}`);
        const name = String(snapshot?.name || `Intel GPU ${index}`).trim() || `Intel GPU ${index}`;
        const rawStatus = ['ok', 'partial', 'unavailable', 'stale'].includes(String(snapshot?.status))
            ? String(snapshot?.status)
            : 'unavailable';
        const reasons = normalizeReasons(snapshot?.reasons);
        const sampleTimeMs = toFiniteNumber(snapshot?.sample_time_ms);
        const sampleAgeMs = sampleTimeMs === null ? null : Math.max(0, nowMs - sampleTimeMs);

        const stale = transportStale || rawStatus === 'stale' || (sampleAgeMs !== null && sampleAgeMs > INTEL_GPU_STALE_AFTER_MS);
        const unavailable = stale || rawStatus === 'unavailable';
        const engines = Array.isArray(snapshot?.engines)
            ? snapshot.engines.slice(0, 16).map((engine, engineIndex) => ({
                name: String(engine?.name || `engine-${engineIndex}`).trim() || `engine-${engineIndex}`,
                label: normalizeEngineClassName(engine?.name),
                capacity: toFiniteNumber(engine?.capacity),
                busyPercent: unavailable ? null : clampPercent(engine?.busy_percent),
            }))
            : [];

        let busiestEngine = null;
        for (const engine of engines) {
            if (engine.busyPercent === null) continue;
            if (!busiestEngine || engine.busyPercent > busiestEngine.busyPercent) busiestEngine = engine;
        }

        const history = Array.isArray(snapshot?.history) ? snapshot.history.slice(-30) : [];
        const busySeries = history.map((entry) => clampPercent(entry?.busy_percent));
        const residentSeries = history.map((entry) => {
            const residentBytes = toFiniteNumber(entry?.resident_bytes);
            return residentBytes === null || residentBytes < 0 ? null : residentBytes;
        });

        const busyPercent = unavailable ? null : clampPercent(snapshot?.busy_percent);
        const residentBytes = (() => {
            const number = unavailable ? null : toFiniteNumber(snapshot?.memory?.resident_bytes);
            return number === null || number < 0 ? null : number;
        })();
        const totalBytes = (() => {
            const number = toFiniteNumber(snapshot?.memory?.total_bytes);
            return number === null || number < 0 ? null : number;
        })();
        const sharedBytes = (() => {
            const number = toFiniteNumber(snapshot?.memory?.shared_bytes);
            return number === null || number < 0 ? null : number;
        })();

        const coverage = {
            scope: String(snapshot?.coverage?.scope || 'observed-clients'),
            clients: toNonNegativeCount(snapshot?.coverage?.clients),
            scannedProcesses: toNonNegativeCount(snapshot?.coverage?.scanned_processes),
            unreadableProcesses: toNonNegativeCount(snapshot?.coverage?.unreadable_processes),
            unreadableClients: toNonNegativeCount(snapshot?.coverage?.unreadable_clients),
            truncated: Boolean(snapshot?.coverage?.truncated),
        };

        const effectiveStatus = stale ? 'stale' : rawStatus;
        const effectiveReasons = stale
            ? [...reasons, 'UI refresh overdue.']
            : reasons;
        const busiestEngineLabel = busiestEngine?.label || null;
        const coverageText = [
            `Observed clients: ${coverage.clients}`,
            `scanned processes: ${coverage.scannedProcesses}`,
            `unreadable processes: ${coverage.unreadableProcesses}`,
            `unreadable clients: ${coverage.unreadableClients}`,
            coverage.truncated ? 'scan truncated; best-effort visibility' : 'best-effort process visibility',
        ].join(' • ');

        return {
            id,
            name,
            provider: String(snapshot?.provider || ''),
            driver: String(snapshot?.driver || ''),
            sampleTimeMs,
            sampleAgeMs,
            sampleAgeText: formatAgeLabel(sampleAgeMs),
            status: rawStatus,
            effectiveStatus,
            statusToneClass: statusToneClass(effectiveStatus),
            statusText: humanizeStatus(effectiveStatus),
            reasons,
            effectiveReasons,
            busiestEngineLabel,
            noVisibleClientsText: coverage.clients === 0 ? 'No visible clients (unavailable).' : '',
            memoryWarningText: 'Client-reported GPU-backed resident sum may double count shared buffers, overlaps system RAM, and is not a VRAM% figure.',
            coverageText,
            engines,
            coverage,
            rows: {
                gpuLabel: snapshots.length === 1 ? 'GPU*' : `GPU${index}*`,
                gmemLabel: snapshots.length === 1 ? 'GMEM*' : `GMEM${index}*`,
                busyPercent,
                busyText: formatOptionalPercent(busyPercent),
                busySparkPath: unavailable ? '' : buildNullableSparklinePath(busySeries, 56, 16, { min: 0, max: 100 }),
                busyTitle: busiestEngineLabel
                    ? `${name} — busiest observed engine: ${busiestEngineLabel}`
                    : `${name} — engine activity unavailable`,
                engineNote: 'GPU engine activity covers all APIs, not Vulkan alone.',
                residentBytes,
                residentText: formatOptionalBytesCompact(residentBytes),
                residentSparkPath: unavailable ? '' : buildNullableSparklinePath(residentSeries, 56, 16),
                memoryTitle: `${name} — client-reported GPU-backed resident sum`,
            },
            memory: {
                residentBytes,
                residentText: formatBytesExplicit(residentBytes),
                totalBytes,
                totalText: formatBytesExplicit(totalBytes),
                sharedBytes,
                sharedText: formatBytesExplicit(sharedBytes),
            },
        };
    });
}

export function buildIntelGpuCompactSummaryParts(meters) {
    return Array.isArray(meters)
        ? meters.flatMap((meter) => [
            `${meter.rows.gpuLabel} ${meter.rows.busyText}`,
            `${meter.rows.gmemLabel} ${meter.rows.residentText}`,
        ])
        : [];
}

function renderDetailsSection(label, value) {
    return html`
        <div class="system-meters-gpu-detail-key">${label}</div>
        <div class="system-meters-gpu-detail-value">${value}</div>
    `;
}

export function IntelGpuMeterRows({ meters = [], onOpen = () => {} }) {
    return html`
        ${meters.map((meter) => html`
            <div key=${`${meter.id}-busy`} class=${`system-meters-row intel-gpu ${meter.statusToneClass}`} title=${`${meter.rows.busyTitle} — tap for details`} onClick=${(event) => { event.stopPropagation(); onOpen(meter.id); }}>
                <span class="system-meters-label">${meter.rows.gpuLabel}</span>
                <svg class="system-meters-spark" viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true">
                    <path d=${meter.rows.busySparkPath}></path>
                </svg>
                <span class="system-meters-value">${meter.rows.busyText}</span>
            </div>
            <div key=${`${meter.id}-memory`} class=${`system-meters-row intel-gmem ${meter.statusToneClass}`} title=${`${meter.rows.memoryTitle} — tap for details`} onClick=${(event) => { event.stopPropagation(); onOpen(meter.id); }}>
                <span class="system-meters-label">${meter.rows.gmemLabel}</span>
                <svg class="system-meters-spark" viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true">
                    <path d=${meter.rows.residentSparkPath}></path>
                </svg>
                <span class="system-meters-value">${meter.rows.residentText}</span>
            </div>
        `)}
    `;
}

export function IntelGpuDetailsControls({ meters = [], openGpuId = null, onOpen = () => {} }) {
    const setOpenGpuId = onOpen;
    const panelRef = useRef(null);
    const triggerRefs = useRef(new Map());

    const activeMeter = useMemo(
        () => meters.find((meter) => meter.id === openGpuId) || null,
        [meters, openGpuId],
    );

    useEffect(() => {
        if (openGpuId && !meters.some((meter) => meter.id === openGpuId)) {
            setOpenGpuId(null);
        }
    }, [meters, openGpuId]);

    useEffect(() => {
        if (!activeMeter) return undefined;

        const closePanel = (focusId = activeMeter.id) => {
            setOpenGpuId(null);
            const trigger = triggerRefs.current.get(focusId);
            if (trigger && typeof trigger.focus === 'function') {
                queueMicrotask(() => trigger.focus());
            }
        };

        const onKeyDown = (event) => {
            if (event?.key !== 'Escape') return;
            event.preventDefault();
            closePanel();
        };

        const onPointerDown = (event) => {
            const target = event?.target;
            if (!(target instanceof Node)) return;
            if (panelRef.current?.contains(target)) return;
            const trigger = triggerRefs.current.get(activeMeter.id);
            if (trigger?.contains?.(target)) return;
            closePanel(activeMeter.id);
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('touchstart', onPointerDown, true);

        if (panelRef.current && typeof panelRef.current.focus === 'function') {
            queueMicrotask(() => panelRef.current?.focus?.());
        }

        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('mousedown', onPointerDown, true);
            document.removeEventListener('touchstart', onPointerDown, true);
        };
    }, [activeMeter?.id]);

    if (!meters.length) return null;

    return html`
        <div class="system-meters-gpu-controls" data-testid="intel-gpu-controls">
            <div class="system-meters-gpu-trigger-strip" role="group" aria-label="Intel GPU details">
                ${meters.map((meter) => {
                    const isOpen = meter.id === openGpuId;
                    const dialogId = `intel-gpu-details-${meter.id.replace(/[^a-z0-9_-]+/gi, '-')}`;
                    return html`
                        <button
                            key=${meter.id}
                            ref=${(node) => {
                                if (node) triggerRefs.current.set(meter.id, node);
                                else triggerRefs.current.delete(meter.id);
                            }}
                            class=${`system-meters-gpu-trigger ${meter.statusToneClass}${isOpen ? ' is-open' : ''}`}
                            type="button"
                            title=${`${meter.name} details`}
                            aria-haspopup="dialog"
                            aria-expanded=${isOpen ? 'true' : 'false'}
                            aria-controls=${dialogId}
                            onClick=${() => setOpenGpuId(isOpen ? null : meter.id)}
                        >
                            ${meter.rows.gpuLabel} details
                        </button>
                    `;
                })}
            </div>
            ${activeMeter && html`
                <div
                    ref=${panelRef}
                    id=${`intel-gpu-details-${activeMeter.id.replace(/[^a-z0-9_-]+/gi, '-')}`}
                    class=${`system-meters-gpu-popover ${activeMeter.statusToneClass}`}
                    role="dialog"
                    aria-modal="false"
                    aria-label=${`${activeMeter.name} details`}
                    tabIndex="-1"
                    data-testid="intel-gpu-popover"
                >
                    <div class="system-meters-gpu-popover-header">
                        <div class="system-meters-gpu-popover-heading">
                            <div class="system-meters-gpu-popover-title">${activeMeter.name}</div>
                            <div class="system-meters-gpu-popover-subtitle">
                                ${activeMeter.rows.gpuLabel} / ${activeMeter.rows.gmemLabel}
                                ${activeMeter.busiestEngineLabel ? `• busiest ${activeMeter.busiestEngineLabel}` : ''}
                            </div>
                        </div>
                        <button class="system-meters-gpu-popover-close" type="button" onClick=${() => setOpenGpuId(null)}>
                            Close
                        </button>
                    </div>

                    <div class="system-meters-gpu-detail-grid">
                        ${renderDetailsSection('Status', activeMeter.statusText)}
                        ${renderDetailsSection('Sample age', activeMeter.sampleAgeText)}
                        ${renderDetailsSection('Resident', activeMeter.memory.residentText)}
                        ${renderDetailsSection('Shared', activeMeter.memory.sharedText)}
                        ${renderDetailsSection('Total', activeMeter.memory.totalText)}
                        ${renderDetailsSection('Coverage', activeMeter.coverageText)}
                    </div>

                    <div class="system-meters-gpu-detail-section">
                        <div class="system-meters-gpu-section-title">Engines</div>
                        <ul class="system-meters-gpu-engine-list">
                            ${activeMeter.engines.length
                                ? activeMeter.engines.map((engine) => html`
                                    <li key=${`${activeMeter.id}-${engine.name}`}>
                                        <span>${engine.label}${engine.capacity > 1 ? ` (${engine.capacity} engines)` : ''}</span>
                                        <span>${formatOptionalPercent(engine.busyPercent)}</span>
                                    </li>
                                `)
                                : html`<li><span>No engine counters reported.</span><span>${INTEL_GPU_MISSING_VALUE}</span></li>`}
                        </ul>
                    </div>

                    <div class="system-meters-gpu-detail-section">
                        <div class="system-meters-gpu-section-title">Notes</div>
                        <p class="system-meters-gpu-note">${activeMeter.rows.engineNote}</p>
                        <p class="system-meters-gpu-note">${activeMeter.memoryWarningText}</p>
                        ${activeMeter.noVisibleClientsText && html`<p class="system-meters-gpu-note">${activeMeter.noVisibleClientsText}</p>`}
                        ${activeMeter.effectiveReasons.length > 0 && html`
                            <ul class="system-meters-gpu-notes-list">
                                ${activeMeter.effectiveReasons.map((reason, index) => html`<li key=${`${activeMeter.id}-reason-${index}`}>${reason}</li>`)}
                            </ul>
                        `}
                    </div>
                </div>
            `}
        </div>
    `;
}
