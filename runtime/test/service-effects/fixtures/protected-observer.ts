const REDACTED = "[REDACTED]";
const UNOBSERVABLE = "[UNOBSERVABLE]";

export interface HostileObservationInput {
  readonly params?: unknown;
  readonly result?: unknown;
  readonly updates?: readonly unknown[];
  readonly error?: unknown;
}

/** Test-only hostile trace/projection observer that never invokes accessors. */
export function observeWithProtection(
  input: HostileObservationInput,
  selectors: readonly string[],
): Readonly<Record<string, unknown>> {
  const safeSelectors = snapshotStrings(selectors);
  const fields = snapshotRecord(input);
  if (!safeSelectors || !fields) return unobservableObservation();
  const updates = fields.updates === undefined ? [] : snapshotArray(fields.updates);
  return Object.freeze({
    params: clone(fields.params, "params", safeSelectors, new WeakSet()),
    result: clone(fields.result, "result", safeSelectors, new WeakSet()),
    updates: updates ? Object.freeze(updates.map((update) => clone(update, "result", safeSelectors, new WeakSet()))) : UNOBSERVABLE,
    error: fields.error === undefined ? undefined : Object.freeze({ name: "Error", message: "tool operation failed" }),
  });
}

export function candidateForSelector(selector: string, secret: string): HostileObservationInput {
  if (selector === "params.*") return { params: { arbitrary: secret } };
  if (selector === "result.*") return { result: { content: secret, details: { nested: secret } } };
  const [root, ...segments] = selector.split(".");
  const value: Record<string, unknown> = {};
  let cursor = value;
  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) cursor[segment] = secret;
    else cursor = cursor[segment] = {} as Record<string, unknown>;
  }
  return root === "params" ? { params: value } : { result: value };
}

function clone(value: unknown, path: string, selectors: readonly string[], seen: WeakSet<object>): unknown {
  if (protectedPath(path, selectors)) return REDACTED;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return UNOBSERVABLE;
  seen.add(value);
  let keys: readonly PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return UNOBSERVABLE;
  }
  if (Array.isArray(value)) {
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 10_000) return UNOBSERVABLE;
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      output.push(!descriptor || !("value" in descriptor)
        ? REDACTED
        : clone(descriptor.value, `${path}.${index}`, selectors, seen));
    }
    return Object.freeze(output);
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") continue;
    const descriptor = descriptors[key];
    output[key] = !descriptor || !("value" in descriptor)
      ? REDACTED
      : clone(descriptor.value, `${path}.${key}`, selectors, seen);
  }
  return Object.freeze(output);
}

function protectedPath(path: string, selectors: readonly string[]): boolean {
  return selectors.some((selector) => {
    if (selector === "params.*") return path === "params" || path.startsWith("params.");
    if (selector === "result.*") return path === "result" || path.startsWith("result.");
    return path === selector || path.startsWith(`${selector}.`);
  });
}

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return null; }
  const output: Record<string, unknown> = Object.create(null);
  for (const field of ["params", "result", "updates", "error"] as const) {
    const descriptor = descriptors[field];
    if (!descriptor) continue;
    output[field] = "value" in descriptor ? descriptor.value : UNOBSERVABLE;
  }
  return output;
}

function snapshotArray(value: unknown): unknown[] | null {
  let descriptors: PropertyDescriptorMap;
  try {
    if (!Array.isArray(value)) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { return null; }
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 10_000) return null;
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) return null;
    output.push(descriptor.value);
  }
  return output;
}

function snapshotStrings(value: unknown): readonly string[] | null {
  const snapshot = snapshotArray(value);
  return snapshot && snapshot.every((entry) => typeof entry === "string") ? Object.freeze(snapshot as string[]) : null;
}

function unobservableObservation(): Readonly<Record<string, unknown>> {
  return Object.freeze({ params: UNOBSERVABLE, result: UNOBSERVABLE, updates: UNOBSERVABLE, error: undefined });
}
