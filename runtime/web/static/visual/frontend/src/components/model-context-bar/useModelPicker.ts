import { useCallback } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { getMessageUrl, getChatJid } from "../../api/chat-jid";
import type { ModelEntry, ModelInfo } from "./types";
import { FALLBACK_MODELS, FALLBACK_THINKING_LEVELS } from "./types";
import { normaliseModelCatalogue } from "../../../../../../src/ui/model-catalogue";

export interface UseModelPickerResult {
  showPicker: ReturnType<typeof useSignal<boolean>>;
  showThinkingPicker: ReturnType<typeof useSignal<boolean>>;
  models: ReturnType<typeof useSignal<ModelEntry[]>>;
  thinkingLevels: ReturnType<typeof useSignal<string[]>>;
  handleBadgeClick: (e: Event, currentModelName: string, onThinkingLevel: (l: string) => void, onCurrentModel: (m: string) => void) => Promise<void>;
  handleSelectModel: (id: string, onCurrentModel: (m: string) => void) => Promise<void>;
  handleThinkingClick: (e: Event) => void;
  handleSelectThinking: (level: string) => Promise<void>;
}

const flashStatus = (message: string) => {
  window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message, type: "error" } }));
};

export function useModelPicker(): UseModelPickerResult {
  const showPicker = useSignal<boolean>(false);
  const showThinkingPicker = useSignal<boolean>(false);
  const models = useSignal<ModelEntry[]>([]);
  const thinkingLevels = useSignal<string[]>([]);

  const handleBadgeClick = useCallback(async (
    e: Event,
    currentModelName: string,
    onThinkingLevel: (l: string) => void,
    onCurrentModel: (m: string) => void,
  ) => {
    e.stopPropagation();
    if (showPicker.value) { showPicker.value = false; return; }
    showPicker.value = true;
    if (!models.value.length) models.value = FALLBACK_MODELS;
    try {
      const res = await fetch("/agent/models?chat_jid=" + encodeURIComponent(getChatJid()));
      if (res.ok) {
        const info = await res.json() as ModelInfo;
        const catalogue = normaliseModelCatalogue(info);
        models.value = catalogue.length
          ? catalogue.map((entry) => ({
            id: entry.key,
            name: entry.displayName === entry.key ? null : entry.displayName,
            context_window: entry.contextWindow,
            reasoning: entry.reasoning,
            pricing: entry.pricing ? {
              input_per_million: entry.pricing.inputPerMillion,
              output_per_million: entry.pricing.outputPerMillion,
              cache_read_per_million: entry.pricing.cacheReadPerMillion,
              cache_write_per_million: entry.pricing.cacheWritePerMillion,
            } : null,
          }))
          : FALLBACK_MODELS;
        onCurrentModel(info.current ?? currentModelName);
        if (info.thinking_level_label || info.thinking_level) {
          onThinkingLevel(info.thinking_level_label ?? info.thinking_level!);
        }
        thinkingLevels.value = info.available_thinking_level_labels?.length
          ? info.available_thinking_level_labels
          : (info.available_thinking_levels?.length ? info.available_thinking_levels : FALLBACK_THINKING_LEVELS);
      } else { flashStatus("Model fetch failed"); }
    } catch { flashStatus("Model fetch failed"); }
  }, []);

  const handleSelectModel = useCallback(async (id: string, onCurrentModel: (m: string) => void) => {
    try {
      const res = await fetch(getMessageUrl(), {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `/model ${id}` }),
      });
      if (!res.ok) { flashStatus("Model switch failed"); return; }
      const data = await res.json().catch(() => null);
      // If the command returned immediately (e.g. error), don't update
      if (data?.command === false || data?.error) {
        flashStatus(data?.error ?? "Model switch failed");
        return;
      }
      onCurrentModel(id);
      showPicker.value = false;
      // Re-fetch models after a brief delay to confirm backend accepted
      setTimeout(async () => {
        try {
          const r = await fetch("/agent/models?chat_jid=" + encodeURIComponent(getChatJid()));
          if (r.ok) {
            const info = await r.json() as ModelInfo;
            if (info.current) onCurrentModel(info.current);
          }
        } catch {}
      }, 1500);
    } catch { flashStatus("Model switch failed"); }
  }, []);

  const handleThinkingClick = useCallback((e: Event) => {
    e.stopPropagation();
    showThinkingPicker.value = !showThinkingPicker.value;
    showPicker.value = false;
  }, []);

  const handleSelectThinking = useCallback(async (level: string) => {
    try {
      const res = await fetch(getMessageUrl(), {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `/thinking ${level}` }),
      });
      if (res.ok) showThinkingPicker.value = false;
      else flashStatus("Thinking switch failed");
    } catch { flashStatus("Thinking switch failed"); }
  }, []);

  return { showPicker, showThinkingPicker, models, thinkingLevels, handleBadgeClick, handleSelectModel, handleThinkingClick, handleSelectThinking };
}
