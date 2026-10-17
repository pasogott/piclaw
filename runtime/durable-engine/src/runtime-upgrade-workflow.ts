// Explicit, bounded application-owned workflow. No production selector or activation.
import type { Context } from "@earendil-works/chord/context";
import { buildSessionContext, convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { RuntimeMigrationPreparation } from "../../src/runtime/bootstrap.js";
import { prepareCopiedApplicationUpgrade } from "./copied-upgrade.js";
import { upgradeApplication, type ApplicationUpgradeOptions } from "./application-upgrade.js";

type Application = ApplicationUpgradeOptions["application"];
export interface RuntimeUpgradeWorkflowOptions {
  preparation: RuntimeMigrationPreparation;
  cutover: ApplicationUpgradeOptions["cutover"];
  application: Omit<Application, "runtime"> & { runtime: Omit<Application["runtime"], "sessionId"> };
  /** Open the existing owned, paused SDK importer only AFTER complete preflight. */
  openImporter(): Promise<ApplicationUpgradeOptions["importer"]>;
}

/** Exactly ONE captured source session, including ALL its chat branches/leaves.
 * Multiple sources or any unselected file (including historic files) are explicitly
 * unsupported, not an automatic whole-installation/all-chats migration. No partial
 * selection, invented generation, multidomain journal, legacy restart or owner release.
 * Failure retains the real bootstrap hold for caller-directed recovery/shutdown.
 * Source files remain read-only backups. External writers bypassing the actual host
 * ownership/admission fence are unsupported; this is not an atomic filesystem lock. */
export async function upgradeCapturedRuntime(options: RuntimeUpgradeWorkflowOptions, context: Context) {
  const preparation = options.preparation;
  const capture = preparation.capture.bind(preparation);
  const admission = preparation.assertAdmissionGuard.bind(preparation);
  const fence = preparation.coordinator.assertSealedAndDrained.bind(preparation.coordinator);
  const openImporter = options.openImporter.bind(options);
  const cutover = options.cutover;
  const application = { ...options.application, runtime: { ...options.application.runtime } };
  admission(); fence();
  const captured = await capture();
  admission(); captured.revalidate();
  if (captured.inputs.length !== 1 || captured.unselectedSourcePaths.length !== 0)
    throw Error("Unsupported runtime upgrade inventory: exactly one captured source and no unselected history required");
  if (captured.migrationIncarnation !== application.runtime.incarnation)
    throw Error("Runtime upgrade incarnation conflict");
  const sessions = new Set(captured.identities.map(identity => identity.originalSessionId));
  if (sessions.size !== 1) throw Error("Unsupported runtime upgrade source sessions");
  const sessionId = captured.identities[0]!.originalSessionId;
  const input = captured.inputs[0]!;
  const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const plan = prepareCopiedApplicationUpgrade(Buffer.from(input.sourceJSONL), Buffer.from(input.manifestJSON), input.expected,
    (entries, leaf) => ({ messages: json(convertToLlm(buildSessionContext([...entries], leaf).messages)),
      projected: entries.map(entry => ({ sourceEntryId: entry.id,
        messages: json(convertToLlm(sessionEntryToContextMessages(entry))) })) }));
  plan.assertApplicationScope(application.runtime.incarnation, sessionId);
  plan.assertApplicationBranches(application.root);
  cutover.inspectApplication(application.root, application.runtime.incarnation, plan.request);
  captured.revalidate(); admission();
  // upgradeApplication owns importer/bundle cleanup, including failed validation
  // after the open await. It never releases the preparation or global owner.
  return upgradeApplication({ plan, cutover, application: { ...application,
    runtime: { ...application.runtime, sessionId } }, importer: await openImporter(),
    validatePreparation: captured.revalidateForUpgrade, assertAdmissionGuard: admission }, context);
}
