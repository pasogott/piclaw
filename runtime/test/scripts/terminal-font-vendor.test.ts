import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const runtimeRoot = join(repoRoot, "runtime");

function buildTerminalFonts() {
  return Bun.spawnSync(
    ["bun", join(runtimeRoot, "scripts/vendor-firacode-nerd-font.ts")],
    {
      cwd: runtimeRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

test("terminal font workflow vendors FiraCode Nerd Font Mono with metadata", () => {
  const proc = buildTerminalFonts();
  if (proc.exitCode !== 0) {
    throw new Error(`${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim());
  }

  const metaFile = join(runtimeRoot, "web/static/common/fonts/vendor/firacode-nerd-font.meta.json");
  const regularFile = join(runtimeRoot, "web/static/common/fonts/vendor/firacode-nerd-font-mono-regular.ttf");
  const boldFile = join(runtimeRoot, "web/static/common/fonts/vendor/firacode-nerd-font-mono-bold.ttf");

  expect(existsSync(metaFile)).toBe(true);
  expect(existsSync(regularFile)).toBe(true);
  expect(existsSync(boldFile)).toBe(true);

  const meta = JSON.parse(readFileSync(metaFile, "utf8")) as {
    manifest_id: string;
    package_name: string;
    package_version: string;
    output_files: Array<{ archive_path: string; output_file: string; size_bytes: number }>;
  };

  expect(meta.manifest_id).toBe("firacode-nerd-font-mono");
  expect(meta.package_name).toBe("nerd-fonts-release");
  expect(meta.package_version).toBe("v3.4.0");
  expect(meta.output_files.length).toBe(2);
  expect(meta.output_files.some((file) => file.archive_path === "FiraCodeNerdFontMono-Regular.ttf")).toBe(true);
  expect(meta.output_files.some((file) => file.archive_path === "FiraCodeNerdFontMono-Bold.ttf")).toBe(true);
  expect(readFileSync(regularFile).byteLength).toBeGreaterThan(1000);
  expect(readFileSync(boldFile).byteLength).toBeGreaterThan(1000);
});
