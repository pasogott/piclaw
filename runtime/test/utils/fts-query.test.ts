/**
 * test/utils/fts-query.test.ts – Tests for FTS query sanitization.
 */
import { expect, test, describe } from "bun:test";
import {
  extractFtsFallbackTerms,
  sanitizeFtsQuery,
  isFtsOperatorQuery,
  prepareFtsQuery,
} from "../../src/utils/fts-query.js";

describe("isFtsOperatorQuery", () => {
  test("detects AND/OR/NOT keywords", () => {
    expect(isFtsOperatorQuery("foo AND bar")).toBe(true);
    expect(isFtsOperatorQuery("foo OR bar")).toBe(true);
    expect(isFtsOperatorQuery("NOT foo")).toBe(true);
    expect(isFtsOperatorQuery("NEAR(foo bar)")).toBe(true);
  });

  test("detects quoted phrases", () => {
    expect(isFtsOperatorQuery('"hello world"')).toBe(true);
    expect(isFtsOperatorQuery('foo "exact phrase" bar')).toBe(true);
  });

  test("detects grouping parentheses", () => {
    expect(isFtsOperatorQuery("(foo OR bar) AND baz")).toBe(true);
  });

  test("detects column prefix", () => {
    expect(isFtsOperatorQuery("content:hello")).toBe(true);
  });

  test("does not treat URLs as column-prefix operators", () => {
    expect(isFtsOperatorQuery("https://sigma.local/path")).toBe(false);
  });

  test("returns false for plain text", () => {
    expect(isFtsOperatorQuery("hello")).toBe(false);
    expect(isFtsOperatorQuery("hello world")).toBe(false);
    expect(isFtsOperatorQuery("sigma.local")).toBe(false);
    expect(isFtsOperatorQuery("pi-side-agents")).toBe(false);
    expect(isFtsOperatorQuery("workspace/tmp/files")).toBe(false);
    expect(isFtsOperatorQuery("some random query text")).toBe(false);
  });
});

describe("sanitizeFtsQuery", () => {
  test("passes simple words through", () => {
    expect(sanitizeFtsQuery("hello")).toBe("hello");
    expect(sanitizeFtsQuery("hello world")).toBe("hello OR world");
  });

  test("strips special FTS characters", () => {
    expect(sanitizeFtsQuery('hello "world"')).toBe("hello OR world");
    expect(sanitizeFtsQuery("hello(world)")).toBe("hello OR world");
    expect(sanitizeFtsQuery("hello:world")).toBe("hello OR world");
    expect(sanitizeFtsQuery("hello*")).toBe("hello");
  });

  test("quotes FTS keywords used as terms", () => {
    expect(sanitizeFtsQuery("and")).toBe('"and"');
    expect(sanitizeFtsQuery("or")).toBe('"or"');
    expect(sanitizeFtsQuery("not")).toBe('"not"');
    expect(sanitizeFtsQuery("near")).toBe('"near"');
    expect(sanitizeFtsQuery("foo and bar")).toBe('foo OR "and" OR bar');
  });

  test("strips leading hyphens (NOT prefix)", () => {
    expect(sanitizeFtsQuery("-hello")).toBe("hello");
    expect(sanitizeFtsQuery("--hello")).toBe("hello");
    expect(sanitizeFtsQuery("foo -bar")).toBe("foo OR bar");
  });

  test("returns null for empty/whitespace-only input", () => {
    expect(sanitizeFtsQuery("")).toBe(null);
    expect(sanitizeFtsQuery("   ")).toBe(null);
  });

  test("returns null when only special chars remain", () => {
    expect(sanitizeFtsQuery('"()*')).toBe(null);
  });

  test("quotes punctuation-heavy identifiers", () => {
    expect(sanitizeFtsQuery("sigma.local")).toBe('"sigma.local"');
    expect(sanitizeFtsQuery("hosts.orangepi6plus.cpu.usage_idle")).toBe('"hosts.orangepi6plus.cpu.usage_idle"');
    expect(sanitizeFtsQuery("pi-side-agents")).toBe('"pi-side-agents"');
    expect(sanitizeFtsQuery("workspace/tmp/files")).toBe('"workspace/tmp/files"');
  });

  test("collapses multiple spaces", () => {
    expect(sanitizeFtsQuery("hello    world")).toBe("hello OR world");
  });

  test("AND mode joins with implicit AND (space)", () => {
    expect(sanitizeFtsQuery("hello world", "and")).toBe("hello world");
    expect(sanitizeFtsQuery("foo and bar", "and")).toBe('foo "and" bar');
    expect(sanitizeFtsQuery("sigma.local graphite", "and")).toBe('"sigma.local" graphite');
  });

  test("OR mode is default", () => {
    expect(sanitizeFtsQuery("hello world")).toBe("hello OR world");
    expect(sanitizeFtsQuery("hello world", "or")).toBe("hello OR world");
  });
});

describe("extractFtsFallbackTerms", () => {
  test("preserves dotted, hyphenated, and slash-separated identifiers", () => {
    expect(extractFtsFallbackTerms('sigma.local "pi-side-agents" workspace/tmp/files')).toEqual([
      "sigma.local",
      "pi-side-agents",
      "workspace/tmp/files",
    ]);
  });

  test("can drop explicit FTS keywords for LIKE fallback", () => {
    expect(extractFtsFallbackTerms("sigma.local AND graphite", { dropFtsKeywords: true })).toEqual([
      "sigma.local",
      "graphite",
    ]);
    expect(extractFtsFallbackTerms("NEAR(foo bar)", { dropFtsKeywords: true })).toEqual(["foo", "bar"]);
  });
});

describe("prepareFtsQuery", () => {
  test("returns null for empty input", () => {
    expect(prepareFtsQuery("")).toBe(null);
    expect(prepareFtsQuery("   ")).toBe(null);
  });

  test("passes through operator queries unchanged", () => {
    expect(prepareFtsQuery("foo AND bar")).toBe("foo AND bar");
    expect(prepareFtsQuery('"exact phrase"')).toBe('"exact phrase"');
  });

  test("sanitizes plain multi-word queries (default OR)", () => {
    expect(prepareFtsQuery("hello world")).toBe("hello OR world");
  });

  test("sanitizes plain multi-word queries (AND mode)", () => {
    expect(prepareFtsQuery("hello world", "and")).toBe("hello world");
  });

  test("quotes punctuation-heavy identifiers inside plain natural-language queries", () => {
    expect(prepareFtsQuery("sigma.local sigma telegraf graphite")).toBe('"sigma.local" OR sigma OR telegraf OR graphite');
    expect(prepareFtsQuery("sigma.local sigma telegraf graphite", "and")).toBe('"sigma.local" sigma telegraf graphite');
    expect(prepareFtsQuery("hosts.orangepi6plus.cpu.usage_idle")).toBe('"hosts.orangepi6plus.cpu.usage_idle"');
    expect(prepareFtsQuery("workspace/tmp/files")).toBe('"workspace/tmp/files"');
  });

  test("handles the real-world failures we hit today", () => {
    // "no such column: side" — hyphenated token parsed as column ref
    expect(prepareFtsQuery("pi-side-agents")).toBe('"pi-side-agents"');

    // "fts5: syntax error near '/'" — slash in query
    expect(prepareFtsQuery("/agents")).toBe('"/agents"');

    // "no such column: capable" — compound term parsed as column
    expect(prepareFtsQuery("service-capable cross-client workbench")).toBe('"service-capable" OR "cross-client" OR workbench');

    // "no such column: commit" — hyphenated compound
    expect(prepareFtsQuery("auto-commit dashboard widget")).toBe('"auto-commit" OR dashboard OR widget');

    // "no such column: packages" — plain word treated as column
    expect(prepareFtsQuery("pi-packages install")).toBe('"pi-packages" OR install');
  });

  test("respects AND mode for real-world queries", () => {
    expect(prepareFtsQuery("service-capable cross-client workbench", "and")).toBe('"service-capable" "cross-client" workbench');
    expect(prepareFtsQuery("auto-commit dashboard widget", "and")).toBe('"auto-commit" dashboard widget');
  });
});
