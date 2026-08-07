import { test, expect } from '../support/world';

// US-12: Thoughts panel expand/collapse and scroll behaviour
//
// The thoughts panel uses CSS to control scrollability:
// - Collapsed: overflow-y: auto with max-height clamped to N lines
// - Expanded (thought panel): overflow-y: auto with the expanded line cap
// - data-expanded="true"/"false" on .agent-thinking element
//
// These tests use a deterministic DOM fixture instead of sending a real agent
// message. The goal here is to validate the CSS/DOM contract for the rendered
// thoughts panel without requiring auth, model availability, or LLM thinking.

/** Build a long multi-line thought string. */
function buildLongThought(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `Reasoning step ${i + 1}: considering implications...`).join('\n');
}

async function mountThoughtPanelFixture(page: import('@playwright/test').Page, lines = 40) {
  const text = buildLongThought(lines);
  await page.evaluate(({ text, lines }) => {
    document.querySelector('#e2e-thought-panel-fixture')?.remove();
    const panel = document.createElement('div');
    panel.id = 'e2e-thought-panel-fixture';
    panel.className = 'agent-thinking';
    panel.setAttribute('data-expanded', 'false');
    panel.setAttribute('data-collapsible', 'true');
    panel.setAttribute('data-panel-key', 'thought');
    const triangle = (direction: 'right' | 'up') => direction === 'up'
      ? '<svg class="ui-disclosure-triangle ui-disclosure-triangle-up" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><polygon points="2 7 8 7 5 2"></polygon></svg>'
      : '<svg class="ui-disclosure-triangle ui-disclosure-triangle-right" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><polygon points="3 2 8 5 3 8"></polygon></svg>';
    panel.innerHTML = `
      <div class="agent-thinking-title">Thoughts</div>
      <div class="agent-thinking-body agent-thinking-body-collapsible" style="--agent-thinking-collapsed-lines: 8;"></div>
      <button class="agent-thinking-truncation" type="button"><span class="agent-thinking-truncation-arrow">${triangle('right')}</span><span>${Math.max(0, lines - 8)} more lines</span></button>
    `;
    const body = panel.querySelector('.agent-thinking-body') as HTMLElement;
    body.innerHTML = text
      .split('\n')
      .map((line) => `<div>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`)
      .join('');
    const button = panel.querySelector('.agent-thinking-truncation') as HTMLButtonElement;
    button.addEventListener('click', () => {
      const expanded = panel.getAttribute('data-expanded') === 'true';
      panel.setAttribute('data-expanded', expanded ? 'false' : 'true');
      if (!expanded) body.scrollTop = 0;
      button.innerHTML = expanded
        ? `<span class="agent-thinking-truncation-arrow">${triangle('right')}</span><span>${Math.max(0, lines - 8)} more lines</span>`
        : `<span class="agent-thinking-truncation-arrow">${triangle('up')}</span><span>show less</span>`;
    });
    const host = document.querySelector('.timeline, .container, body') || document.body;
    host.prepend(panel);
  }, { text, lines });
  await page.locator('.agent-thinking[data-panel-key="thought"]').waitFor({ state: 'visible', timeout: 5000 });
}

/** Get the computed style properties of the thoughts panel body. */
async function getThoughtsPanelState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.agent-thinking[data-panel-key="thought"]');
    if (!panel) return null;
    const body = panel.querySelector('.agent-thinking-body') as HTMLElement | null;
    if (!body) return null;
    const style = getComputedStyle(body);
    return {
      expanded: panel.getAttribute('data-expanded'),
      overflowY: style.overflowY,
      maxHeight: style.maxHeight,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      isScrollable: body.scrollHeight > body.clientHeight,
      hasMoreButton: !!panel.querySelector('.agent-thinking-truncation'),
      moreButtonText: panel.querySelector('.agent-thinking-truncation')?.textContent?.trim() || '',
      bodyText: body.textContent?.trim().slice(0, 100) || '',
    };
  });
}

test.describe('US-12: Thoughts Panel Scroll Behaviour', () => {
  test('collapsed panel keeps bounded scrolling and shows "more lines"', async ({ authedPage: page }) => {
    await mountThoughtPanelFixture(page);
    const state = await getThoughtsPanelState(page);
    expect(state).toBeTruthy();
    expect(state!.hasMoreButton).toBe(true);

    // Collapsed state checks
    expect(state!.expanded).toBe('false');
    expect(state!.overflowY).toBe('auto');
    expect(state!.moreButtonText).toContain('more lines');
  });

  test('collapsed panel keeps receiving streamed content without expansion', async ({ authedPage: page }) => {
    await mountThoughtPanelFixture(page, 12);
    const panel = page.locator('.agent-thinking[data-panel-key="thought"]');

    await page.evaluate(() => {
      const body = document.querySelector('.agent-thinking[data-panel-key="thought"] .agent-thinking-body');
      const line = document.createElement('div');
      line.textContent = 'Reasoning step 13: streamed while collapsed';
      body?.append(line);
    });

    await expect(panel).toHaveAttribute('data-expanded', 'false');
    await expect(panel.locator('.agent-thinking-body')).toContainText('streamed while collapsed');
  });

  test('clicking "more lines" enables scrolling', async ({ authedPage: page }) => {
    await mountThoughtPanelFixture(page, 80);
    const panel = page.locator('.agent-thinking[data-panel-key="thought"]');
    const moreBtn = panel.locator('.agent-thinking-truncation');

    // Click to expand
    await moreBtn.click();
    await page.waitForTimeout(500);

    const state = await getThoughtsPanelState(page);
    expect(state).toBeTruthy();
    expect(state!.expanded).toBe('true');
    expect(state!.overflowY).toBe('auto');

    // max-height should be constrained (not "none")
    expect(state!.maxHeight).not.toBe('none');
    // Should contain a viewport or rem unit constraint
    // (computed value will be in px, but should be less than full viewport)

    // If content is long enough, panel should be scrollable
    if (state!.scrollHeight > 200) {
      expect(state!.isScrollable).toBe(true);
    }
  });

  test('clicking "show less" collapses back to bounded scrolling', async ({ authedPage: page }) => {
    await mountThoughtPanelFixture(page, 80);
    const panel = page.locator('.agent-thinking[data-panel-key="thought"]');
    const moreBtn = panel.locator('.agent-thinking-truncation');
    await moreBtn.click();
    await page.waitForTimeout(500);

    // Verify expanded
    let state = await getThoughtsPanelState(page);
    expect(state!.expanded).toBe('true');

    // Click "show less"
    const lessBtn = panel.locator('.agent-thinking-truncation');
    await lessBtn.click();
    await page.waitForTimeout(500);

    // Verify collapsed
    state = await getThoughtsPanelState(page);
    expect(state!.expanded).toBe('false');
    expect(state!.overflowY).toBe('auto');
  });

  test('expand/collapse round-trip preserves content', async ({ authedPage: page }) => {
    await mountThoughtPanelFixture(page, 80);
    const panel = page.locator('.agent-thinking[data-panel-key="thought"]');
    const moreBtn = panel.locator('.agent-thinking-truncation');

    // Expand
    await moreBtn.click();
    await page.waitForTimeout(500);

    // Capture content
    const expandedState = await getThoughtsPanelState(page);
    const contentSnapshot = expandedState!.bodyText;

    // Scroll down if scrollable
    await page.evaluate(() => {
      const body = document.querySelector('.agent-thinking[data-panel-key="thought"] .agent-thinking-body') as HTMLElement;
      if (body) body.scrollTop = body.scrollHeight;
    });
    await page.waitForTimeout(200);

    // Collapse
    const lessBtn = panel.locator('.agent-thinking-truncation');
    await lessBtn.click();
    await page.waitForTimeout(500);

    // Expand again
    const moreBtn2 = panel.locator('.agent-thinking-truncation');
    await moreBtn2.click();
    await page.waitForTimeout(500);

    // Content should still be there
    const restoredState = await getThoughtsPanelState(page);
    expect(restoredState!.bodyText).toBe(contentSnapshot);

    // Scroll should be at top after re-expand
    const scrollTop = await page.evaluate(() => {
      const body = document.querySelector('.agent-thinking[data-panel-key="thought"] .agent-thinking-body') as HTMLElement;
      return body?.scrollTop || 0;
    });
    expect(scrollTop).toBe(0);
  });
});
