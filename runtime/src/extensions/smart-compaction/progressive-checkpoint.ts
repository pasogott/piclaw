import { createHash } from "node:crypto";

import { getExtensionKvStore } from "../../extension-kv-registry.js";
import type { ProgressiveCompactionBudget, ProgressiveCompactionChunk } from "./progressive-policy.js";

const EXTENSION_ID = "piclaw.smart-compaction.progressive";
const MANIFEST_KEY = "checkpoint-manifest";
const CHUNK_KEY_PREFIX = "checkpoint-chunk:";
const CHECKPOINT_VERSION = 1;
const CHECKPOINT_POLICY = "atomic-groups-v1:chunk-schema-v1";

export interface ProgressiveCheckpointManifest {
  version: number;
  fingerprint: string;
  completedChunkCount: number;
  chunkCount: number;
  updatedAt: string;
}

export interface ProgressiveCheckpointStore {
  load(fingerprint: string, chunks: ProgressiveCompactionChunk[]): string[];
  save(fingerprint: string, chunks: ProgressiveCompactionChunk[], summaries: string[]): void;
  clear(): void;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function chunkIdentity(chunk: ProgressiveCompactionChunk): Record<string, unknown> {
  return {
    groupIds: chunk.groupIds ?? [],
    sourceIndexes: chunk.sourceIndexes ?? [],
    sourceEntryIds: chunk.sourceEntryIds ?? [],
    textHash: hash(chunk.text),
  };
}

export function buildProgressiveCheckpointFingerprint(input: {
  chunks: ProgressiveCompactionChunk[];
  model: { provider?: unknown; id?: unknown; api?: unknown; baseUrl?: unknown } | null | undefined;
  budget: ProgressiveCompactionBudget;
  reserveTokens: number;
  customInstructions?: string;
}): string {
  return hash(JSON.stringify({
    version: CHECKPOINT_VERSION,
    chunks: input.chunks.map(chunkIdentity),
    policy: CHECKPOINT_POLICY,
    model: {
      provider: String(input.model?.provider ?? ""),
      id: String(input.model?.id ?? ""),
      api: String(input.model?.api ?? ""),
      baseUrl: String(input.model?.baseUrl ?? ""),
      reasoning: Boolean((input.model as { reasoning?: unknown } | null | undefined)?.reasoning),
      thinkingLevelMap: (input.model as { thinkingLevelMap?: unknown } | null | undefined)?.thinkingLevelMap ?? null,
    },
    budget: input.budget,
    reserveTokens: input.reserveTokens,
    customInstructions: input.customInstructions?.trim() ?? "",
  }));
}

export function createProgressiveCheckpointStore(chatJid: string): ProgressiveCheckpointStore {
  const kv = getExtensionKvStore();
  const chunkKey = (index: number) => `${CHUNK_KEY_PREFIX}${String(index).padStart(6, "0")}`;
  const clear = () => {
    for (const key of kv.list(EXTENSION_ID, CHUNK_KEY_PREFIX, "chat", chatJid)) {
      kv.delete(EXTENSION_ID, key, "chat", chatJid);
    }
    kv.delete(EXTENSION_ID, MANIFEST_KEY, "chat", chatJid);
  };
  return {
    load(fingerprint, chunks) {
      const manifest = kv.get<ProgressiveCheckpointManifest>(EXTENSION_ID, MANIFEST_KEY, "chat", chatJid);
      if (!manifest || manifest.version !== CHECKPOINT_VERSION || manifest.fingerprint !== fingerprint || manifest.chunkCount !== chunks.length) {
        if (manifest) clear();
        return [];
      }
      const summaries: string[] = [];
      for (let index = 0; index < manifest.completedChunkCount; index += 1) {
        const value = kv.get<{ fingerprint: string; chunkHash: string; summary: string }>(EXTENSION_ID, chunkKey(index), "chat", chatJid);
        if (!value || value.fingerprint !== fingerprint || value.chunkHash !== hash(chunks[index]?.text ?? "") || !value.summary.trim()) {
          clear();
          return [];
        }
        summaries.push(value.summary);
      }
      return summaries;
    },
    save(fingerprint, chunks, summaries) {
      summaries.forEach((summary, index) => {
        kv.set(EXTENSION_ID, chunkKey(index), {
          fingerprint,
          chunkHash: hash(chunks[index]?.text ?? ""),
          summary,
        }, "chat", chatJid);
      });
      kv.set(EXTENSION_ID, MANIFEST_KEY, {
        version: CHECKPOINT_VERSION,
        fingerprint,
        completedChunkCount: summaries.length,
        chunkCount: chunks.length,
        updatedAt: new Date().toISOString(),
      } satisfies ProgressiveCheckpointManifest, "chat", chatJid);
      for (const key of kv.list(EXTENSION_ID, CHUNK_KEY_PREFIX, "chat", chatJid)) {
        const index = Number(key.slice(CHUNK_KEY_PREFIX.length));
        if (Number.isInteger(index) && index >= summaries.length) kv.delete(EXTENSION_ID, key, "chat", chatJid);
      }
    },
    clear,
  };
}
