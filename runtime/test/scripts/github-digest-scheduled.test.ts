import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SCRIPT = join(REPO_ROOT, "scripts/github-digest-scheduled.sh");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function runScheduledDigest(postExitCode = 0, totals = { total_items: 1, repos_with_star_changes: 0 }) {
  const root = mkdtempSync(join(tmpdir(), "piclaw-github-digest-test-"));
  tempDirs.push(root);
  const binDir = join(root, "bin");
  const outputDir = join(root, "output");
  const notesDir = join(root, "notes");
  Bun.spawnSync(["mkdir", "-p", binDir, outputDir, notesDir]);

  writeExecutable(join(binDir, "bun"), `#!/usr/bin/env bash
set -euo pipefail
output_json=""
output_markdown=""
history_yaml=""
while (($#)); do
  case "$1" in
    --output-json) output_json="$2"; shift 2 ;;
    --output-markdown) output_markdown="$2"; shift 2 ;;
    --history-yaml) history_yaml="$2"; shift 2 ;;
    *) shift ;;
  esac
done
for path in "$output_json" "$output_markdown" "$history_yaml"; do
  [[ "$path" == "$TEST_ROOT"/* ]] || { echo "unsafe test output path: $path" >&2; exit 44; }
done
printf '%s\n' "$DIGEST_TOTALS" > "$output_json"
printf '%s\n' '# Clean digest' > "$output_markdown"
printf '%s\n' 'version: 1' > "$history_yaml"
`);

  const postArgsPath = join(root, "post-args.txt");
  const testScript = join(root, "github-digest-scheduled.sh");
  const scriptSource = readFileSync(SCRIPT, "utf8").replace(
    'NOTES_DIR="/workspace/notes/reference"',
    `NOTES_DIR="${notesDir}"`,
  );
  writeExecutable(testScript, scriptSource);
  writeExecutable(join(binDir, "piclaw"), `#!/usr/bin/env bash
printf '%s\n' "$*" > "$PICLAW_POST_ARGS"
printf '%s\n' '{"level":"warn","operation":"domain_config.compat_env","message":"Deprecated compatibility environment variable used for domain config"}' >&2
printf '%s\n' '[piclaw-cli] preserved diagnostic' >&2
exit "${postExitCode}"
`);

  const proc = Bun.spawnSync(["bash", testScript, "web:test"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      GITHUB_TOKEN: "test-token",
      PICLAW_BIN: join(binDir, "piclaw"),
      PICLAW_GITHUB_COLLATE_OUTPUT_DIR: outputDir,
      PICLAW_POST_ARGS: postArgsPath,
      TEST_ROOT: root,
      DIGEST_TOTALS: JSON.stringify({ totals }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    stdout: Buffer.from(proc.stdout).toString("utf8"),
    stderr: Buffer.from(proc.stderr).toString("utf8"),
    postArgs: (() => {
      try { return readFileSync(postArgsPath, "utf8"); } catch { return ""; }
    })(),
  };
}

test("scheduled GitHub digest suppresses only successful post compatibility warnings", () => {
  const result = runScheduledDigest();

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("domain_config.compat_env");
  expect(result.stderr).toContain("[piclaw-cli] preserved diagnostic");
  expect(result.postArgs).toContain("--post web:test # Clean digest");
});

test("scheduled GitHub digest is silent and does not post when there is no qualifying content", () => {
  const result = runScheduledDigest(0, { total_items: 0, repos_with_star_changes: 0 });

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
  expect(result.postArgs).toBe("");
});

test("scheduled GitHub digest posts when stars changed even with no open items", () => {
  const result = runScheduledDigest(0, { total_items: 0, repos_with_star_changes: 1 });

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.postArgs).toContain("--post web:test # Clean digest");
});

test("scheduled GitHub digest preserves post failures and their diagnostics", () => {
  const result = runScheduledDigest(7);

  expect(result.exitCode).toBe(7);
  expect(result.stderr).toContain("domain_config.compat_env");
  expect(result.stderr).toContain("[piclaw-cli] preserved diagnostic");
  expect(result.stdout).not.toContain("Report posted");
});
