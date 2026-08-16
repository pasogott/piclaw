import type Database from "bun:sqlite";

import type {
  ScheduledTaskAuthority,
  ScheduledTaskAuthorityInput,
  ScheduledTaskSnapshot,
  UpdateScheduledTaskAuthorityRequest,
} from "../contracts/scheduled-run-store.js";
import {
  decodeTaskSnapshot,
  makeTaskSnapshot,
  normaliseTaskAuthorityInput,
  normaliseTaskUpdate,
} from "./scheduled-run-values.js";

const TASKS = "service_effect_s07_tasks";
const REVISIONS = "service_effect_s07_task_revisions";

function verify(database: Database): void {
  const row = database.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(TASKS) as { name?: string } | undefined;
  if (row?.name !== TASKS) throw new Error("EF-S07 task authority schema is unavailable.");
}

function decodeJson(value: unknown): ScheduledTaskSnapshot {
  if (typeof value !== "string") throw new Error("EF-S07 task snapshot is corrupt.");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("EF-S07 task snapshot is corrupt."); }
  const snapshot = decodeTaskSnapshot(parsed);
  if (!snapshot) throw new Error("EF-S07 task snapshot is corrupt.");
  return snapshot;
}

/** Explicit isolated setup seam; production task management does not import it. */
export function createScheduledTaskAuthority(database: Database): ScheduledTaskAuthority {
  verify(database);
  return Object.freeze({
    create(input: ScheduledTaskAuthorityInput): ScheduledTaskSnapshot {
      const closed = normaliseTaskAuthorityInput(input);
      if (!closed) throw new TypeError("Invalid EF-S07 task authority input.");
      const snapshot = makeTaskSnapshot(closed, 1);
      database.transaction(() => {
        database.query(
          `INSERT INTO ${TASKS}(task_id,current_revision,status,next_run_at,created_at,updated_at) VALUES(?,1,'active',?,?,?)`,
        ).run(closed.taskId, closed.nextRunAt, closed.authoredAt, closed.authoredAt);
        database.query(
          `INSERT INTO ${REVISIONS}(task_id,revision,config_hash,snapshot_json,authored_at) VALUES(?,?,?,?,?)`,
        ).run(closed.taskId, 1, snapshot.configHash, JSON.stringify(snapshot), closed.authoredAt);
      }).immediate();
      return snapshot;
    },

    update(input: UpdateScheduledTaskAuthorityRequest): ScheduledTaskSnapshot {
      const closed = normaliseTaskUpdate(input);
      if (!closed) throw new TypeError("Invalid EF-S07 task authority update.");
      const revision = closed.expectedRevision + 1;
      const snapshot = makeTaskSnapshot(closed, revision);
      database.transaction(() => {
        const current = database.query(
          `SELECT current_revision,status FROM ${TASKS} WHERE task_id=?`,
        ).get(closed.taskId) as { current_revision: number; status: string } | undefined;
        if (!current) throw new Error("EF-S07 task authority not found.");
        if (current.current_revision !== closed.expectedRevision) throw new Error("EF-S07 task revision mismatch.");
        if (current.status === "deleted") throw new Error("EF-S07 deleted task cannot be revised.");
        database.query(
          `INSERT INTO ${REVISIONS}(task_id,revision,config_hash,snapshot_json,authored_at) VALUES(?,?,?,?,?)`,
        ).run(closed.taskId, revision, snapshot.configHash, JSON.stringify(snapshot), closed.authoredAt);
        const changed = database.query(
          `UPDATE ${TASKS} SET current_revision=?,status='active',next_run_at=?,updated_at=? WHERE task_id=? AND current_revision=? AND status<>'deleted'`,
        ).run(revision, closed.nextRunAt, closed.authoredAt, closed.taskId, closed.expectedRevision);
        if (changed.changes !== 1) throw new Error("EF-S07 task revision mismatch.");
      }).immediate();
      return snapshot;
    },

    pause(taskId: string): void {
      const changed = database.query(
        `UPDATE ${TASKS} SET status='paused' WHERE task_id=? AND status='active'`,
      ).run(taskId);
      if (changed.changes !== 1) throw new Error("EF-S07 active task authority not found.");
    },

    resume(taskId: string): void {
      database.transaction(() => {
        const task = database.query(
          `SELECT current_revision,next_run_at,status FROM ${TASKS} WHERE task_id=?`,
        ).get(taskId) as { current_revision: number; next_run_at: string | null; status: string } | undefined;
        if (!task || task.status !== "paused") throw new Error("EF-S07 paused task authority not found.");
        const held = database.query(
          `SELECT computed_next_run_at FROM service_effect_s07_next_decisions WHERE task_id=? AND task_revision=? AND head_disposition='paused' ORDER BY scheduled_for DESC LIMIT 1`,
        ).get(taskId, task.current_revision) as { computed_next_run_at: string | null } | undefined;
        const nextRunAt = held ? held.computed_next_run_at : task.next_run_at;
        database.query(
          `UPDATE ${TASKS} SET status=?,next_run_at=? WHERE task_id=? AND current_revision=? AND status='paused'`,
        ).run(nextRunAt === null ? "completed" : "active", nextRunAt, taskId, task.current_revision);
      }).immediate();
    },

    delete(taskId: string): void {
      const changed = database.query(
        `UPDATE ${TASKS} SET status='deleted',next_run_at=NULL WHERE task_id=? AND status<>'deleted'`,
      ).run(taskId);
      if (changed.changes !== 1) throw new Error("EF-S07 task authority not found.");
    },

    get(taskId: string): ScheduledTaskSnapshot | null {
      const row = database.query(
        `SELECT r.snapshot_json FROM ${TASKS} t JOIN ${REVISIONS} r ON r.task_id=t.task_id AND r.revision=t.current_revision WHERE t.task_id=?`,
      ).get(taskId) as { snapshot_json: string } | undefined;
      return row ? decodeJson(row.snapshot_json) : null;
    },
  });
}
