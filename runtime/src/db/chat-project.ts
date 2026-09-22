import { getDb } from './connection.js';
import { normalizeProjectRepository } from '../core/project-repository.js';

type ProjectRow = { branch_id: string; chat_jid: string; root_chat_jid: string; parent_branch_id: string | null; project_repository: string | null };
export interface ChatProject { chat_jid: string; mode: 'inherit' | 'set' | 'disabled'; repository_url: string | null; source_chat_jid: string | null }

/** Missing rows inherit; the empty string explicitly disables inherited links. */
export function getChatProject(chatJid: string): ChatProject {
  const db = getDb();
  const query = `SELECT b.branch_id, b.chat_jid, b.root_chat_jid, b.parent_branch_id, p.repository_url AS project_repository
    FROM chat_branches b LEFT JOIN chat_projects p ON p.branch_id = b.branch_id`;
  const row = db.prepare(`${query} WHERE b.chat_jid = ?`).get(chatJid) as ProjectRow | undefined;
  const result: ChatProject = { chat_jid: chatJid, mode: row?.project_repository == null ? 'inherit' : row.project_repository ? 'set' : 'disabled', repository_url: null, source_chat_jid: null };
  const visited = new Set<string>();
  let current = row;
  while (current) {
    if (visited.has(current.branch_id) || current.root_chat_jid !== row!.root_chat_jid) return result;
    visited.add(current.branch_id);
    if (current.project_repository != null) {
      result.repository_url = current.project_repository || null;
      result.source_chat_jid = current.chat_jid;
      return result;
    }
    if (current.chat_jid === current.root_chat_jid) break;
    // Follow actual ancestry; never infer ownership or parents from JID text.
    if (!current.parent_branch_id) break;
    current = db.prepare(`${query} WHERE b.branch_id = ?`).get(current.parent_branch_id) as ProjectRow | undefined;
  }
  return result;
}

export function updateChatProject(chatJid: string, action: 'set' | 'clear' | 'inherit', repositoryUrl?: string): ChatProject {
  const value = action === 'set' ? normalizeProjectRepository(repositoryUrl) : action === 'clear' ? '' : null;
  const db = getDb();
  const branch = db.prepare('SELECT branch_id FROM chat_branches WHERE chat_jid = ?').get(chatJid) as { branch_id: string } | undefined;
  if (!branch) throw new Error('The current chat is not registered.');
  if (value == null) db.prepare('DELETE FROM chat_projects WHERE branch_id = ?').run(branch.branch_id);
  else db.prepare(`INSERT INTO chat_projects(branch_id, repository_url, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(branch_id) DO UPDATE SET repository_url=excluded.repository_url, updated_at=excluded.updated_at`)
    .run(branch.branch_id, value, new Date().toISOString());
  return getChatProject(chatJid);
}
