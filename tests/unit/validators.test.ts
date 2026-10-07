import { describe, expect, it } from "vitest";
import {
  attendanceSchema,
  breakLogSchema,
  breakSchema,
  breakUpdateSchema,
  changePasswordSchema,
  exportQuerySchema,
  hhmmSchema,
  jobCreateSchema,
  jobUpdateSchema,
  loginSchema,
  projectSchema,
  settingsSchema,
  subtaskSchema,
  subtaskUpdateSchema,
  taskActionSchema,
  taskCreateSchema,
  toNameKey,
  toSlugKey,
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
