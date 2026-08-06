import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

type CompatRecord = Record<string, unknown>;
type RegistryWithMutableRefresh = Pick<ModelRegistry, "getAll"> & {
  refresh?: ModelRegistry["refresh"];
  modelRuntime?: ModelRuntime;
  [legacySessionAffinityCompatInstalled]?: true;
};
type MutableModelRuntime = ModelRuntime & {
  [legacySessionAffinityRuntimeCompatInstalled]?: true;
};

const legacySessionAffinityCompatInstalled = Symbol("piclaw.legacySessionAffinityCompatInstalled");
const legacySessionAffinityRuntimeCompatInstalled = Symbol("piclaw.legacySessionAffinityRuntimeCompatInstalled");

export interface LegacySessionAffinityMigration {
  provider: string;
  modelId: string;
  previous: boolean;
  sessionAffinityFormat: "openai" | "openai-nosession";
}

/**
 * Preserve the pre-0.80.7 `sendSessionIdHeader` models.json behavior in memory.
 *
 * Pi 0.80.7 deliberately stopped reading that field. Piclaw keeps old user
 * configuration effective without rewriting models.json (and therefore without
 * destroying JSONC comments); the warning tells operators how to migrate the
 * persisted configuration explicitly.
 */
export function applyLegacySessionAffinityCompatibility(
  models: Model<Api>[],
): LegacySessionAffinityMigration[] {
  const migrations: LegacySessionAffinityMigration[] = [];
  for (const model of models) {
    const compat = model.compat as CompatRecord | undefined;
    if (!compat || typeof compat.sendSessionIdHeader !== "boolean") continue;
    if (typeof compat.sessionAffinityFormat === "string") continue;

    const previous = compat.sendSessionIdHeader;
    const sessionAffinityFormat = previous ? "openai" : "openai-nosession";
    compat.sessionAffinityFormat = sessionAffinityFormat;
    migrations.push({ provider: model.provider, modelId: model.id, previous, sessionAffinityFormat });
  }
  return migrations;
}

function warnOnceForMigrations(
  migrations: LegacySessionAffinityMigration[],
  warned: Set<string>,
  onWarn: (message: string, details: Record<string, unknown>) => void,
): void {
  for (const migration of migrations) {
    const key = `${migration.provider}/${migration.modelId}`;
    if (warned.has(key)) continue;
    warned.add(key);
    onWarn("Migrated legacy model session-affinity compatibility in memory", {
      operation: "model_registry.legacy_session_affinity_compat",
      model: key,
      legacyField: "compat.sendSessionIdHeader",
      legacyValue: migration.previous,
      replacementField: "compat.sessionAffinityFormat",
      replacementValue: migration.sessionAffinityFormat,
    });
  }
}

function installRuntimeReadCompatibility(
  runtime: ModelRuntime,
  warned: Set<string>,
  onWarn: (message: string, details: Record<string, unknown>) => void,
): void {
  const mutable = runtime as MutableModelRuntime;
  if (mutable[legacySessionAffinityRuntimeCompatInstalled]) return;

  const decorate = <T extends readonly Model<Api>[]>(models: T): T => {
    warnOnceForMigrations(applyLegacySessionAffinityCompatibility(models as unknown as Model<Api>[]), warned, onWarn);
    return models;
  };
  const originalGetModels = runtime.getModels.bind(runtime);
  const originalGetModel = runtime.getModel.bind(runtime);
  const originalGetAvailable = runtime.getAvailable.bind(runtime);
  const originalGetAvailableSnapshot = runtime.getAvailableSnapshot.bind(runtime);

  runtime.getModels = ((providerId?: string) => decorate(originalGetModels(providerId))) as ModelRuntime["getModels"];
  runtime.getModel = ((providerId: string, modelId: string) => {
    const model = originalGetModel(providerId, modelId);
    if (model) decorate([model]);
    return model;
  }) as ModelRuntime["getModel"];
  runtime.getAvailable = (async (providerId?: string) => decorate(await originalGetAvailable(providerId))) as ModelRuntime["getAvailable"];
  runtime.getAvailableSnapshot = (() => decorate(originalGetAvailableSnapshot())) as ModelRuntime["getAvailableSnapshot"];
  mutable[legacySessionAffinityRuntimeCompatInstalled] = true;
}

/** Apply the compatibility migration initially and after every registry refresh. */
export function installLegacySessionAffinityCompatibility(
  registry: ModelRegistry,
  onWarn: (message: string, details: Record<string, unknown>) => void,
): void {
  const mutable = registry as RegistryWithMutableRefresh;
  if (mutable[legacySessionAffinityCompatInstalled]) return;

  const warned = new Set<string>();
  const apply = () => warnOnceForMigrations(
    applyLegacySessionAffinityCompatibility(mutable.getAll() as Model<Api>[]),
    warned,
    onWarn,
  );

  if (mutable.modelRuntime) {
    // ModelRuntime composes fresh model objects on reads. Decorate its public
    // read boundary instead of registering an overlay that would own/freeze a
    // provider catalog and interfere with models.json or other extensions.
    installRuntimeReadCompatibility(mutable.modelRuntime, warned, onWarn);
  } else {
    const originalRefresh = typeof mutable.refresh === "function"
      ? mutable.refresh.bind(mutable)
      : null;
    if (originalRefresh) {
      mutable.refresh = (async (...args: Parameters<ModelRegistry["refresh"]>) => {
        const result = await originalRefresh(...args);
        apply();
        return result;
      }) as ModelRegistry["refresh"];
    }
  }
  mutable[legacySessionAffinityCompatInstalled] = true;
  apply();
}
