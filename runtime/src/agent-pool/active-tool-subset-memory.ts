type ActiveToolControl = object;

const lastNonEmptyToolSubset = new WeakMap<ActiveToolControl, string[]>();

export function rememberActiveToolSubset(session: ActiveToolControl, toolNames: string[]): void {
  if (toolNames.length === 0) return;
  lastNonEmptyToolSubset.set(session, [...toolNames]);
}

export function getRememberedActiveToolSubset(session: ActiveToolControl): string[] | null {
  const remembered = lastNonEmptyToolSubset.get(session);
  return remembered ? [...remembered] : null;
}
