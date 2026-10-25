import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "preact/hooks";
import { renderThinkingMarkdown } from "../../utils/markdown-pipeline";
import { getChatJid } from "../../api/chat-jid";
import { copyToClipboard } from "../../utils/clipboard";
// UI-local facade re-exports the shared scroll-anchor implementation.
import { attachHeaderAnchor, type HeaderAnchor } from "../../utils/scroll-anchor";

interface ThinkingVisibilityPillProps {
  messageId: number;
  /** Optional explicit chat scope. If omitted, falls back to getChatJid()
   *  because the visual UI's Interaction shape does not include chat_jid. */
  chatJid?: string;
  lines: number;
  durationMs: number;
}

/** Format duration: <1s -> "120ms", >=1s -> "3s", >=60s -> "1m 12s" */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * Collapsible pill that shows persisted model reasoning traces.
 * Lazy-loads content from /agent/thinking on first expand.
 * Mirrors the classic UI's ThinkingVisibilityPill behaviour.
 */
export function ThinkingVisibilityPill({ messageId, chatJid, lines, durationMs }: ThinkingVisibilityPillProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [fetchedDuration, setFetchedDuration] = useState<number | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HeaderAnchor | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Keep the header visually fixed while the panel expands/collapses. No-op in
  // browsers with native scroll anchoring (Chrome/Edge/Firefox); active only in
  // WebKit (incl. all iOS/iPadOS browsers), which lacks `overflow-anchor`. The
  // panel is always mounted (see render) so the ResizeObserver inside the anchor
  // sees both expand and collapse. useLayoutEffect so the anchor is wired before
  // any user toggle can occur.
  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest(".message-list") as HTMLElement | null;
    if (!scroller) return;
    const anchor = attachHeaderAnchor(scroller, panelRef.current);
    anchorRef.current = anchor;
    return () => {
      anchor.dispose();
      anchorRef.current = null;
    };
  }, []);

  // Cancel any in-flight thinking fetch when the pill unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const toggle = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    // Snapshot the scroll state before the height change (Safari only). Must run
    // before setExpanded.
    anchorRef.current?.mark();
    setExpanded(v => {
      const next = !v;
      if (next && !text && !loading && !error) {
        setLoading(true);
        // Fall back to the active chat scope if the caller didn't pass one
        // explicitly. Required after R2 endpoint validation tightening.
        const effectiveChatJid = chatJid || getChatJid();
        const url = `/agent/thinking?message_id=${encodeURIComponent(messageId)}&chat_jid=${encodeURIComponent(effectiveChatJid)}`;
        const controller = new AbortController();
        abortRef.current = controller;
        fetch(url, { signal: controller.signal })
          .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .then((d: { text?: string; duration_ms?: number }) => {
            if (d?.text) setText(d.text);
            else setError(true);
            if (d?.duration_ms) setFetchedDuration(d.duration_ms);
          })
          .catch(err => {
            if ((err as { name?: string })?.name === "AbortError") return;
            console.warn("[visual] Failed to load thinking content:", err);
            setError(true);
          })
          .finally(() => setLoading(false));
      }
      return next;
    });
  }, [text, loading, error, messageId, chatJid]);

  const handleCopy = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    const ok = await copyToClipboard(text);
    window.dispatchEvent(
      new CustomEvent("piclaw:status-flash", {
        detail: ok
          ? { message: "Copied to clipboard", type: "success" }
          : { message: "Copy failed", type: "error" },
      })
    );
  }, [text]);

  // Inject (or clear) the rendered reasoning markdown. Runs as a layout effect so
  // the content height is settled before paint. The panel is always mounted, so
  // we clear it on collapse to let the CSS collapse it to zero height.
  useLayoutEffect(() => {
    if (!detailRef.current) return;
    if (expanded && text) {
      try {
        detailRef.current.innerHTML = renderThinkingMarkdown(text);
      } catch {
        detailRef.current.textContent = text;
      }
    } else {
      detailRef.current.innerHTML = "";
    }
  }, [text, expanded]);

  // Apply the compensation synchronously after each toggle re-render (before
  // paint), covering the synchronous (cached-content) expand in addition to the
  // ResizeObserver. Defined AFTER the markdown-injection effect so the panel has
  // its final height first. No-op except in Safari.
  useLayoutEffect(() => {
    anchorRef.current?.compensate();
  }, [expanded, loading, text]);

  const durationFromApi = fetchedDuration || 0;
  const ms = durationFromApi || durationMs || 0;
  const label = ms > 0 ? `Thought for ${formatDuration(ms)}` : `Thinking \u00b7 ${lines} line${lines !== 1 ? "s" : ""}`;
  // Stable detail id so the disclosure button can declare aria-controls.
  const detailId = `thinking-visibility-pill__detail-${messageId}`;

  return (
    <div className="thinking-visibility-pill" data-expanded={expanded ? "true" : "false"} ref={rootRef}>
      <div className="thinking-visibility-pill__controls">
        <button
          type="button"
          className="thinking-visibility-pill__header"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={`${expanded ? "Collapse" : "Expand"} reasoning trace, ${label}`}
        >
          <span className="thinking-visibility-pill__toggle" aria-hidden="true">
            {expanded ? "\u25be" : "\u25b8"}
          </span>
          <span className="thinking-visibility-pill__label">{label}</span>
        </button>
        {expanded && text && (
          <button
            type="button"
            className="message-action-bar__btn thinking-visibility-pill__copy"
            onClick={handleCopy}
            title="Copy reasoning trace"
            aria-label="Copy reasoning trace"
          >
            <i className="codicon codicon-copy" />
          </button>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {expanded ? (loading ? "Loading reasoning trace" : error ? "Could not load reasoning trace" : text ? "Reasoning trace loaded" : "") : ""}
      </span>
      <div
        id={detailId}
        className="thinking-visibility-pill__detail"
        ref={panelRef}
      >
        {expanded && loading && (
          <span className="thinking-visibility-pill__loading">Loading reasoning trace…</span>
        )}
        {expanded && error && (
          <span className="thinking-visibility-pill__error">Could not load reasoning trace.</span>
        )}
        <div ref={detailRef} className="thinking-visibility-pill__content" />
      </div>
    </div>
  );
}
