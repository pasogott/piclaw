import { useEffect, useState } from '../vendor/preact-htm.js';
import { getChatProjectRepository, subscribeChatProject } from './chat-project-state.js';
import { currentUiChatJid } from './agent-ui-snapshot.js';

export function useChatProjectRepository(chatJid = currentUiChatJid()): string | null {
  const [, update] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeChatProject(chatJid, () => update(value => value + 1));
    // The snapshot can complete between render and subscription.
    update(value => value + 1);
    return unsubscribe;
  }, [chatJid]);
  return getChatProjectRepository(chatJid);
}
