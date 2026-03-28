import Database from "better-sqlite3";
import { Client } from "pg";

type UserSettingsRow = {
  id: number;
  passwordHash: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobRow = {
  id: number;
  name: string;
  nameKey: string;
  description: string | null;
  isArchived: number | boolean;
  workStart: string;
  workEnd: string;
  workDays: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectRow = {
  id: number;
  name: string;
  nameKey: string;
  description: string | null;
  isArchived: number | boolean;
  jobId: number;
  createdAt: string;
  updatedAt: string;
};

type BreakTypeRow = {
  id: number;
  name: string;
  type: string;
  duration: number | null;
  isOneTime: number | boolean;
  isActive: number | boolean;
  jobId: number;
  createdAt: string;
  updatedAt: string;
};

type TaskRow = {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  elapsedSeconds: number;
  completionOutput: string | null;
  cancellationReason: string | null;
  logNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

type SubTaskRow = {
  id: number;
  taskId: number;
  title: string;
  isCompleted: number | boolean;
  createdAt: string;
  updatedAt: string;
};

type TaskEventRow = {
  id: number;
  taskId: number;
  eventType: string;
  eventAt: string;
  meta: string | null;
};

function resolveSqlitePath(url: string): string {
  if (!url.startsWith("file:")) {
    throw new Error("DATABASE_URL_SQLITE must use file: URL format.");
  }

  let path = url.slice("file:".length);
  if (path.startsWith("//")) {
    path = path.slice(2);
  }
  return path;
}

async function main() {
  const sqliteUrl = process.env.DATABASE_URL_SQLITE || "file:./dev.db";
  const postgresUrl = process.env.DATABASE_URL_POSTGRES;

  if (!postgresUrl) {
    throw new Error("DATABASE_URL_POSTGRES is required.");
  }

  const sqlitePath = resolveSqlitePath(sqliteUrl);
  const sqlite = new Database(sqlitePath, { readonly: true });
  const pg = new Client({ connectionString: postgresUrl });

  await pg.connect();

  const tables = [
    '"TaskEvent"',
    '"SubTask"',
    '"Task"',
    '"BreakType"',
    '"Project"',
    '"Job"',
    '"UserSettings"',
  ];

  try {
    await pg.query("BEGIN");
    await pg.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);

    const userSettings = sqlite
      .prepare("SELECT id, passwordHash, createdAt, updatedAt FROM UserSettings")
      .all() as UserSettingsRow[];
    for (const row of userSettings) {
      await pg.query(
        'INSERT INTO "UserSettings" (id, "passwordHash", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4)',
        [row.id, row.passwordHash, row.createdAt, row.updatedAt],
      );
    }

    const jobs = sqlite
      .prepare("SELECT id, name, nameKey, description, isArchived, workStart, workEnd, workDays, createdAt, updatedAt FROM Job")
      .all() as JobRow[];
    for (const row of jobs) {
      await pg.query(
        'INSERT INTO "Job" (id, name, "nameKey", description, "isArchived", "workStart", "workEnd", "workDays", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)',
        [
          row.id,
          row.name,
          row.nameKey,
          row.description,
          Boolean(row.isArchived),
          row.workStart,
          row.workEnd,
          typeof row.workDays === "string" ? row.workDays : JSON.stringify(row.workDays),
          row.createdAt,
          row.updatedAt,
        ],
      );
    }

    const projects = sqlite
      .prepare("SELECT id, name, nameKey, description, isArchived, jobId, createdAt, updatedAt FROM Project")
      .all() as ProjectRow[];
    for (const row of projects) {
      await pg.query(
        'INSERT INTO "Project" (id, name, "nameKey", description, "isArchived", "jobId", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          row.id,
          row.name,
          row.nameKey,
          row.description,
          Boolean(row.isArchived),
          row.jobId,
          row.createdAt,
          row.updatedAt,
        ],
      );
    }

    const breaks = sqlite
      .prepare("SELECT id, name, type, duration, isOneTime, isActive, jobId, createdAt, updatedAt FROM BreakType")
      .all() as BreakTypeRow[];
    for (const row of breaks) {
      await pg.query(
        'INSERT INTO "BreakType" (id, name, type, duration, "isOneTime", "isActive", "jobId", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          row.id,
          row.name,
          row.type,
          row.duration,
          Boolean(row.isOneTime),
          Boolean(row.isActive),
          row.jobId,
          row.createdAt,
          row.updatedAt,
        ],
      );
    }

    const tasks = sqlite
      .prepare(
        "SELECT id, projectId, title, description, status, startedAt, endedAt, elapsedSeconds, completionOutput, cancellationReason, logNotes, createdAt, updatedAt FROM Task",
      )
      .all() as TaskRow[];
    for (const row of tasks) {
      await pg.query(
        'INSERT INTO "Task" (id, "projectId", title, description, status, "startedAt", "endedAt", "elapsedSeconds", "completionOutput", "cancellationReason", "logNotes", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5::"TaskStatus",$6,$7,$8,$9,$10,$11,$12,$13)',
        [
          row.id,
          row.projectId,
          row.title,
          row.description,
          row.status,
          row.startedAt,
          row.endedAt,
          row.elapsedSeconds,
          row.completionOutput,
          row.cancellationReason,
          row.logNotes,
          row.createdAt,
          row.updatedAt,
        ],
      );
    }

    const subtasks = sqlite
      .prepare("SELECT id, taskId, title, isCompleted, createdAt, updatedAt FROM SubTask")
      .all() as SubTaskRow[];
    for (const row of subtasks) {
      await pg.query(
        'INSERT INTO "SubTask" (id, "taskId", title, "isCompleted", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6)',
        [row.id, row.taskId, row.title, Boolean(row.isCompleted), row.createdAt, row.updatedAt],
      );
    }

    const events = sqlite
      .prepare("SELECT id, taskId, eventType, eventAt, meta FROM TaskEvent")
      .all() as TaskEventRow[];
    for (const row of events) {
      await pg.query(
        'INSERT INTO "TaskEvent" (id, "taskId", "eventType", "eventAt", meta) VALUES ($1,$2,$3::"TaskEventType",$4,$5::jsonb)',
        [
          row.id,
          row.taskId,
          row.eventType,
          row.eventAt,
          row.meta ? (typeof row.meta === "string" ? row.meta : JSON.stringify(row.meta)) : null,
        ],
      );
    }

    await pg.query('SELECT setval(pg_get_serial_sequence(' + "'\"UserSettings\"'" + ", 'id'), COALESCE((SELECT MAX(id) FROM \"UserSettings\"), 1), true)");
    await pg.query('SELECT setval(pg_get_serial_sequence(' + "'\"Job\"'" + ", 'id'), COALESCE((SELECT MAX(id) FROM \"Job\"), 1), true)");
    await pg.query('SELECT setval(pg_get_serial_sequence(' + "'\"Project\"'" + ", 'id'), COALESCE((SELECT MAX(id) FROM \"Project\"), 1), true)");
    await pg.query('SELECT setval(pg_get_serial_sequence(' + "'\"BreakType\"'" + ", 'id'), COALESCE((SELECT MAX(id) FROM \"BreakType\"), 1), true)");
    await pg.query('SELECT setval(pg_get_serial_sequence(' + "'\"Task\"'" + ", 'id'), COALESCE((SELECT MAX(id) FROM \"Task\"), 1), true)");
    await pg.query('SELECT setval(pg_get_serial_sequence(' + "'\"SubTask\"'" + ", 'id'), COALESCE((SELECT MAX(id) FROM \"SubTask\"), 1), true)");
    await pg.query('SELECT setval(pg_get_serial_sequence(' + "'\"TaskEvent\"'" + ", 'id'), COALESCE((SELECT MAX(id) FROM \"TaskEvent\"), 1), true)");

    await pg.query("COMMIT");

    console.log("SQLite data migrated successfully to PostgreSQL.");
  } catch (error) {
    await pg.query("ROLLBACK");
    console.error("Migration failed:", error);
    process.exitCode = 1;
  } finally {
    sqlite.close();
    await pg.end();
  }
}

void main();
