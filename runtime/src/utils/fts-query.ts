/**
 * utils/fts-query.ts – Sanitize and normalize user queries for SQLite FTS5.
 *
 * FTS5 has a strict query grammar where certain characters and keywords are
 * treated as operators (AND, OR, NOT, NEAR, quotes, parentheses, colons,
 * carets, asterisks, hyphens at token start). Plain multi-word user input
 * can easily trigger syntax errors.
 *
 * This module provides:
 *   - sanitizeFtsQuery(): escape/normalize a raw user string into a safe
 *     FTS5 MATCH expression.
 *   - isFtsOperatorQuery(): detect whether the user is intentionally using
 *     FTS operators so we can skip sanitization for power users.
 *   - prepareFtsQuery(): combines detection + sanitization in one call.
 *   - extractFtsFallbackTerms(): derive safe LIKE fallback terms from the
 *     original query when MATCH parsing still fails.
 *
 * Consumers:
 *   - db/tool-outputs.ts (searchToolOutputSnippets)
 *   - workspace-search.ts (searchWorkspace)
 *   - db/messages.ts (searchMessages)
 *   - extensions/messages-crud.ts (runSearch)
 */

/** FTS5 match mode: "or" treats multi-word queries as any-match, "and" requires all. */
export type FtsMatchMode = "or" | "and";

/** FTS5 reserved keywords that must be quoted if used as search terms. */
const FTS_KEYWORDS = new Set(["AND", "OR", "NOT", "NEAR"]);

/**
 * Characters that have special meaning in FTS5 query syntax.
 * We strip these when they appear in plain user text before tokenization.
 */
const FTS_SPECIAL_CHARS = /[":()^*{}]/g;

/** Barewords that are safe to leave unquoted in FTS5 MATCH expressions. */
const FTS_SAFE_BAREWORD = /^[\p{L}\p{N}_]+$/u;

function quoteFtsTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

function tokenizeFtsFallbackTerms(
  rawQuery: string,
  options: { dropFtsKeywords?: boolean } = {},
): string[] {
  const stripped = rawQuery
    .replace(FTS_SPECIAL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped) return [];

  return stripped
    .split(" ")
    .map((token) => token.replace(/^-+/, "").trim())
    .filter(Boolean)
    .filter((token) => !(options.dropFtsKeywords && FTS_KEYWORDS.has(token.toUpperCase())));
}

/**
 * Detect whether a query string looks like an intentional FTS5 operator
 * expression (contains explicit boolean operators, quotes, or grouping).
 *
 * If this returns true, the caller should pass the query through as-is
 * rather than sanitizing it.
 */
export function isFtsOperatorQuery(query: string): boolean {
  const trimmed = query.trim();
  if (/\b(?:AND|OR|NOT|NEAR)\b/.test(trimmed)) return true;
  if (/^".*"$/.test(trimmed) || /"[^"]+"/.test(trimmed)) return true;
  if (/\(.*\)/.test(trimmed)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*:(?!\/\/)/.test(trimmed)) return true;
  return false;
}

/**
 * Extract LIKE fallback terms from a raw query.
 *
 * This keeps punctuation-heavy identifiers intact (for example hostnames,
 * dotted metric paths, slash-separated paths, and hyphenated package names)
 * while stripping FTS syntax characters that should not participate in a
 * substring fallback.
 */
export function extractFtsFallbackTerms(
  rawQuery: string,
  options: { dropFtsKeywords?: boolean } = {},
): string[] {
  return tokenizeFtsFallbackTerms(rawQuery, options);
}

/**
 * Sanitize a raw user query string into a safe FTS5 MATCH expression.
 *
 * Strategy:
 * 1. Strip FTS syntax characters that should not be treated literally.
 * 2. Split into whitespace-separated tokens.
 * 3. Quote punctuation-heavy identifiers and reserved keywords.
 * 4. Drop empty tokens.
 * 5. Join with the specified mode (OR or implicit AND).
 *
 * @param rawQuery   The raw user input string.
 * @param mode       "or" joins tokens with OR (any match); "and" uses implicit AND (all match). Default: "or".
 * @returns          Safe FTS5 MATCH expression, or null if the query is empty.
 */
export function sanitizeFtsQuery(rawQuery: string, mode: FtsMatchMode = "or"): string | null {
  const tokens = tokenizeFtsFallbackTerms(rawQuery);
  if (tokens.length === 0) return null;

  const safe = tokens.map((token) => {
    if (FTS_KEYWORDS.has(token.toUpperCase())) return quoteFtsTerm(token);
    return FTS_SAFE_BAREWORD.test(token) ? token : quoteFtsTerm(token);
  });

  if (safe.length === 0) return null;
  return mode === "or" ? safe.join(" OR ") : safe.join(" ");
}

/**
 * Prepare a user query for FTS5 MATCH, with automatic fallback.
 *
 * - If the query looks like an intentional operator expression, pass through.
 * - Otherwise, sanitize it into safe tokens joined by the given mode.
 * - Returns null if the query is empty or unsalvageable.
 *
 * @param rawQuery   The raw user input string.
 * @param mode       "or" joins tokens with OR; "and" uses implicit AND. Default: "or".
 */
export function prepareFtsQuery(rawQuery: string, mode: FtsMatchMode = "or"): string | null {
  const trimmed = rawQuery.trim();
  if (!trimmed) return null;
  if (isFtsOperatorQuery(trimmed)) return trimmed;
  return sanitizeFtsQuery(trimmed, mode);
}
