import type { Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

export function isSqliteContention(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  try {
    // Do not execute getters on a thrown value while classifying it.
    const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    const errno = Object.getOwnPropertyDescriptor(error, 'errno')?.value;
    return (typeof code === 'string' && /^SQLITE_(?:BUSY|LOCKED)(?:_[A-Z]+)*$/.test(code))
      || [code, errno].some(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        && ((value & 0xff) === 5 || (value & 0xff) === 6));
  } catch { return false; }
}

/** Retry writer acquisition only; never replay an entered transaction callback.
 * Keep operations/authorization synchronous and SQL-only. Restore connection
 * policy before yielding and run rollback cleanup before returning any failure. */
export async function admitSqliteWrite<T>(
  database: Database,
  operation: () => T,
  authorise: (phase: 'before' | 'after') => void = () => {},
  signal: AbortSignal = new AbortController().signal,
  timeoutMs = 5000,
  assertBinding: () => void = () => {},
  afterRollback: () => void = () => {},
): Promise<T> {
  signal.throwIfAborted(); assertBinding();
  const file = (database.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')?.file;
  const identity = () => { const stat = statSync(file!); return `${stat.dev}:${stat.ino}`; };
  const original = file ? identity() : undefined;
  const checkFile = () => { if (file && identity() !== original) throw Error('SQLite database file changed.'); };
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    signal.throwIfAborted();
    // No access to a captured handle until its current binding is confirmed.
    assertBinding(); checkFile();
    const previous = (database.query('PRAGMA busy_timeout').get() as { timeout: number }).timeout;
    let contention: unknown;
    let callbackEntered = false;
    database.exec('PRAGMA busy_timeout=0');
    try {
      return database.transaction(() => {
        callbackEntered = true; // Authorization can mutate attempt-local state too.
        checkFile(); authorise('before');
        signal.throwIfAborted();
        const result = operation();
        authorise('after'); checkFile();
        signal.throwIfAborted();
        return result;
      }).immediate();
    } catch (error) {
      afterRollback(); // Synchronous: restore attempt-local memory on terminal failures too.
      if (callbackEntered || !isSqliteContention(error)) throw error;
      contention = error;
    } finally {
      database.exec(`PRAGMA busy_timeout=${previous}`);
    }
    if (performance.now() >= deadline) throw contention;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, Math.min(25, Math.max(1, deadline - performance.now())));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    if (performance.now() >= deadline) throw contention;
  }
}
