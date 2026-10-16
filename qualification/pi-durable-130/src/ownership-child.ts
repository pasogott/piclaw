import "./test-guard.js";
import { SqliteStorage } from "../../../runtime/durable-engine/qualification/sqlite.ts";
import { TestOwner, OwnedSqlite } from "./ownership.js";
import { openFixture, barrier } from "./fixture.js";
import { assertPathWithinTestFilesystemIsolation } from "../../../runtime/scripts/test-filesystem-isolation.js";
if (process.argv.length !== 4 || process.argv[2] !== "--qualification-owner-child") throw new Error("fixture arguments required");
assertPathWithinTestFilesystemIsolation(process.argv[3]!, process.env, { allowRoot: false });
let constructions = 0;
try {
  const owner = TestOwner.acquire(process.argv[3]!);
  const current = await openFixture(owner, () => { constructions++; }, () => SqliteStorage.open(new OwnedSqlite(owner)));
  current.host.modelHold = barrier();
  const submission = await current.submit("crash-pending", "hello");
  console.log(JSON.stringify({ admitted: true, constructions, id: submission.id, modelCalls: current.host.modelCalls }));
  await new Promise(() => { setInterval(() => {}, 1000); });
} catch (error) {
  console.log(JSON.stringify({ admitted: false, constructions, error: String(error) }));
  process.exit(0);
}
