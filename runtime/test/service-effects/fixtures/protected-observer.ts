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
  return Object.freeze({
    params: clone(input.params, "params", selectors),
    result: clone(input.result, "result", selectors),
    updates: Object.freeze((input.updates ?? []).map((update) => clone(update, "result", selectors))),
    error: input.error === undefined ? undefined : Object.freeze({ name: "Error", message: "tool operation failed" }),
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

function clone(value: unknown, path: string, selectors: readonly string[]): unknown {
  if (protectedPath(path, selectors)) return REDACTED;
  if (value === null || typeof value !== "object") return value;
  let keys: readonly PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return UNOBSERVABLE;
  }
  if (Array.isArray(value)) {
    const length = Number(descriptors.length?.value ?? 0);
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      output.push(!descriptor || !("value" in descriptor)
        ? REDACTED
        : clone(descriptor.value, `${path}.${index}`, selectors));
    }
    return Object.freeze(output);
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") continue;
    const descriptor = descriptors[key];
    output[key] = !descriptor || !("value" in descriptor)
      ? REDACTED
      : clone(descriptor.value, `${path}.${key}`, selectors);
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
