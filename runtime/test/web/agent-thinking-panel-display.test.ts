import { expect, test } from 'bun:test';

import {
  resolveThinkingPanelDisplayText,
  truncateThinkingPanelLines,
} from '../../web/src/components/status.js';

const lines = Array.from({ length: 24 }, (_, index) => `line-${String(index + 1).padStart(2, '0')}`);
const fullText = lines.join('\n');

test('collapsed Draft renders the bounded latest tail directly', () => {
  const result = resolveThinkingPanelDisplayText({
    sourceText: fullText,
    panelKey: 'draft',
    isExpanded: false,
    maxLines: 9,
    totalLines: 24,
  });

  expect(result.displayText.split('\n')).toEqual(lines.slice(-9));
  expect(result.displayText).toContain('line-24');
  expect(result.displayText).not.toContain('line-01');
  expect(result.truncated.omitted).toBe(15);
});

test('collapsed Thought renders the bounded latest tail directly', () => {
  const result = resolveThinkingPanelDisplayText({
    sourceText: fullText,
    panelKey: 'thought',
    isExpanded: false,
    maxLines: 9,
    totalLines: 24,
  });

  expect(result.displayText.split('\n')).toEqual(lines.slice(-9));
  expect(result.displayText).toContain('line-24');
  expect(result.displayText).not.toContain('line-01');
});

test('expanded Draft and Thought render the complete accumulated content', () => {
  for (const panelKey of ['draft', 'thought']) {
    const result = resolveThinkingPanelDisplayText({
      sourceText: fullText,
      panelKey,
      isExpanded: true,
      maxLines: 9,
      totalLines: 24,
    });
    expect(result.displayText).toBe(fullText);
    expect(result.displayText.split('\n')).toEqual(lines);
  }
});

test('tail truncation preserves soft-line omission accounting', () => {
  const result = truncateThinkingPanelLines(fullText, 9, 24, { direction: 'tail' });
  expect(result.text.split('\n')).toEqual(lines.slice(-9));
  expect(result.totalLines).toBe(24);
  expect(result.visibleLines).toBe(9);
  expect(result.omitted).toBe(15);
});
