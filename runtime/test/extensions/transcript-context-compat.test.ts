import { expect, test } from 'bun:test';
import { Type } from 'typebox';
import type { Context, Tool } from '@earendil-works/pi-ai';
import { currentContextTools, providerTranscriptContext } from '../../src/extensions/transcript-context-compat.js';

const tool = (name: string): Tool => ({ name, description: name, parameters: Type.Object({}) });

test('tool lookup resolves initial, added and removed declarations without trusting stale top-level tools', () => {
  const initial = tool('initial');
  const added = tool('added');
  const context = { tools: [initial], messages: [
    { role: 'system', content: 'additional policy', toolsAdded: [added], timestamp: 1 },
    { role: 'system', content: '', toolsRemoved: [{ name: 'initial' }], timestamp: 2 },
  ] } as unknown as Context;
  expect(currentContextTools(context).map((entry) => entry.name)).toEqual(['added']);
  // The pinned 0.85.1 package has no public normalizer; a disposable 0.87.1
  // fixture checks the published helper and branded provider assignment.
  expect(providerTranscriptContext(context)).toBe(context);
});

test('tool lookup preserves initial tools when no transcript deltas exist', () => {
  expect(currentContextTools({ tools: [tool('base')], messages: [] }).map((entry) => entry.name)).toEqual(['base']);
});
