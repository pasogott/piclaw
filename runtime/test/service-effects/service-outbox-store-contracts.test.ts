import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  NormalisedEffectTrace,
  NormalisedTraceInput,
} from "../../src/service-effects/contracts/common.js";
import { installServiceOutboxSchema } from "../../src/service-effects/current-piclaw/service-outbox-schema.js";
import {
  createCurrentPiclawServiceOutboxStore,
  type ServiceOutboxAdapterRuntime,
} from "../../src/service-effects/current-piclaw/service-outbox-store.js";
import type {
  ContractSubjectFactory,
  ContractTestContext,
} from "../../src/service-effects/testing/contract-suite.js";
import {
  defineServiceOutboxStoreContract,
  type ServiceOutboxContractSubject,
  type ServiceOutboxMutationMethod,
} from "../../src/service-effects/testing/contract-suites/service-outbox-store-contract.js";
import {
  ManualEffectClock,
  SequenceEffectIdSource,
} from "../../src/service-effects/testing/deterministic-controls.js";
import { FakeServiceOutboxStore } from "../../src/service-effects/testing/fakes/fake-service-outbox-store.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { EffectTraceRecorder } from "../../src/service-effects/testing/trace-recorder.js";

function context(): ContractTestContext {
  return {
    clock: new ManualEffectClock("2026-08-13T09:00:00.000Z"),
    ids: new SequenceEffectIdSource("s05"),
    faults: new DeterministicFaultPlan(),
  };
}
class Runtime implements ServiceOutboxAdapterRuntime {
  readonly trace: EffectTraceRecorder;
  readonly faults = new Map<string, Set<number>>();
  readonly counts = new Map<string, number>();
  constructor(
    private readonly ctx: ContractTestContext,
    snapshot: readonly NormalisedEffectTrace[] = [],
  ) {
    this.trace = EffectTraceRecorder.fromSnapshot(snapshot);
  }
  plan(method: string, point: string, occurrence: number) {
    const k = `${method}:${point}`,
      n = this.counts.get(k) ?? 0;
    this.faults.set(k, new Set([n + occurrence]));
  }
  hitFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
    method: ServiceOutboxMutationMethod,
  ) {
    const key = `${method}:${point}`;
    const occurrence = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, occurrence);
    const planned = this.faults.get(key);
    if (planned?.has(occurrence)) {
      return point === "before_effect" && occurrence > 1
        ? "in_transaction"
        : true;
    }
    return this.ctx.faults.hit(point);
  }
  recordTrace(input: NormalisedTraceInput) {
    if (input.resultTag === "call") this.trace.recordCall(input);
    else this.trace.recordResult(input);
  }
}
interface SqliteSubject extends ServiceOutboxContractSubject {
  database: Database;
  path: string;
  runtime: Runtime;
  ownsDirectory: boolean;
}
function sqliteSubject(
  path: string,
  ctx: ContractTestContext,
  trace: readonly NormalisedEffectTrace[] = [],
  ownsDirectory = true,
): SqliteSubject {
  const database = new Database(path, { strict: true });
  database.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000",
  );
  installServiceOutboxSchema(database);
  const runtime = new Runtime(ctx, trace),
    made = createCurrentPiclawServiceOutboxStore(database, runtime);
  if (!made.ok) throw new Error("construction");
  return {
    database,
    path,
    runtime,
    ownsDirectory,
    store: made.value,
    planFault: (m, p, o) => runtime.plan(m, p, o),
    dispose() {
      if (database.open) database.close();
      if (this.ownsDirectory) {
        rmSync(dirname(path), { recursive: true, force: true });
      }
    },
  };
}
const sqliteFactory: ContractSubjectFactory<ServiceOutboxContractSubject> = {
  name: "current-piclaw-service-outbox",
  create(ctx) {
    const dir = mkdtempSync(join(tmpdir(), "piclaw-s05-"));
    return sqliteSubject(join(dir, "store.sqlite"), ctx);
  },
  crashAndRestore(subject, ctx) {
    const old = subject as SqliteSubject,
      trace = old.runtime.trace.snapshot();
    const fresh = sqliteSubject(old.path, ctx, trace, true);
    old.ownsDirectory = false;
    old.database.close();
    fresh.runtime.faults.clear();
    fresh.runtime.counts.clear();
    return { subject: fresh, context: ctx };
  },
  inspectTrace(subject) {
    return (subject as SqliteSubject).runtime.trace.inspect();
  },
};
const fakeFactory: ContractSubjectFactory<ServiceOutboxContractSubject> = {
  name: "fake-service-outbox",
  create(ctx) {
    const store = new FakeServiceOutboxStore(ctx);
    return { store, planFault: (m, p, o) => store.planFault(m, p, o) };
  },
  crashAndRestore(subject, ctx) {
    const old = subject.store as FakeServiceOutboxStore,
      store = new FakeServiceOutboxStore(ctx);
    store.restore(old.snapshot());
    return {
      subject: { store, planFault: (m, p, o) => store.planFault(m, p, o) },
      context: ctx,
    };
  },
  inspectTrace(subject) {
    return (subject.store as FakeServiceOutboxStore).trace.inspect();
  },
};
describe("EF-S05 ServiceOutboxStore shared contract", () => {
  test("isolated SQLite adapter", async () => {
    expect(
      await defineServiceOutboxStoreContract(sqliteFactory, context),
    ).toHaveLength(15);
  });
  test("independent deterministic fake", async () => {
    expect(
      await defineServiceOutboxStoreContract(fakeFactory, context),
    ).toHaveLength(15);
  });
});
describe("EF-S05 private schema", () => {
  test("installer is explicit idempotent and atomic", () => {
    const db = new Database(":memory:", { strict: true });
    expect(
      (
        db
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_s05_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    installServiceOutboxSchema(db);
    installServiceOutboxSchema(db);
    const names = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_s05_%' ORDER BY name",
      )
      .all() as { name: string }[];
    expect(names.map((x) => x.name)).toEqual([
      "service_effect_s05_decisions",
      "service_effect_s05_leases",
      "service_effect_s05_outbox",
      "service_effect_s05_outcomes",
      "service_effect_s05_resolutions",
    ]);
    db.close();
  });
  test("failed install rolls back all tables", () => {
    const db = new Database(":memory:", { strict: true });
    db.exec("CREATE VIEW service_effect_s05_outbox AS SELECT 1 value");
    expect(() => installServiceOutboxSchema(db)).toThrow();
    expect(
      (
        db
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_s05_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    db.close();
  });
});
