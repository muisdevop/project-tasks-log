import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attendanceListQuerySchema,
  attendanceSchema,
  breakLogSchema,
  breakSchema,
  breakUpdateSchema,
  changePasswordSchema,
  dateWindowFilter,
  decodePageCursor,
  dropField,
  encodePageCursor,
  exportQuerySchema,
  hhmmSchema,
  isPaginationRequested,
  jobCreateSchema,
  jobUpdateSchema,
  keysetAfter,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  listQuerySchema,
  loginSchema,
  projectListQuerySchema,
  projectSchema,
  projectUpdateSchema,
  resolveListLimit,
  settingsSchema,
  subtaskSchema,
  subtaskUpdateSchema,
  taskActionSchema,
  taskCreateSchema,
  taskListQuerySchema,
  textContains,
  toNameKey,
  toSlugKey,
  usesPostgresProvider,
  userProfileSchema,
} from "@/lib/validators";

describe("loginSchema", () => {
  it("accepts and trims a valid login", () => {
    const result = loginSchema.parse({ username: "  admin  ", password: "pw" });
    expect(result).toEqual({ username: "admin", password: "pw" });
  });

  it("rejects blank username (trim then min 1) and empty password", () => {
    expect(loginSchema.safeParse({ username: "   ", password: "pw" }).success).toBe(false);
    expect(loginSchema.safeParse({ username: "admin", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({}).success).toBe(false);
  });

  it("does not trim the password", () => {
    const result = loginSchema.parse({ username: "admin", password: "  pw  " });
    expect(result.password).toBe("  pw  ");
  });
});

describe("hhmmSchema", () => {
  it("accepts valid 24-hour HH:MM times", () => {
    for (const value of ["00:00", "09:30", "19:59", "23:00"]) {
      expect(hhmmSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects out-of-range or malformed times", () => {
    for (const value of ["24:00", "09:60", "9:00", "09:5", "23:5", "abc", "", "0900"]) {
      expect(hhmmSchema.safeParse(value).success).toBe(false);
    }
  });

  it("carries the documented error message", () => {
    const result = hhmmSchema.safeParse("25:00");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Expected HH:MM 24-hour time.");
    }
  });
});

describe("projectSchema / jobCreateSchema", () => {
  it("accepts a trimmed name within the max length and an optional trimmed description", () => {
    expect(projectSchema.parse({ name: "  Alpha  " })).toEqual({ name: "Alpha" });
    expect(jobCreateSchema.parse({ name: "Beta", description: " note " })).toEqual({
      name: "Beta",
      description: "note",
    });
    expect(projectSchema.parse({ name: "A" })).toEqual({ name: "A" });
  });

  it("enforces min 1 / max 120 on name and max 2000 on description", () => {
    expect(projectSchema.safeParse({ name: "" }).success).toBe(false);
    expect(projectSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(projectSchema.safeParse({ name: "x".repeat(120) }).success).toBe(true);
    expect(projectSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
    expect(jobCreateSchema.safeParse({ name: "n", description: "x".repeat(2000) }).success).toBe(
      true,
    );
    expect(jobCreateSchema.safeParse({ name: "n", description: "x".repeat(2001) }).success).toBe(
      false,
    );
  });
});

describe("projectUpdateSchema", () => {
  it("accepts an empty payload and each field on its own", () => {
    expect(projectUpdateSchema.safeParse({}).success).toBe(true);
    expect(projectUpdateSchema.parse({ name: "  Renamed  " })).toEqual({ name: "Renamed" });
    expect(projectUpdateSchema.parse({ description: " note " })).toEqual({
      description: "note",
    });
    expect(projectUpdateSchema.safeParse({ description: "" }).success).toBe(true);
    expect(projectUpdateSchema.safeParse({ description: "x".repeat(2001) }).success).toBe(false);
  });

  it("coerces a stringy jobId the way the create route does", () => {
    expect(projectUpdateSchema.parse({ jobId: "7" })).toEqual({ jobId: 7 });
    expect(projectUpdateSchema.parse({ jobId: 7 })).toEqual({ jobId: 7 });
  });

  it("rejects non-positive, fractional and unparseable jobIds", () => {
    for (const jobId of [0, -3, 1.5, "abc", "", null]) {
      expect(projectUpdateSchema.safeParse({ jobId }).success).toBe(false);
    }
  });

  it("still enforces the name rules when a name is present", () => {
    expect(projectUpdateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(projectUpdateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(projectUpdateSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
  });

  it("drops unknown fields instead of trusting them", () => {
    expect(projectUpdateSchema.parse({ name: "A", isArchived: true })).toEqual({ name: "A" });
  });
});

describe("jobUpdateSchema", () => {
  it("is fully partial", () => {
    expect(jobUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("validates each optional field independently", () => {
    expect(jobUpdateSchema.safeParse({ name: "renamed" }).success).toBe(true);
    expect(jobUpdateSchema.safeParse({ workStart: "08:00" }).success).toBe(true);
    expect(jobUpdateSchema.safeParse({ workEnd: "8:00" }).success).toBe(false);
    expect(jobUpdateSchema.safeParse({ workDays: [1, 5] }).success).toBe(true);
    expect(jobUpdateSchema.safeParse({ workDays: [] }).success).toBe(false);
    expect(jobUpdateSchema.safeParse({ workDays: [8] }).success).toBe(false);
    expect(jobUpdateSchema.safeParse({ workDays: [1.5] }).success).toBe(false);
    expect(jobUpdateSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("taskCreateSchema", () => {
  const valid = { projectId: 1, title: "T" };

  it("accepts valid payloads and trims the title", () => {
    expect(taskCreateSchema.parse({ ...valid, title: "  T  " }).title).toBe("T");
    expect(
      taskCreateSchema.safeParse({
        ...valid,
        description: "d",
        startedAt: "2026-03-30T10:00:00Z",
        isBreak: true,
      }).success,
    ).toBe(true);
  });

  it("requires a positive integer projectId", () => {
    expect(taskCreateSchema.safeParse({ projectId: 0, title: "T" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ projectId: -1, title: "T" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ projectId: 1.5, title: "T" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "T" }).success).toBe(false);
  });

  it("enforces title bounds and datetime format", () => {
    expect(taskCreateSchema.safeParse({ ...valid, title: "x".repeat(200) }).success).toBe(true);
    expect(taskCreateSchema.safeParse({ ...valid, title: "x".repeat(201) }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...valid, title: " " }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...valid, startedAt: "2026-03-30" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...valid, isBreak: "yes" }).success).toBe(false);
  });
});

describe("taskActionSchema", () => {
  it("accepts only the enumerated actions", () => {
    for (const action of ["complete", "cancel", "resume", "hold", "log-notes"] as const) {
      expect(taskActionSchema.safeParse({ taskId: 1, action }).success).toBe(true);
    }
    expect(taskActionSchema.safeParse({ taskId: 1, action: "delete" }).success).toBe(false);
  });

  it("rejects non-positive or fractional taskId and over-long details/notes", () => {
    expect(taskActionSchema.safeParse({ taskId: 0, action: "hold" }).success).toBe(false);
    expect(taskActionSchema.safeParse({ taskId: 2.5, action: "hold" }).success).toBe(false);
    expect(
      taskActionSchema.safeParse({ taskId: 1, action: "hold", details: "x".repeat(10000) }).success,
    ).toBe(true);
    expect(
      taskActionSchema.safeParse({ taskId: 1, action: "hold", details: "x".repeat(10001) }).success,
    ).toBe(false);
    expect(
      taskActionSchema.safeParse({ taskId: 1, action: "log-notes", notes: "  hi " }).success,
    ).toBe(true);
  });

  it("silently drops elapsedSeconds (server-computed only, SEC-05)", () => {
    const parsed = taskActionSchema.parse({
      taskId: 1,
      action: "complete",
      elapsedSeconds: 999999,
    });
    expect(parsed).not.toHaveProperty("elapsedSeconds");
  });
});

describe("settingsSchema", () => {
  it("requires all three fields with valid values", () => {
    expect(
      settingsSchema.safeParse({ workStart: "09:00", workEnd: "17:00", workDays: [1, 2] }).success,
    ).toBe(true);
    expect(settingsSchema.safeParse({ workStart: "09:00", workEnd: "17:00" }).success).toBe(false);
    expect(settingsSchema.safeParse({ workStart: "0900", workEnd: "17:00", workDays: [1] }).success)
      .toBe(false);
    expect(settingsSchema.safeParse({ workStart: "09:00", workEnd: "17:00", workDays: [] }).success)
      .toBe(false);
    expect(
      settingsSchema.safeParse({ workStart: "09:00", workEnd: "17:00", workDays: [0, 1] }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ workStart: "09:00", workEnd: "17:00", workDays: [1, 8] }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ workStart: "09:00", workEnd: "17:00", workDays: [7] }).success,
    ).toBe(true);
  });
});

describe("changePasswordSchema", () => {
  const base = { currentPassword: "old", newPassword: "newpass", confirmPassword: "newpass" };

  it("accepts matching passwords of valid length", () => {
    expect(changePasswordSchema.safeParse(base).success).toBe(true);
  });

  it("rejects mismatched confirmation with an issue on confirmPassword", () => {
    const result = changePasswordSchema.safeParse({ ...base, confirmPassword: "different" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "confirmPassword");
      expect(issue?.message).toBe("New password and confirmation do not match.");
    }
  });

  it("enforces min 6 / max 128 on the new password and min 1 on current", () => {
    expect(changePasswordSchema.safeParse({ ...base, newPassword: "abcde" }).success).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        ...base,
        newPassword: "x".repeat(128),
        confirmPassword: "x".repeat(128),
      }).success,
    ).toBe(true);
    expect(changePasswordSchema.safeParse({ ...base, newPassword: "x".repeat(129) }).success).toBe(
      false,
    );
    expect(changePasswordSchema.safeParse({ ...base, currentPassword: "" }).success).toBe(false);
  });
});

describe("userProfileSchema", () => {
  it("is partial and trims strings", () => {
    expect(userProfileSchema.safeParse({}).success).toBe(true);
    expect(userProfileSchema.parse({ fullName: "  Ada  " }).fullName).toBe("Ada");
  });

  it("email accepts empty string, valid, and rejects invalid", () => {
    expect(userProfileSchema.safeParse({ email: "" }).success).toBe(true);
    expect(userProfileSchema.safeParse({ email: "  a@b.co " }).success).toBe(true);
    expect(userProfileSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(
      userProfileSchema.safeParse({ email: `${"a".repeat(250)}@b.com` }).success,
    ).toBe(false);
  });

  it("enforces max lengths", () => {
    expect(userProfileSchema.safeParse({ fullName: "x".repeat(120) }).success).toBe(true);
    expect(userProfileSchema.safeParse({ fullName: "x".repeat(121) }).success).toBe(false);
    expect(userProfileSchema.safeParse({ title: "x".repeat(121) }).success).toBe(false);
    expect(userProfileSchema.safeParse({ bio: "x".repeat(2000) }).success).toBe(true);
    expect(userProfileSchema.safeParse({ bio: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("breakSchema / breakUpdateSchema", () => {
  it("applies defaults for isOneTime and isActive", () => {
    const parsed = breakSchema.parse({ name: "Lunch", type: "rest" });
    expect(parsed).toEqual({
      name: "Lunch",
      type: "rest",
      isOneTime: false,
      isActive: true,
    });
  });

  it("validates duration bounds (1..480, optional)", () => {
    expect(breakSchema.safeParse({ name: "L", type: "t", duration: 480 }).success).toBe(true);
    expect(breakSchema.safeParse({ name: "L", type: "t", duration: 481 }).success).toBe(false);
    expect(breakSchema.safeParse({ name: "L", type: "t", duration: 0 }).success).toBe(false);
    expect(breakSchema.safeParse({ name: "L", type: "t", duration: 5.5 }).success).toBe(false);
  });

  it("enforces name and type bounds", () => {
    expect(breakSchema.safeParse({ name: "", type: "t" }).success).toBe(false);
    expect(breakSchema.safeParse({ name: "x".repeat(100), type: "t" }).success).toBe(true);
    expect(breakSchema.safeParse({ name: "x".repeat(101), type: "t" }).success).toBe(false);
    expect(breakSchema.safeParse({ name: "n", type: " " }).success).toBe(false);
    expect(breakSchema.safeParse({ name: "n", type: "x".repeat(51) }).success).toBe(false);
  });

  it("breakUpdateSchema requires a positive id and allows nullable duration", () => {
    expect(breakUpdateSchema.safeParse({ id: 1 }).success).toBe(true);
    expect(breakUpdateSchema.safeParse({ id: 0 }).success).toBe(false);
    expect(breakUpdateSchema.safeParse({ id: 1.5 }).success).toBe(false);
    expect(breakUpdateSchema.safeParse({ id: 1, duration: null }).success).toBe(true);
    expect(breakUpdateSchema.safeParse({ id: 1, duration: 481 }).success).toBe(false);
    expect(breakUpdateSchema.safeParse({ id: 1, isActive: "true" }).success).toBe(false);
  });
});

describe("breakLogSchema", () => {
  const valid = { jobId: 3, name: "Coffee", startedAt: "2026-03-30T10:00:00Z" };

  it("accepts a valid payload and an optional positive projectId", () => {
    expect(breakLogSchema.safeParse(valid).success).toBe(true);
    expect(breakLogSchema.safeParse({ ...valid, projectId: 7 }).success).toBe(true);
  });

  it("rejects missing/invalid jobId, name, and startedAt", () => {
    expect(breakLogSchema.safeParse({ ...valid, jobId: 0 }).success).toBe(false);
    expect(breakLogSchema.safeParse({ ...valid, jobId: -2 }).success).toBe(false);
    expect(breakLogSchema.safeParse({ ...valid, jobId: 1.5 }).success).toBe(false);
    expect(breakLogSchema.safeParse({ ...valid, jobId: undefined }).success).toBe(false);
    expect(breakLogSchema.safeParse({ ...valid, projectId: 0 }).success).toBe(false);
    expect(breakLogSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(breakLogSchema.safeParse({ ...valid, name: "x".repeat(101) }).success).toBe(false);
    expect(breakLogSchema.safeParse({ ...valid, name: "  n  " }).success).toBe(true);
    expect(breakLogSchema.safeParse({ ...valid, startedAt: "2026-03-30T10:00:00" }).success).toBe(
      false,
    );
    expect(breakLogSchema.safeParse({ ...valid, startedAt: "yesterday" }).success).toBe(false);
    expect(breakLogSchema.safeParse({ ...valid, startedAt: undefined }).success).toBe(false);
  });
});

describe("attendanceSchema", () => {
  it("accepts explicit null and absent notes (nullish)", () => {
    expect(attendanceSchema.parse({ jobId: 1, notes: null })).toEqual({ jobId: 1, notes: null });
    expect(attendanceSchema.safeParse({ jobId: 1 }).success).toBe(true);
    expect(attendanceSchema.safeParse({ jobId: 1, notes: undefined }).success).toBe(true);
  });

  it("accepts trimmed strings up to 2000 chars and rejects anything else", () => {
    expect(attendanceSchema.parse({ jobId: 1, notes: "  hi  " }).notes).toBe("hi");
    expect(attendanceSchema.safeParse({ jobId: 1, notes: "x".repeat(2000) }).success).toBe(true);
    expect(attendanceSchema.safeParse({ jobId: 1, notes: "x".repeat(2001) }).success).toBe(false);
    expect(attendanceSchema.safeParse({ jobId: 1, notes: 42 }).success).toBe(false);
    expect(attendanceSchema.safeParse({ jobId: 0 }).success).toBe(false);
    expect(attendanceSchema.safeParse({ jobId: 1.5 }).success).toBe(false);
  });
});

describe("exportQuerySchema", () => {
  it("requires enum members for timePeriod and groupBy", () => {
    expect(
      exportQuerySchema.safeParse({ timePeriod: "week", groupBy: "job" }).success,
    ).toBe(true);
    expect(
      exportQuerySchema.safeParse({ timePeriod: "quarter", groupBy: "job" }).success,
    ).toBe(false);
    expect(
      exportQuerySchema.safeParse({ timePeriod: "day", groupBy: "team" }).success,
    ).toBe(false);
  });

  it("validates optional dates by YYYY-MM-DD shape", () => {
    expect(
      exportQuerySchema.safeParse({
        timePeriod: "range",
        groupBy: "date",
        startDate: "2026-01-05",
        endDate: "2026-02-01",
      }).success,
    ).toBe(true);
    expect(
      exportQuerySchema.safeParse({ timePeriod: "range", groupBy: "date", startDate: "2026-1-5" })
        .success,
    ).toBe(false);
    expect(
      exportQuerySchema.safeParse({
        timePeriod: "range",
        groupBy: "date",
        endDate: "2026-01-05T00:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("rejects a well-shaped date that is not a real calendar day", () => {
    // Digits-only validation let 2026-13-99 through to the date layer, where
    // new Date() silently rolled it over into a different month.
    for (const startDate of ["2026-13-99", "2026-02-30", "2026-00-10", "2026-11-31"]) {
      expect(exportQuerySchema.safeParse({ timePeriod: "range", groupBy: "date", startDate }).success).toBe(
        false,
      );
    }
    // A leap day is accepted only in a leap year.
    expect(
      exportQuerySchema.safeParse({ timePeriod: "range", groupBy: "date", startDate: "2024-02-29" })
        .success,
    ).toBe(true);
    expect(
      exportQuerySchema.safeParse({ timePeriod: "range", groupBy: "date", startDate: "2026-02-29" })
        .success,
    ).toBe(false);
  });
});

describe("subtaskSchema / subtaskUpdateSchema", () => {
  it("applies the isCompleted default and bounds the title", () => {
    expect(subtaskSchema.parse({ taskId: 1, title: "Do" })).toEqual({
      taskId: 1,
      title: "Do",
      isCompleted: false,
    });
    expect(subtaskSchema.safeParse({ taskId: 0, title: "Do" }).success).toBe(false);
    expect(subtaskSchema.safeParse({ taskId: 1, title: "x".repeat(2000) }).success).toBe(true);
    expect(subtaskSchema.safeParse({ taskId: 1, title: "x".repeat(2001) }).success).toBe(false);
    expect(subtaskSchema.safeParse({ taskId: 1, title: "  " }).success).toBe(false);
  });

  it("subtaskUpdateSchema is partial after id", () => {
    expect(subtaskUpdateSchema.safeParse({ id: 1 }).success).toBe(true);
    expect(subtaskUpdateSchema.safeParse({ id: -1 }).success).toBe(false);
    expect(subtaskUpdateSchema.safeParse({ id: 1, isCompleted: true }).success).toBe(true);
    expect(subtaskUpdateSchema.safeParse({ id: 1, title: "" }).success).toBe(false);
  });
});

describe("toNameKey / toSlugKey", () => {
  it("toNameKey lowercases, trims and collapses whitespace", () => {
    expect(toNameKey("  Foo   BAR  ")).toBe("foo bar");
    expect(toNameKey("a\t\tb")).toBe("a b");
    expect(toNameKey("Already Keyed")).toBe("already keyed");
  });

  it("toSlugKey builds a dash slug and strips non-alphanumerics", () => {
    expect(toSlugKey("My Task #1")).toBe("my-task-1");
    expect(toSlugKey("  Weird   Name!!  ")).toBe("weird-name");
    expect(toSlugKey("---Leading Trailing---")).toBe("leading-trailing");
    expect(toSlugKey("CamelCase")).toBe("camelcase");
  });
});

/* ------------------------------------------------------------------ *
 * MF-05 — list pagination / search / filter helpers.
 * ------------------------------------------------------------------ */

/** The keyset predicate is `{ OR: [sortOnly, sortPlusId] }` by construction. */
function orBranches(predicate: Record<string, unknown>): Record<string, unknown>[] {
  return predicate.OR as Record<string, unknown>[];
}

describe("listQuerySchema", () => {
  it("is entirely optional so the unpaged call stays valid", () => {
    expect(listQuerySchema.parse({})).toEqual({});
    expect(taskListQuerySchema.parse({ projectId: "1" })).toEqual({});
  });

  it("coerces the stringy query values routes actually receive", () => {
    expect(listQuerySchema.parse({ limit: "25", cursor: "abc", q: " alpha " })).toEqual({
      limit: 25,
      cursor: "abc",
      q: "alpha",
    });
  });

  it("rejects limit values that are not positive integers", () => {
    // Query strings always arrive as strings (`Object.fromEntries(searchParams)`),
    // so only stringy input is exercised here.
    for (const limit of ["0", "-5", "abc", "1.5", "", " ", "5e", "Infinity", NaN]) {
      expect(listQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    expect(listQuerySchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(listQuerySchema.safeParse({ limit: "999999" }).success).toBe(true);
  });

  it("bounds cursor and q length so a hostile query string cannot be inlined", () => {
    expect(listQuerySchema.safeParse({ cursor: "" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ cursor: "x".repeat(1024) }).success).toBe(true);
    expect(listQuerySchema.safeParse({ cursor: "x".repeat(1025) }).success).toBe(false);
    expect(listQuerySchema.safeParse({ q: "   " }).success).toBe(false);
    expect(listQuerySchema.safeParse({ q: "x".repeat(200) }).success).toBe(true);
    expect(listQuerySchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
});

describe("taskListQuerySchema / projectListQuerySchema", () => {
  it("accepts only the enumerated task statuses", () => {
    for (const status of ["in_progress", "on_hold", "completed", "cancelled"] as const) {
      expect(taskListQuerySchema.safeParse({ status }).success).toBe(true);
    }
    expect(taskListQuerySchema.safeParse({ status: "doing" }).success).toBe(false);
    expect(taskListQuerySchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(false);
  });

  it("coerces jobId and rejects nonsense ids", () => {
    expect(taskListQuerySchema.parse({ jobId: "7" })).toEqual({ jobId: 7 });
    expect(projectListQuerySchema.parse({ jobId: "7" })).toEqual({ jobId: 7 });
    for (const jobId of [0, -3, 1.5, "abc", "", null]) {
      expect(taskListQuerySchema.safeParse({ jobId }).success).toBe(false);
      expect(projectListQuerySchema.safeParse({ jobId }).success).toBe(false);
    }
  });

  it("drops fields the routes own separately (projectId, ordering, etc.)", () => {
    expect(taskListQuerySchema.parse({ projectId: "3", orderBy: "title" })).toEqual({});
  });
});

describe("attendanceListQuerySchema", () => {
  it("validates from/to as real calendar dates", () => {
    expect(attendanceListQuerySchema.parse({ from: "2026-01-05", to: "2026-02-01" })).toEqual({
      from: "2026-01-05",
      to: "2026-02-01",
    });
    for (const from of ["2026-1-5", "2026-01-05T00:00:00Z", "2026-13-99", "2026-02-30", "today"]) {
      expect(attendanceListQuerySchema.safeParse({ from }).success).toBe(false);
    }
    // A leap day is accepted only in a leap year.
    expect(attendanceListQuerySchema.safeParse({ from: "2024-02-29" }).success).toBe(true);
    expect(attendanceListQuerySchema.safeParse({ from: "2026-02-29" }).success).toBe(false);
  });

  it("combines with the shared page params", () => {
    expect(attendanceListQuerySchema.parse({ from: "2026-01-05", limit: "10", q: "trip" })).toEqual(
      { from: "2026-01-05", limit: 10, q: "trip" },
    );
  });
});

describe("resolveListLimit", () => {
  it("defaults to the standard page size when pagination was not asked for", () => {
    expect(resolveListLimit(undefined)).toBe(LIST_DEFAULT_LIMIT);
    expect(LIST_DEFAULT_LIMIT).toBeLessThanOrEqual(LIST_MAX_LIMIT);
  });

  it("clamps to LIST_MAX_LIMIT instead of trusting the client", () => {
    expect(resolveListLimit(10)).toBe(10);
    expect(resolveListLimit(LIST_MAX_LIMIT)).toBe(LIST_MAX_LIMIT);
    expect(resolveListLimit(LIST_MAX_LIMIT + 1)).toBe(LIST_MAX_LIMIT);
    expect(resolveListLimit(100_000)).toBe(LIST_MAX_LIMIT);
  });
});

describe("isPaginationRequested", () => {
  it("only opts in on limit and/or cursor", () => {
    expect(isPaginationRequested(new URLSearchParams(""))).toBe(false);
    expect(isPaginationRequested(new URLSearchParams("q=alpha&status=completed"))).toBe(false);
    expect(isPaginationRequested(new URLSearchParams("limit=5"))).toBe(true);
    expect(isPaginationRequested(new URLSearchParams("cursor=abc"))).toBe(true);
    expect(isPaginationRequested(new URLSearchParams("cursor="))).toBe(true);
  });
});

describe("encodePageCursor / decodePageCursor", () => {
  it("round-trips the sort timestamp and id", () => {
    const cursor = encodePageCursor(new Date("2026-03-30T10:00:00.000Z"), 42);
    expect(decodePageCursor(cursor)).toEqual({ u: "2026-03-30T10:00:00.000Z", i: 42 });
  });

  it("keeps millisecond precision, since updatedAt ties are common", () => {
    const cursor = encodePageCursor(new Date("2026-03-30T10:00:00.123Z"), 7);
    expect(decodePageCursor(cursor)?.u).toBe("2026-03-30T10:00:00.123Z");
  });

  it("produces a query-string-safe base64url token", () => {
    // A payload whose bytes would otherwise use + / and = padding.
    const cursor = encodePageCursor(new Date("2026-12-31T23:59:59.999Z"), 9007199254740991);
    expect(cursor).not.toMatch(/[+/=]/);
    expect(encodeURIComponent(cursor)).toBe(cursor);
    expect(decodePageCursor(cursor)).not.toBeNull();
  });

  it("returns null instead of throwing for malformed input", () => {
    expect(decodePageCursor("")).toBeNull();
    expect(decodePageCursor("bm90LWEtY3Vyc29y")).toBeNull(); // "not-a-cursor"
    expect(decodePageCursor("~~~not base64~~~")).toBeNull();
    for (const payload of [
      "null",
      "42",
      '"a string"',
      "[1,2]",
      "{}",
      '{"u":"nope","i":1}',
      '{"u":"2026-03-30T10:00:00Z","i":0}',
      '{"u":"2026-03-30T10:00:00Z","i":-2}',
      '{"u":"2026-03-30T10:00:00Z","i":1.5}',
      '{"u":"2026-03-30T10:00:00Z"}',
      '{"i":1}',
    ]) {
      expect(decodePageCursor(Buffer.from(payload, "utf8").toString("base64url"))).toBeNull();
    }
  });

  it("ignores extra keys so the cursor format can grow", () => {
    const raw = Buffer.from(
      JSON.stringify({ u: "2026-03-30T10:00:00Z", i: 3, note: "forward compat" }),
      "utf8",
    ).toString("base64url");
    expect(decodePageCursor(raw)).toEqual({ u: "2026-03-30T10:00:00Z", i: 3 });
  });

  it("accepts an offset timestamp and normalises it through keysetAfter", () => {
    const raw = Buffer.from(
      JSON.stringify({ u: "2026-03-30T12:00:00+02:00", i: 3 }),
      "utf8",
    ).toString("base64url");
    const cursor = decodePageCursor(raw);
    expect(cursor).not.toBeNull();
    if (!cursor) return;
    const [sortOnly] = orBranches(keysetAfter(cursor, "updatedAt"));
    const range = sortOnly.updatedAt as { lt: Date };
    expect(range.lt).toBeInstanceOf(Date);
    expect(range.lt.toISOString()).toBe("2026-03-30T10:00:00.000Z");
  });
});

describe("keysetAfter", () => {
  const cursor = { u: "2026-03-30T10:00:00.000Z", i: 42 };

  it("builds a descending strict-after predicate by default", () => {
    expect(keysetAfter(cursor, "updatedAt")).toEqual({
      OR: [
        { updatedAt: { lt: new Date(cursor.u) } },
        { updatedAt: new Date(cursor.u), id: { lt: 42 } },
      ],
    });
  });

  it("flips both comparisons for an ascending list", () => {
    expect(keysetAfter(cursor, "createdAt", false)).toEqual({
      OR: [
        { createdAt: { gt: new Date(cursor.u) } },
        { createdAt: new Date(cursor.u), id: { gt: 42 } },
      ],
    });
  });

  it("carries the id tie-breaker so same-timestamp rows are never skipped", () => {
    const [sortOnly, sortPlusId] = orBranches(keysetAfter({ u: cursor.u, i: 1 }, "updatedAt"));
    expect(sortOnly.updatedAt).toEqual({ lt: new Date(cursor.u) });
    expect(sortPlusId.id).toEqual({ lt: 1 });
  });
});

describe("textContains", () => {
  const envKeys = ["DB_PROVIDER", "PRISMA_SCHEMA_PATH", "DATABASE_URL"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("sends a bare contains on SQLite (mode is rejected there)", () => {
    expect(textContains("title", "alpha")).toEqual({ title: { contains: "alpha" } });
    expect(usesPostgresProvider()).toBe(false);
  });

  it("adds mode=insensitive when the provider resolves to Postgres", () => {
    process.env.DB_PROVIDER = "postgresql";
    expect(usesPostgresProvider()).toBe(true);
    expect(textContains("name", "x")).toEqual({ name: { contains: "x", mode: "insensitive" } });

    delete process.env.DB_PROVIDER;
    process.env.PRISMA_SCHEMA_PATH = "prisma/schema.postgres.prisma";
    expect(textContains("notes", "x")).toEqual({ notes: { contains: "x", mode: "insensitive" } });

    delete process.env.PRISMA_SCHEMA_PATH;
    process.env.DATABASE_URL = "postgresql://user:pw@localhost:5432/db";
    expect(usesPostgresProvider()).toBe(true);
  });

  it("does not treat a sqlite URL containing the word postgres as Postgres", () => {
    process.env.DB_PROVIDER = "sqlite";
    process.env.DATABASE_URL = "file:./postgres-named.db";
    expect(usesPostgresProvider()).toBe(false);
  });

  it("names the field it was given", () => {
    expect(Object.keys(textContains("notes", "v"))).toEqual(["notes"]);
  });
});

describe("dateWindowFilter", () => {
  it("returns null when neither bound is provided", () => {
    expect(dateWindowFilter("checkInTime")).toBeNull();
    expect(dateWindowFilter("checkInTime", undefined, undefined)).toBeNull();
  });

  it("covers the whole `to` day by using an exclusive next-midnight bound", () => {
    const filter = dateWindowFilter("checkInTime", "2026-01-05", "2026-01-06");
    const window = (filter as { checkInTime: { gte: Date; lt: Date } }).checkInTime;
    expect(window.gte).toBeInstanceOf(Date);
    expect(window.lt.getTime() - window.gte.getTime()).toBe(2 * 86_400_000);
  });

  it("supports open-ended windows", () => {
    expect(dateWindowFilter("checkInTime", "2026-01-05")).toEqual({
      checkInTime: { gte: new Date("2026-01-05T00:00:00") },
    });
    const toOnly = dateWindowFilter("checkInTime", undefined, "2026-01-05") as {
      checkInTime: { gte?: Date; lt: Date };
    };
    expect(toOnly.checkInTime.gte).toBeUndefined();
    expect(toOnly.checkInTime.lt).toEqual(new Date("2026-01-06T00:00:00"));
  });

  it("builds the range on the field it was given", () => {
    expect(Object.keys(dateWindowFilter("startedAt", "2026-01-01") ?? {})).toEqual(["startedAt"]);
  });
});

describe("dropField", () => {
  it("removes only the named column and keeps the payload key order", () => {
    const row = { id: 1, title: "T", elapsedSeconds: 5, updatedAt: new Date(0) };
    const stripped = dropField(row, "updatedAt");
    expect(stripped).toEqual({ id: 1, title: "T", elapsedSeconds: 5 });
    expect(Object.keys(stripped)).toEqual(["id", "title", "elapsedSeconds"]);
  });

  it("does not mutate the row it was given", () => {
    const row = { id: 1, createdAt: new Date(0) };
    dropField(row, "createdAt");
    expect(row).toHaveProperty("createdAt");
  });

  it("is a no-op copy for an absent column", () => {
    const row = { id: 1, name: "n" };
    expect(dropField(row, "id")).toEqual({ name: "n" });
  });
});
