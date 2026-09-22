/** Chat-keyed rendering metadata, populated by the existing shared UI snapshot. */
const repositories = new Map<string, string | null>();
const subscribers = new Map<string, Set<() => void>>();
export function getChatProjectRepository(chatJid: string): string | null { return repositories.get(chatJid) ?? null; }
export function setChatProjectRepository(chatJid: string, repository: string | null): void {
  if (getChatProjectRepository(chatJid) === repository) return;
  repositories.set(chatJid, repository);
  for (const listener of subscribers.get(chatJid) ?? []) listener();
}
export function subscribeChatProject(chatJid: string, listener: () => void): () => void {
  const listeners = subscribers.get(chatJid) ?? new Set();
  listeners.add(listener); subscribers.set(chatJid, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) subscribers.delete(chatJid); };
}
