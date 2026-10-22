const phases = ["validation", "source", "admission", "provider", "conversion", "accounting"] as const;
const categories = ["aborted", "timeout", "authentication", "rate_limit", "context_limit", "transport", "unavailable", "unknown"] as const;
export type ModelFailurePhase = typeof phases[number];
export interface ModelFailure {
  phase: ModelFailurePhase;
  category: typeof categories[number];
  httpStatus?: number;
}

/** Inspect private errors, but export only fixed categories and an HTTP status.
 * Never retain exception text, headers, URLs, partial output or abort reasons. */
export function classifyModelFailure(phase: ModelFailurePhase, error: unknown): ModelFailure {
  let text = "", status: unknown;
  try {
    if (typeof error === "string") text = error;
    else if (error && typeof error === "object") {
      const value = error as { errorMessage?: unknown; message?: unknown; status?: unknown; statusCode?: unknown; name?: unknown; stopReason?: unknown };
      const message = value.errorMessage ?? value.message;
      if (typeof message === "string") text = message;
      if (value.name === "AbortError" || value.stopReason === "aborted") text = "AbortError";
      status = value.status ?? value.statusCode;
    }
  } catch { return { phase, category: "unknown" }; }
  text = text.slice(0, 2048);
  if (status === undefined) status = Number(text.match(/\bHTTP\s*:?\s*([45]\d\d)\b/i)?.[1]);
  const httpStatus = typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
  const category = /\bAbortError\b|\baborted\b/i.test(text) ? "aborted"
    : httpStatus === 408 || httpStatus === 504 || /timed?\s*out|timeout|ETIMEDOUT/i.test(text) ? "timeout"
    : httpStatus === 401 || httpStatus === 403 || /unauthori[sz]ed|authentication|invalid.api.key|not logged in/i.test(text) ? "authentication"
    : httpStatus === 429 || /rate.limit|too many requests/i.test(text) ? "rate_limit"
    : httpStatus === 413 || /context.length|context.window|maximum context|too many tokens/i.test(text) ? "context_limit"
    : /ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|socket|connection.*(?:closed|reset)/i.test(text) ? "transport"
    : httpStatus !== undefined && httpStatus >= 500 ? "unavailable" : "unknown";
  return { phase, category, ...(httpStatus === undefined ? {} : { httpStatus }) };
}

export function modelFailureDetail(failure: ModelFailure): string {
  return `Host model request failed [phase=${failure.phase}; category=${failure.category}${failure.httpStatus === undefined ? "" : `; http=${failure.httpStatus}`}]`;
}

/** Only our exact, bounded format is eligible for a public explanation. */
export function parseModelFailure(detail: unknown): ModelFailure | undefined {
  if (typeof detail !== "string") return;
  const match = detail.match(/^Host model request failed \[phase=(\w+); category=(\w+)(?:; http=([45]\d\d))?\]$/);
  if (!match || !phases.includes(match[1] as ModelFailurePhase) || !categories.includes(match[2] as ModelFailure["category"])) return;
  return { phase: match[1] as ModelFailurePhase, category: match[2] as ModelFailure["category"], ...(match[3] ? { httpStatus: Number(match[3]) } : {}) };
}

export function modelFailureNotice(detail: unknown, submissionId: number): string {
  const failure = parseModelFailure(detail);
  const reasons: Record<ModelFailure["category"], string> = {
    aborted: "The model request was interrupted.", timeout: "The model request timed out.",
    authentication: "Model authentication or access was rejected.", rate_limit: "The model provider rate-limited the request.",
    context_limit: "The request exceeded the model's context or input limit.", transport: "The model connection failed.",
    unavailable: "The model provider was unavailable.", unknown: "The model request failed or was denied.",
  };
  const reason = failure?.phase === "accounting" ? "The model request could not be reconciled safely; its outcome may be uncertain."
    : failure?.phase === "conversion" ? "The model response could not be processed safely."
    : failure ? reasons[failure.category] : "The model request failed or was denied; the underlying reason was not recorded.";
  return `**Turn failed**\n\n${reason}\n\nTool actions may already have completed. Check their results before continuing; resending the whole request could repeat them. This turn will not be retried automatically.\n\nReference: native submission ${submissionId}.`;
}
