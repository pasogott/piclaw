#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
ARTIFACT_DIR="$ROOT_DIR/artifacts/add-tests-core-config-and-keychain"
BASE_LCOV="$ARTIFACT_DIR/base.lcov.info"
CONFIG_IMPORT_LCOV="$ARTIFACT_DIR/config-import.lcov.info"
KEYCHAIN_IMPORT_LCOV="$ARTIFACT_DIR/keychain-import.lcov.info"
MERGED_LCOV="$ROOT_DIR/runtime/generated/coverage/lcov.info"
SUMMARY_JSON="$ARTIFACT_DIR/coverage-summary.json"
SUMMARY_MD="$ARTIFACT_DIR/coverage-summary.md"
EXCLUSIONS_JSON="$ARTIFACT_DIR/coverage-exclusions.json"
TEST_LOG="$ARTIFACT_DIR/targeted-test-output.log"

mkdir -p "$ARTIFACT_DIR"
: > "$TEST_LOG"

run_suite() {
  local label="$1"
  local out_lcov="$2"
  shift 2

  {
    echo "== $label =="
    rm -rf "$ROOT_DIR/runtime/generated/coverage"
    bun run --cwd "$ROOT_DIR" test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- \
      bun test --max-concurrency=1 "$@" --coverage --coverage-dir=generated/coverage --coverage-reporter=lcov
    echo
  } >>"$TEST_LOG" 2>&1

  if [[ ! -f "$ROOT_DIR/runtime/generated/coverage/lcov.info" ]]; then
    echo "Expected coverage report at $ROOT_DIR/runtime/generated/coverage/lcov.info for $label" >&2
    exit 1
  fi

  cp "$ROOT_DIR/runtime/generated/coverage/lcov.info" "$out_lcov"
}

run_suite "base" "$BASE_LCOV" test/config/config.test.ts test/keychain.test.ts
run_suite "config-import" "$CONFIG_IMPORT_LCOV" test/config/config-coverage-import.test.ts
run_suite "keychain-import" "$KEYCHAIN_IMPORT_LCOV" test/keychain-coverage-import.test.ts

summary_json=$(bun -e '
const fs = require("fs");
const path = require("path");
const [summaryJsonPath, summaryMdPath, exclusionsJsonPath, mergedLcovPath, ...lcovPaths] = process.argv.slice(1);
const targets = ["src/core/config.ts", "src/secure/keychain.ts"];
const merged = new Map();

for (const target of targets) {
  merged.set(target, new Map());
}

for (const lcovPath of lcovPaths) {
  let file = null;
  for (const line of fs.readFileSync(lcovPath, "utf8").split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      file = line.slice(3);
      continue;
    }
    if (!targets.includes(file || "")) continue;
    if (!line.startsWith("DA:")) continue;
    const [lineNoRaw, hitsRaw] = line.slice(3).split(",");
    const lineNo = Number(lineNoRaw);
    const hits = Number(hitsRaw);
    const fileMap = merged.get(file);
    fileMap.set(lineNo, Math.max(fileMap.get(lineNo) || 0, hits));
  }
}

function countBackticks(line) {
  let count = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "`") continue;
    let slashCount = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j -= 1) slashCount += 1;
    if (slashCount % 2 === 0) count += 1;
  }
  return count;
}

function buildTemplateLiteralContentSet(lines) {
  const inside = new Set();
  let inTemplate = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const tickCount = countBackticks(line);
    const isTemplateContent = inTemplate || tickCount > 0;
    if (isTemplateContent && !line.includes("${")) {
      inside.add(index + 1);
    }
    if (tickCount % 2 === 1) {
      inTemplate = !inTemplate;
    }
  }
  return inside;
}

function exclusionReason(lineNo, line, templateContentLines) {
  const trimmed = line.trim();
  if (!trimmed) return "blank";
  if (/^[\]})>,;]+$/.test(trimmed)) return "structural_only";
  if (templateContentLines.has(lineNo)) {
    const literalOnly = trimmed.replace(/`/g, "").trim();
    if (literalOnly && !trimmed.includes("${")) return "template_literal_content";
  }
  return null;
}

const exclusions = {};
let mergedLcov = "";
const summary = {
  generatedAt: new Date().toISOString(),
  command: "./scripts/audit-core-config-keychain-coverage.sh",
  normalization: {
    excluded_reasons: ["blank", "structural_only", "template_literal_content"],
  },
};
let uncoveredTotal = 0;
for (const target of targets) {
  const sourcePath = path.join(process.cwd(), "runtime", target.replace(/^src\//, "src/"));
  const sourceLines = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/);
  const templateContentLines = buildTemplateLiteralContentSet(sourceLines);
  const fileMap = merged.get(target);
  const keptLines = [];
  const fileExclusions = [];
  for (const [lineNo, hits] of [...fileMap.entries()].sort((a, b) => a[0] - b[0])) {
    const sourceLine = sourceLines[lineNo - 1] ?? "";
    const reason = exclusionReason(lineNo, sourceLine, templateContentLines);
    if (reason) {
      fileExclusions.push({ line: lineNo, reason, source: sourceLine });
      continue;
    }
    keptLines.push([lineNo, hits]);
  }
  exclusions[target] = fileExclusions;
  const lf = keptLines.length;
  const lh = keptLines.filter(([, hits]) => hits > 0).length;
  uncoveredTotal += lf - lh;
  const key = target.endsWith("config.ts") ? "config" : "keychain";
  summary[key] = {
    file: target,
    lf,
    lh,
    uncovered: lf - lh,
    line_pct: lf === 0 ? 0 : Number(((lh / lf) * 100).toFixed(2)),
    excluded_lines: fileExclusions.length,
  };
  mergedLcov += `SF:${target}\n`;
  for (const [lineNo, hits] of keptLines) {
    mergedLcov += `DA:${lineNo},${hits}\n`;
  }
  mergedLcov += `LF:${lf}\nLH:${lh}\nend_of_record\n`;
}
summary.uncovered_lines = uncoveredTotal;
summary.min_line_pct = Math.min(summary.config.line_pct, summary.keychain.line_pct);
fs.mkdirSync(path.dirname(mergedLcovPath), { recursive: true });
fs.writeFileSync(mergedLcovPath, mergedLcov);
fs.writeFileSync(exclusionsJsonPath, JSON.stringify(exclusions, null, 2) + "\n");
fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2) + "\n");
const md = [
  "# Coverage summary: core/config + secure/keychain",
  "",
  "- Command: `./scripts/audit-core-config-keychain-coverage.sh`",
  "- Targeted test log: `artifacts/add-tests-core-config-and-keychain/targeted-test-output.log`",
  "- Normalized merged LCOV report: `runtime/generated/coverage/lcov.info`",
  "- Coverage exclusions: `artifacts/add-tests-core-config-and-keychain/coverage-exclusions.json`",
  "- Component LCOV reports:",
  "  - `artifacts/add-tests-core-config-and-keychain/base.lcov.info`",
  "  - `artifacts/add-tests-core-config-and-keychain/config-import.lcov.info`",
  "  - `artifacts/add-tests-core-config-and-keychain/keychain-import.lcov.info`",
  "",
  "Normalization excludes raw LCOV entries for blank lines, punctuation-only structural lines, and template-literal content lines that are not independently executable source statements.",
  "",
  "| Module | Lines hit | Lines found | Line coverage | Excluded lines |",
  "| --- | ---: | ---: | ---: | ---: |",
  `| \`src/core/config.ts\` | ${summary.config.lh} | ${summary.config.lf} | ${summary.config.line_pct}% | ${summary.config.excluded_lines} |`,
  `| \`src/secure/keychain.ts\` | ${summary.keychain.lh} | ${summary.keychain.lf} | ${summary.keychain.line_pct}% | ${summary.keychain.excluded_lines} |`,
  "",
  `- Combined uncovered lines: ${summary.uncovered_lines}`,
].join("\n");
fs.writeFileSync(summaryMdPath, `${md}\n`);
console.log(JSON.stringify(summary));
' "$SUMMARY_JSON" "$SUMMARY_MD" "$EXCLUSIONS_JSON" "$MERGED_LCOV" "$BASE_LCOV" "$CONFIG_IMPORT_LCOV" "$KEYCHAIN_IMPORT_LCOV")

config_pct=$(bun -e 'const s = JSON.parse(process.argv[1]); console.log(s.config.line_pct);' "$summary_json")
keychain_pct=$(bun -e 'const s = JSON.parse(process.argv[1]); console.log(s.keychain.line_pct);' "$summary_json")
uncovered_lines=$(bun -e 'const s = JSON.parse(process.argv[1]); console.log(s.uncovered_lines);' "$summary_json")

echo "METRIC uncovered_lines=${uncovered_lines}"
echo "METRIC config_pct=${config_pct}"
echo "METRIC keychain_pct=${keychain_pct}"

echo "coverage summary written to $SUMMARY_MD"
