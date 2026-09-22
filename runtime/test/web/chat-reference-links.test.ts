import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { linkifyChatReferences } from '../../web/src/ui/chat-reference-links';
import { normalizeProjectRepository } from '../../src/core/project-repository';
import { getChatProjectRepository, setChatProjectRepository, subscribeChatProject } from '../../web/src/ui/chat-project-state';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); }, 30000);
afterAll(async () => { await browser?.close(); });

test('numeric references are plain when unset and named hashtags remain timeline links', async () => {
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(([source]) => {
      // Exercise source in a native browser DOM while keeping the test isolated.
      const fn = (0, eval)(`(${source.replace('normalizeProjectRepository(repositoryUrl)', 'repositoryUrl')})`);
      return fn('<p>#42 #bug <code>#43</code> <a href="https://x/#44">#44</a></p>', null);
    }, [linkifyChatReferences.toString()]);
    expect(result).toContain('#42'); expect(result).not.toContain('/issues/42');
    expect(result).toContain('class="hashtag"'); expect(result).toContain('<code>#43</code>');
    expect(result).toContain('href="https://x/#44"');
  } finally { await page.close(); }
}, 30000);

test('numeric project links are safe external links with conservative token boundaries', async () => {
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(([source]) => {
      const fn = (0, eval)(`(${source.replace('normalizeProjectRepository(repositoryUrl)', 'repositoryUrl')})`);
      return fn('<p>#42 #0 #042 owner/#43 color#123456 #44word</p>', 'https://gitea.example/team/repo');
    }, [linkifyChatReferences.toString()]);
    expect(result).toContain('href="https://gitea.example/team/repo/issues/42"');
    expect(result).toContain('target="_blank"'); expect(result).toContain('rel="noopener noreferrer"');
    expect(result).not.toContain('/issues/0'); expect(result).not.toContain('/issues/042');
    expect(result).not.toContain('/issues/43'); expect(result).not.toContain('/issues/123456'); expect(result).not.toContain('/issues/44');
  } finally { await page.close(); }
}, 30000);

test('chat project state notifies only the matching chat', () => {
  let a = 0, b = 0;
  const offA = subscribeChatProject('a', () => a++), offB = subscribeChatProject('b', () => b++);
  setChatProjectRepository('a', 'https://github.com/a/b');
  setChatProjectRepository('a', 'https://github.com/a/b');
  expect(getChatProjectRepository('a')).toBe('https://github.com/a/b');
  expect([a, b]).toEqual([1, 0]); offA(); offB();
});

test('both shipped markdown surfaces consume the shared project repository option', () => {
  const root = resolve(import.meta.dir, '../..');
  const classic = readFileSync(resolve(root, 'web/src/markdown.ts'), 'utf8');
  const visual = readFileSync(resolve(root, 'web/static/visual/frontend/src/utils/markdown-pipeline.ts'), 'utf8');
  for (const source of [classic, visual]) {
    expect(source).toContain('linkifyChatReferences');
    expect(source).toContain('options.projectRepository');
  }
});

test('repository URL normalisation handles .git and rejects unsafe forms', () => {
  expect(normalizeProjectRepository('https://github.com/o/r.git/')).toBe('https://github.com/o/r');
  for (const url of ['javascript:alert(1)', 'https://u:p@example.com/o/r', 'https://example.com/o/r?q=1']) expect(() => normalizeProjectRepository(url)).toThrow();
});

test('numeric-only mode leaves named user hashtags unchanged', async () => {
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(([source]) => {
      const fn = (0, eval)(`(${source.replace('normalizeProjectRepository(repositoryUrl)', 'repositoryUrl')})`);
      return fn('<p>#42 #bug</p>', 'https://github.com/example/repo', false);
    }, [linkifyChatReferences.toString()]);
    expect(result).toContain('/issues/42'); expect(result).not.toContain('data-hashtag'); expect(result).toContain('#bug');
  } finally { await page.close(); }
}, 30000);
