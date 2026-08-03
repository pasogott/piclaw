import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const runtimeRoot = join(repoRoot, "runtime");

function buildVendor(manifest: string, outFile: string, metaFile: string) {
  return Bun.spawnSync(
    [
      "bun",
      join(runtimeRoot, "scripts/build-vendored-dependency.ts"),
      "--manifest",
      manifest,
      "--outfile",
      outFile,
      "--meta-out",
      metaFile,
    ],
    {
      cwd: runtimeRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

test("preact-htm vendor build records both package versions", () => {
  const base = join(tmpdir(), `piclaw-preact-htm-vendor-${Date.now()}`);
  const outFile = join(base, "preact-htm.js");
  const metaFile = join(base, "preact-htm.meta.json");
  mkdirSync(base, { recursive: true });

  const proc = buildVendor("vendor-manifests/preact-htm.json", outFile, metaFile);
  if (proc.exitCode !== 0) {
    throw new Error(`${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim());
  }

  expect(existsSync(outFile)).toBe(true);
  expect(existsSync(metaFile)).toBe(true);

  const bundle = readFileSync(outFile, "utf8");
  const meta = JSON.parse(readFileSync(metaFile, "utf8")) as {
    manifest_id: string;
    package_versions: Record<string, string>;
    sha256: string;
    size_bytes: number;
  };

  expect(meta.manifest_id).toBe("preact-htm");
  expect(meta.package_versions.preact).toBeDefined();
  expect(meta.package_versions.htm).toBeDefined();
  expect(meta.sha256).toBe(createHash("sha256").update(bundle).digest("hex"));
  expect(meta.size_bytes).toBe(Buffer.byteLength(bundle));
  expect(bundle).toContain("useState");
  expect(bundle).toContain("createContext");

  rmSync(base, { recursive: true, force: true });
});

test("marked vendor build installs the marked global", () => {
  const base = join(tmpdir(), `piclaw-marked-vendor-${Date.now()}`);
  const outFile = join(base, "marked.min.js");
  const metaFile = join(base, "marked.meta.json");
  mkdirSync(base, { recursive: true });

  const proc = buildVendor("vendor-manifests/marked-global.json", outFile, metaFile);
  if (proc.exitCode !== 0) {
    throw new Error(`${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim());
  }

  const bundle = readFileSync(outFile, "utf8");
  const meta = JSON.parse(readFileSync(metaFile, "utf8")) as {
    manifest_id: string;
    package_versions: Record<string, string>;
  };
  expect(meta.manifest_id).toBe("marked-global");
  expect(meta.package_versions.marked).toBeDefined();

  const previous = (globalThis as Record<string, unknown>).marked;
  try {
    delete (globalThis as Record<string, unknown>).marked;
    new Function(bundle)();
    const markedGlobal = (globalThis as Record<string, unknown>).marked as { parse?: (value: string) => string } | undefined;
    expect(typeof markedGlobal?.parse).toBe("function");
    expect(markedGlobal?.parse?.("**hi**")).toContain("<strong>hi</strong>");
  } finally {
    if (previous === undefined) {
      delete (globalThis as Record<string, unknown>).marked;
    } else {
      (globalThis as Record<string, unknown>).marked = previous;
    }
  }

  rmSync(base, { recursive: true, force: true });
});

test("katex vendor build installs the katex global", () => {
  const base = join(tmpdir(), `piclaw-katex-vendor-${Date.now()}`);
  const outFile = join(base, "katex.min.js");
  const metaFile = join(base, "katex.meta.json");
  mkdirSync(base, { recursive: true });

  const proc = buildVendor("vendor-manifests/katex-global.json", outFile, metaFile);
  if (proc.exitCode !== 0) {
    throw new Error(`${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim());
  }

  const bundle = readFileSync(outFile, "utf8");
  const meta = JSON.parse(readFileSync(metaFile, "utf8")) as {
    manifest_id: string;
    package_versions: Record<string, string>;
  };
  expect(meta.manifest_id).toBe("katex-global");
  expect(meta.package_versions.katex).toBeDefined();

  const previous = (globalThis as Record<string, unknown>).katex;
  try {
    delete (globalThis as Record<string, unknown>).katex;
    new Function(bundle)();
    const katexGlobal = (globalThis as Record<string, unknown>).katex as { renderToString?: (value: string) => string } | undefined;
    expect(typeof katexGlobal?.renderToString).toBe("function");
    expect(katexGlobal?.renderToString?.("x^2")).toContain("katex");
  } finally {
    if (previous === undefined) {
      delete (globalThis as Record<string, unknown>).katex;
    } else {
      (globalThis as Record<string, unknown>).katex = previous;
    }
  }

  rmSync(base, { recursive: true, force: true });
});
