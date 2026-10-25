import type Database from 'bun:sqlite';
import { assertAutoCompactionSettingWritable, getCompactionRuntimeConfig, setCompactionRuntimeConfig } from '../../src/core/config.js';

/** Host-wide settings, matching /auto-compact's existing scope. SDK reads these
 * at each decision; changing a policy never restarts or replays an operation. */
export function createHostCommandPolicy(root: Database, assertCurrent: () => void) {
  const key = 'native.auto-retry.v1';
  const read = () => {
    assertCurrent();
    const saved = root.query('SELECT value FROM router_state WHERE key=?').get(key) as {value:string} | null;
    if (saved && !['on', 'off'].includes(saved.value)) throw Error('Native retry policy is unreadable');
    return { autoCompact: getCompactionRuntimeConfig().autoCompactionEnabled, autoRetry: saved?.value === 'on' };
  };
  const set = (name: 'autoCompact' | 'autoRetry', enabled: boolean) => {
    assertCurrent();
    if (typeof enabled !== 'boolean') throw Error('Boolean native policy required');
    if (name === 'autoCompact') {
      assertAutoCompactionSettingWritable(enabled);
      setCompactionRuntimeConfig({autoCompactionEnabled: enabled});
    }
    else if (name === 'autoRetry') root.transaction(() => {
      assertCurrent(); root.query('INSERT OR REPLACE INTO router_state (key,value) VALUES (?,?)').run(key, enabled ? 'on' : 'off'); assertCurrent();
    }).immediate();
    else throw Error('Unknown native policy');
    assertCurrent();
  };
  return {read, set, settings: {
    get retry() { return {enabled: read().autoRetry}; },
    get compaction() { return {enabled: read().autoCompact}; },
  }};
}
