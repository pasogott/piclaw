/** Exact-reference note reads. No search, reranker, arbitrary path selector or exported content reader. */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { getChatJid } from '../core/chat-context.js';
import { getWorkspaceDir } from '../core/config-context.js';
import { admitNoteIndexMetadata, admitNoteIndexStore, NoteIndexDenied } from '../note-retrieval/access.js';
import { CHUNKER_VERSION } from '../note-retrieval/chunker.js';
import { NOTE_INDEX_FORMAT } from '../note-retrieval/schema.js';
import { admittedNotePath, readNote, NoteSourceExcluded, NoteSourceUnstable } from '../note-retrieval/files.js';
import { markNoteIndexDirty } from '../note-retrieval/coordinator.js';
import { requestBackgroundWorkspaceIndexRefresh } from '../workspace-search.js';

const schema = Type.Object({
  chunk_id: Type.String({ description: 'Exact nr1 chunk reference; never a path or heading.', pattern: '^nr1:[a-f0-9]{64}$' }),
  source_revision: Type.String({ description: 'Full-source SHA-256 supplied with the chunk reference.', pattern: '^[a-f0-9]{64}$' }),
}, { additionalProperties: false });
type Request = { chunk_id: string; source_revision: string };
type Status = 'ok' | 'access_denied' | 'invalid_request' | 'not_found' | 'source_stale' | 'index_unavailable' | 'source_unavailable' | 'limit_exceeded' | 'cancelled';
interface IndexState { namespace: string | null; binding: string | null; format: string | null; published: number | null; state: string; dirty: number; coverage: number; last_complete: number | null }
interface Chunk { chunk_id: string; revision: string; path: string; chunker: string; first_byte: number; after_last_byte: number; line_start: number; line_end: number; heading: string; kind: string; content: string }
class Cancelled extends Error {}
class Deadline extends Error {}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const answer = (status: Status, fields: Record<string, unknown> = {}) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ status, ...fields }) }], details: { status },
});

/** Factory captures the server's chat binding; only its registered execute closure
 * can reach the module-private content path. This is not an authentication API for
 * arbitrary extension code (extensions already share host process privileges). */
export function createMemorySearchExtension(chatJid?: string): ExtensionFactory {
  return function memorySearch(pi: ExtensionAPI) {
    let session: { manager: ExtensionContext['sessionManager']; id: string; cwd: string } | null = null;
    pi.on('session_start', async (_event, ctx) => {
      session = null;
      try {
        admitNoteIndexMetadata()();
        if (!chatJid || !ctx?.sessionManager || realpathSync(ctx.cwd) !== realpathSync(getWorkspaceDir())) return;
        const id = ctx.sessionManager.getSessionId();
        if (typeof id !== 'string' || !id) return;
        session = { manager: ctx.sessionManager, id, cwd: ctx.cwd };
      } catch { session = null; }
    });
    pi.on('session_shutdown', async () => { session = null; });
    pi.registerTool({
      name: 'memory_get', label: 'memory_get', parameters: schema,
      description: 'Read one exact revision-bound local note chunk in single-user mode. Requires chunk_id and source_revision from the current note index. Returns no content for stale, denied or unavailable references; never guesses another passage. Activate explicitly. This does not search or refresh synchronously.',
      promptSnippet: 'memory_get: verify and read one exact note chunk reference; no arbitrary paths or guessed replacements.',
      async execute(_callId, params, signal, _onUpdate, ctx) {
        const captured = session;
        let revoked = false;
        const checkSession = () => {
          try {
            admitNoteIndexMetadata()();
            if (revoked || !captured || session !== captured || !chatJid || getChatJid('') !== chatJid
              || !ctx || ctx.cwd !== captured.cwd || ctx.sessionManager !== captured.manager
              || ctx.sessionManager.getSessionId() !== captured.id || !pi.getActiveTools().includes('memory_get')
              || realpathSync(ctx.cwd) !== realpathSync(getWorkspaceDir())) throw new NoteIndexDenied();
          } catch { revoked = true; throw new NoteIndexDenied(); }
        };
        // Authorise before reading request selectors, opening index rows or paths.
        try { checkSession(); } catch { return answer('access_denied'); }
        let access: ReturnType<typeof admitNoteIndexStore>;
        try { access = admitNoteIndexStore(); } catch { return answer('access_denied'); }
        const started = performance.now();
        const check = () => {
          checkSession(); access.validate();
          if (signal?.aborted || ctx.signal?.aborted) throw new Cancelled();
          if (performance.now() - started >= 2000) throw new Deadline();
        };
        const finish = (status: Status, fields: Record<string, unknown> = {}) => { check(); return answer(status, fields); };
        const db = access.database;
        try {
          check();
          if (!params || typeof params !== 'object' || Object.keys(params).some(k => k !== 'chunk_id' && k !== 'source_revision')) return finish('invalid_request');
          const { chunk_id: id, source_revision: revision } = params as Request;
          if (typeof id !== 'string' || !/^nr1:[a-f0-9]{64}$/.test(id)
            || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) return finish('invalid_request');
          // Never validate against a caller-held stale read transaction.
          if (db.inTransaction) return finish('index_unavailable');
          if (!db.query("SELECT 1 FROM sqlite_master WHERE name='note_retrieval_state'").get()) return finish('index_unavailable');
          const state = () => db.query('SELECT namespace,binding,format,published,state,dirty,coverage,last_complete FROM note_retrieval_state WHERE id=1').get() as IndexState | null;
          const initial = state();
          const compatible = (s: IndexState | null): s is IndexState & { namespace: string; published: number } => Boolean(s
            && typeof s.namespace === 'string' && s.namespace.length > 0 && s.namespace.length <= 256
            && s.format === NOTE_INDEX_FORMAT && s.binding === JSON.stringify(access.binding)
            && positive(s.published as number) && ['ready','stale','limited','indexing'].includes(s.state));
          if (!compatible(initial)) return finish('index_unavailable');
          const select = db.query('SELECT chunk_id,revision,path,chunker,first_byte,after_last_byte,line_start,line_end,heading,kind,hex(CAST(content AS BLOB)) AS content FROM note_retrieval_chunks WHERE generation=? AND chunk_id=?');
          const row = select.get(initial.published, id) as Chunk | null;
          if (!row || row.revision !== revision) return finish('not_found');
          const fields = [row.first_byte,row.after_last_byte,row.line_start,row.line_end];
          if (typeof row.path !== 'string' || !admittedNotePath(row.path) || row.chunker !== CHUNKER_VERSION
            || !fields.every(n => Number.isSafeInteger(n) && n >= 0) || row.after_last_byte <= row.first_byte
            || row.after_last_byte - row.first_byte > 16 * 1024 || row.line_start < 1 || row.line_end < row.line_start
            || typeof row.heading !== 'string' || row.heading.length > 16 * 1024
            || !['section','paragraph','lines','fence'].includes(row.kind)
            || row.chunk_id !== `nr1:${hash(JSON.stringify([initial.namespace,row.path,row.revision,CHUNKER_VERSION,row.first_byte,row.after_last_byte]))}`) return finish('index_unavailable');
          const headings: unknown = JSON.parse(row.heading);
          if (!Array.isArray(headings) || !headings.every(s => typeof s === 'string')) return finish('index_unavailable');
          const dirty = () => Boolean(db.query("SELECT 1 FROM note_retrieval_dirty WHERE path=? OR path='*'").get(row.path));
          const stale = () => {
            check(); markNoteIndexDirty([row.path]); check();
            requestBackgroundWorkspaceIndexRefresh({ scope: 'notes' });
            return finish('source_stale');
          };
          if (dirty()) return stale();
          let source: Awaited<ReturnType<typeof readNote>>;
          try { source = await readNote(access.binding.workspace, row.path, check); }
          catch (error) {
            check();
            if (error instanceof NoteSourceExcluded || ['ENOENT','ENOTDIR','ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) return stale();
            if (error instanceof Cancelled || error instanceof Deadline || error instanceof NoteIndexDenied) throw error;
            return finish('source_unavailable');
          }
          check();
          if (source.revision !== row.revision) return stale();
          const bytes = source.bytes;
          if (row.after_last_byte > bytes.length || (row.first_byte > 0 && bytes[row.first_byte - 1] !== 10)
            || (row.after_last_byte < bytes.length && bytes[row.after_last_byte - 1] !== 10)) return finish('index_unavailable');
          let startLine = 1, endLine = 1;
          for (let i = 0; i < row.after_last_byte; i++) if (bytes[i] === 10) {
            if (i < row.first_byte) startLine++;
            if (i < row.after_last_byte - 1) endLine++;
          }
          if (row.line_start !== startLine || row.line_end !== endLine) return finish('index_unavailable');
          const slice = bytes.subarray(row.first_byte, row.after_last_byte);
          let text: string;
          try { text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(slice); }
          catch { return finish('index_unavailable'); }
          if (text.includes('\0') || typeof row.content !== 'string' || slice.toString('hex').toUpperCase() !== row.content) return finish('index_unavailable');
          // Build before final validation; no awaited I/O occurs afterwards.
          const result = answer('ok', { chunk_id: id, source_revision: revision, path: row.path,
            heading_path: headings, line_start: row.line_start, line_end: row.line_end,
            first_byte: row.first_byte, after_last_byte: row.after_last_byte,
            index_generation: initial.published, validated_at: new Date().toISOString(), text });
          if (Buffer.byteLength(JSON.stringify(result)) > 32 * 1024) return finish('limit_exceeded');
          check();
          try { source.verify(); } catch (error) {
            check();
            if (error instanceof NoteSourceUnstable || error instanceof NoteSourceExcluded
              || ['ENOENT','ENOTDIR','ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) return stale();
            throw error;
          }
          const current = state();
          if (!compatible(current) || current.namespace !== initial.namespace || current.published !== initial.published
            || current.dirty !== initial.dirty || current.coverage !== initial.coverage
            || current.last_complete !== initial.last_complete || current.state !== initial.state) {
            if (dirty()) return stale();
            return finish('index_unavailable');
          }
          if (dirty()) return stale();
          if (JSON.stringify(select.get(current.published,id)) !== JSON.stringify(row)) return finish('index_unavailable');
          check(); return result;
        } catch (error) {
          // Denials precede detailed error classes and never include selectors or paths.
          try { checkSession(); access.validate(); } catch { return answer('access_denied'); }
          if (signal?.aborted || ctx.signal?.aborted || error instanceof Cancelled) return answer('cancelled');
          if (error instanceof Deadline || performance.now() - started >= 2000) return answer('limit_exceeded');
          return answer('index_unavailable');
        }
      },
    });
  };
}
