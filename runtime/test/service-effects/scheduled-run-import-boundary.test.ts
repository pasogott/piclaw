import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as scheduledRunModule from "../../src/service-effects/current-piclaw/scheduled-run-store.js";

describe("EF-S07 latent import boundary", () => {
  test("fake is independent and no production scheduler or task surface activates EF-S07", () => {
    const root = join(import.meta.dir, "../..");
    for (const relative of ["src/service-effects/testing/fakes/fake-scheduled-run-store.ts", "src/service-effects/testing/fakes/fake-scheduled-run-values.ts"]) {
      const fake = readFileSync(join(root, relative), "utf8");
      expect(fake).not.toContain("bun:sqlite");
      expect(fake).not.toContain("current-piclaw/");
    }
    expect(Object.keys(scheduledRunModule)).not.toContain("CurrentPiclawScheduledRunStore");
    const adapter = readFileSync(join(root, "src/service-effects/current-piclaw/scheduled-run-store.ts"), "utf8");
    expect(adapter).toContain("private constructor(");
    expect(adapter).not.toContain("export class CurrentPiclawScheduledRunStore");
    for (const relative of [
      "src/index.ts",
      "src/db/connection.ts",
      "src/db/tasks.ts",
      "src/task-scheduler.ts",
      "src/task-scheduler-utils.ts",
      "src/queue.ts",
      "src/extensions/scheduled-tasks.ts",
      "src/scheduled-task-query-service.ts",
    ]) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source).not.toContain("scheduled-run-store");
      expect(source).not.toContain("ScheduledRunStore");
      expect(source).not.toContain("service_effect_s07");
    }
  });
});
