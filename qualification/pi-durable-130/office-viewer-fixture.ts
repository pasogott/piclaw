import { mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export function installOfficeViewerFixture(workspace: string) {
  const source = process.env.DURABLE_ADDONS_ROOT;
  if (!source) throw Error("DURABLE_ADDONS_ROOT required (unchanged installed office-viewer)");
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-office-viewer");
  mkdirSync(pkg, { recursive: true });
  for (const [file, hash] of Object.entries({
    "index.ts": "71ea2d50f2e2e77ca600dd18b530f680bb0efaf024572b0e2f8b75c9e41828b0",
    "package.json": "fe62110bc5f59674973065afee279f34f7e0ff1cfc078718f8fad14a5973b155",
  })) {
    const path = join(source, "addons/office-viewer", file);
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== hash) throw Error(`Unapproved Office fixture ${file}`);
    copyFileSync(path, join(pkg, file));
  }
  return pkg;
}
