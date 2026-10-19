import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
const pins = {
  "index.ts": "060bc08a11a95b37f757cda9b3d28a96f5e5abeeff4e29fd6a1b44f02b056a71",
  "deadline-checkpoint.ts": "e94f7cb065f321b06de33bfd7963011f03714c73437eedab634bce69f199c1db",
  "compat/chat-context.ts": "90e20fa38d72915a7cbf4eea4e4134788271e6eb52dfbcb813df05b6d60c3c44",
  "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
  "package.json": "3b0d398e8e5b2b848f39b3c4273d357bb3638c19ce8c7070a2f562813dcfa974"
};
export function installGoalFixture(dir: string): string {
  const source = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!source) throw Error("DURABLE_GOAL_ADDON_ROOT required");
  const pkg = join(dir, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-goal");
  for (const [file, expected] of Object.entries(pins)) {
    const bytes = readFileSync(join(source, "addons/goal", file));
    if (createHash("sha256").update(bytes).digest("hex") !== expected) throw Error("Goal fixture source changed");
    const target = join(pkg, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  symlinkSync(join(source, "node_modules"), join(pkg, "node_modules"), "dir");
  return pkg;
}
