import { copyFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
export const codeReviewPins = {
  "index.ts": "9816235d0418bb6f94f9dd0b99edc37f757cc3a72c50506d014cf267c90c0381",
  "tool.ts": "4573abb088c0ccdc46dc159f12ed5467c8a54d87b271ca0829a94d2fcf7e5ca3",
  "runtime.ts": "284b88d0e3466ddc710d228969f7cb23a34d1cdc059f5169c3c39754c6710127",
  "anchors.ts": "0c1504ff42fdd49b1d320fae4d8eafbf969a5dadb7d867cdc8fb81d737242453",
  "contracts.ts": "f1a6eaf8ad1d4b532ccb509b287991668ce8368a0167cd9e8bf83c2dea727f10",
  "database.ts": "18ea9fa1d0a5f7e215429d5fc563dcd166314e1ce8f96fe6a0350c93dabe6558",
  "dispatch.ts": "1d4a07bfc627840b125c7eca6ed8f04ee433a39cb3de29728950b34c29c3bc40",
  "host.ts": "5d8db59386fabeda32bb65b4db97e13aa03d5bf98adf7d91b67077d37dd618a2",
  "markdown.ts": "ab04e2573e426cbb0aad7975eafbb058db1a5e29355c35df485253ebd6a7520b",
  "render-source.ts": "200645c447550f5a33b472f4c6962a272b574ee23a2a74f59572d8a69c9cd2d0",
  "source.ts": "0e36085e06fa41f3dd5107e13ce7a5296cb037ddc2c009c7228adec226e76a60",
  "store.ts": "f8a2977d1376c43c3e576c8c471433c1c77083bc40ebd79a1f663162d4a2d5ff",
  "validation.ts": "6520c981ea388f70e0278cf73583e0c80871aa346b2abd50dab3003d90c9d1a8"
};
export function installCodeReviewFixture(workspace: string) {
  const root = process.env.DURABLE_ADDONS_ROOT;
  if (!root) throw Error("DURABLE_ADDONS_ROOT required: reviewed candidate worktree, never live packages");
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-code-review");
  mkdirSync(pkg, { recursive: true });
  for (const [file, expected] of Object.entries(codeReviewPins)) {
    const source = join(root, "addons/code-review", file);
    if (createHash("sha256").update(readFileSync(source)).digest("hex") !== expected) throw Error("Code Review candidate digest mismatch: " + file);
    copyFileSync(source, join(pkg, file));
  }
  copyFileSync(join(root, "addons/code-review/package.json"), join(pkg, "package.json"));
  symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
  return pkg;
}
