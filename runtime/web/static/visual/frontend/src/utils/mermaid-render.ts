import { renderMermaidDiagrams as renderDiagrams } from '../../../../../src/ui/mermaid-render';
import { createLogger } from './logger';
const log = createLogger('mermaid');

/** Visual uses the same renderer, sanitizer and lifecycle as Classic and Family. */
export async function renderMermaidDiagrams(container: HTMLElement): Promise<void> {
  await renderDiagrams(container, { reportError: (error) => log.error('Render error:', error) });
}
