import "./test-guard.js";
import { acceptedSteerFixture } from "./accepted-steer-recovery-fixture.js";
import { assertPathWithinTestFilesystemIsolation } from "../../../runtime/scripts/test-filesystem-isolation.js";
if (process.argv.length !== 5 || process.argv[2] !== "--accepted-steer-crash") throw Error("fixture arguments required");
const dir = process.argv[3]!, boundary = process.argv[4]!;
assertPathWithinTestFilesystemIsolation(dir, process.env, { allowRoot: false });
if (boundary !== "before-submit" && boundary !== "committed-ack-lost") throw Error("invalid boundary");
const f = await acceptedSteerFixture(dir,boundary);
const { primary, primaryId, b } = await f.prepare();
const intent = JSON.parse((f.db.query("SELECT input FROM recovery_fixture_identity WHERE id=?").get(f.incarnation) as {input:string}).input);
const candidate = await f.candidateStorage!.submissionByRequest(f.base.root.id,intent.requestId, (await import("./fixture.js")).context);
if (boundary === "committed-ack-lost" ? !candidate || candidate.id !== f.committedIntentId : candidate !== undefined) throw Error("checkpoint not committed");
console.log(JSON.stringify({ event: "accepted-steer-committed", generation: f.generation, intentSourceId: f.intentSourceId, primary, primaryId, b, committedIntentId: f.committedIntentId, intent, candidate, modelCalls: f.base.host.modelCalls, effects: f.base.host.effects }));
// Deliberately retain root DB, candidate DB and live lease until the parent SIGKILLs us.
await new Promise(() => { setInterval(() => {},1000); });
