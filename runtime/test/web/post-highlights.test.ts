import { expect, test } from 'bun:test';
import { buildHighlightFromSelectionSnapshot, getSelectionInElement } from '../../web/src/components/post-highlights.ts';

test('getSelectionInElement preserves multiline list selection while trimming only edge whitespace', () => {
  if (typeof document === 'undefined') return;

  const host = document.createElement('div');
  host.innerHTML = '<ul><li>Alpha item</li><li>Beta item</li></ul>';
  document.body.appendChild(host);

  const firstText = host.querySelector('li')?.firstChild as Text;
  const secondText = host.querySelectorAll('li')[1]?.firstChild as Text;
  expect(firstText).toBeTruthy();
  expect(secondText).toBeTruthy();

  const selectionText = `${firstText.textContent}\n${secondText.textContent}`;
  const range = {
    startContainer: firstText,
    startOffset: 0,
    endContainer: secondText,
    endOffset: secondText.textContent?.length ?? 0,
    commonAncestorContainer: host,
    getBoundingClientRect: () => ({ left: 12, top: 30, width: 40, height: 18, right: 52, bottom: 48, x: 12, y: 30, toJSON: () => ({}) }) as unknown as DOMRect,
  };

  const previousGetSelection = window.getSelection;
  (window as any).getSelection = () => ({
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => `\n${selectionText}\n`,
  });

  try {
    const info = getSelectionInElement(host);
    expect(info).not.toBeNull();
    expect(info?.text).toBe(selectionText);
    expect(info?.textOffset).toBe(0);
  } finally {
    (window as any).getSelection = previousGetSelection;
    host.remove();
  }
});

test('buildHighlightFromSelectionSnapshot survives live selection clearing before color click', () => {
  const snapshot = { text: 'selected text', textOffset: 42 };
  const previousGetSelection = typeof window !== 'undefined' ? window.getSelection : undefined;
  if (typeof window !== 'undefined') {
    (window as any).getSelection = () => ({ isCollapsed: true, rangeCount: 0, toString: () => '' });
  }

  try {
    expect(buildHighlightFromSelectionSnapshot(snapshot, 'yellow')).toEqual({
      type: 'highlight',
      text: 'selected text',
      textOffset: 42,
      color: 'yellow',
    });
  } finally {
    if (typeof window !== 'undefined') (window as any).getSelection = previousGetSelection;
  }
});

test('getSelectionInElement computes offset from absolute start instead of first matching snippet', () => {
  if (typeof document === 'undefined') return;

  const host = document.createElement('div');
  host.innerHTML = '<p>repeat value</p><p>repeat value</p><p>tail</p>';
  document.body.appendChild(host);

  const second = host.querySelectorAll('p')[1]?.firstChild as Text;
  expect(second).toBeTruthy();

  const range = {
    startContainer: second,
    startOffset: 0,
    endContainer: second,
    endOffset: second.textContent?.length ?? 0,
    commonAncestorContainer: host,
    getBoundingClientRect: () => ({ left: 8, top: 10, width: 20, height: 10, right: 28, bottom: 20, x: 8, y: 10, toJSON: () => ({}) }) as unknown as DOMRect,
  };

  const previousGetSelection = window.getSelection;
  (window as any).getSelection = () => ({
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => second.textContent,
  });

  try {
    const info = getSelectionInElement(host);
    expect(info).not.toBeNull();
    // first paragraph is 12 chars, so second "repeat value" starts at 12
    expect(info?.textOffset).toBe(12);
    expect(info?.text).toBe('repeat value');
  } finally {
    (window as any).getSelection = previousGetSelection;
    host.remove();
  }
});
