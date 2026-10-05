/** Bounded public SessionManager soak; no explicit GC or live state. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';

const root = process.env.PICLAW_WORKSPACE!;
assertPathWithinTestFilesystemIsolation(root, process.env, { allowRoot: false });
const shape = process.argv[2] ?? 'linear', size = Number(process.argv[3] ?? 2000), durationMs = Number(process.argv[4] ?? 60000);
assert(['linear', 'branched', 'tools'].includes(shape));
assert(Number.isSafeInteger(size) && size >= 100 && size <= 5000);
if (shape === 'tools') assert.equal(size % 3, 0, 'Tool histories require complete user/call/result triples');
assert(Number.isSafeInteger(durationMs) && durationMs >= 1000 && durationMs <= 120000);
mkdirSync(root, { recursive: true });
const file = join(root, 'synthetic-soak.jsonl');
const lines = [JSON.stringify({ type: 'session', version: 3, id: '66666666-6666-4666-8666-666666666666', timestamp: '2026-01-01T00:00:00Z', cwd: root })];
const branchLength = Math.ceil(size / 10);
for (let n = 0; n < size; n++) {
  const text = 'Synthetic history ' + n + ' ' + 's'.repeat(1024);
  const message = shape === 'tools' && n % 3 === 1
    ? { role: 'assistant', api: 'openai-completions', provider: 'synthetic', model: 'synthetic', timestamp: n, stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call-' + n, name: 'synthetic', arguments: { value: text } }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
    : shape === 'tools' && n % 3 === 2
      ? { role: 'toolResult', toolCallId: 'call-' + (n - 1), toolName: 'synthetic', content: [{ type: 'text', text }], isError: false, timestamp: n }
      : { role: 'user', content: text, timestamp: n };
  const branchStart = shape === 'branched' && n % branchLength === 0;
  lines.push(JSON.stringify({ type: 'message', id: 'soak-' + n, parentId: n && !branchStart ? 'soak-' + (n - 1) : null, timestamp: '2026-01-01T00:00:00Z', message }));
}
writeFileSync(file, lines.join('\n') + '\n');
lines.length = 0;
const contextLength = shape === 'branched' ? (size - 1) % branchLength + 1 : size;
let memoryReadRetries = 0;
function memory() {
  for (let attempt = 0; ; attempt++) {
    try { return process.memoryUsage(); }
    catch (error) { if ((error as { errno?: number }).errno !== 4 || attempt >= 2) throw error; memoryReadRetries++; }
  }
}
const retained = Array.from({ length: 3 }, () => SessionManager.open(file));
const finalized = new Set<number>();
const registry = new FinalizationRegistry<number>(id => finalized.add(id));
retained.forEach((manager, n) => registry.register(manager, -n - 1));
function batch(firstId: number) {
  for (let n = 0; n < 3; n++) {
    const manager = SessionManager.open(file);
    assert.equal(manager.getEntries().length, size);
    assert.equal(manager.buildSessionContext().messages.length, contextLength);
    registry.register(manager, firstId + n);
  }
}
const loop = monitorEventLoopDelay({ resolution: 1 });
loop.enable(); await Bun.sleep(10); loop.reset();
const at = performance.now(), cpu = process.cpuUsage(), before = memory(), samples = [];
let opened = 0;
try {
  do {
    const start = performance.now(); batch(opened); opened += 3;
    for (const manager of retained) assert.equal(manager.buildSessionContext().messages.length, contextLength);
    assert([...finalized].every(id => id >= 0), 'Held control was finalized');
    await Bun.sleep(Math.min(1000, Math.max(1, durationMs - (performance.now() - at))));
    samples.push({ elapsedMs: performance.now() - at, cycleMs: performance.now() - start, opened, naturalFinalized: finalized.size, memory: memory(), eventLoopMaxMs: loop.max / 1e6 });
  } while (performance.now() - at < durationMs);
  loop.disable();
  assert(opened >= 3);
  assert.deepEqual(retained.map(manager => manager.getEntries().length), [size, size, size]);
  console.log(JSON.stringify({ runtime: Bun.version, shape, entries: size, contextMessages: contextLength, requestedMs: durationMs, wallMs: performance.now() - at, cpu: process.cpuUsage(cpu), memoryBefore: before, memoryAfter: memory(), memoryReadRetries, openedDroppedManagers: opened, naturalFinalizedManagers: finalized.size, retainedControls: 3, noHeldFinalizers: true, explicitGcCalls: 0, fixtureBytes: statSync(file).size, eventLoop: { samples: loop.count, maxMs: loop.max / 1e6, meanMs: loop.mean / 1e6 }, samples, scope: 'Public SessionManager disk open/context soak with linear, ten-spoke branched or user/tool-call/tool-result histories. Three held controls, rotating dropped managers, no forced GC. Process-wide memory and nondeterministic finalizers are observations, not leak absence or per-GC pause attribution; no Agent inference/provider/live credentials/state. Whole-child CPU includes fixture setup.' }));
} finally { loop.disable(); retained.length = 0; }
