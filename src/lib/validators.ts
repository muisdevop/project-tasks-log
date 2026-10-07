import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 24-hour "HH:MM" clock time, e.g. "09:00". Shared by settings and job routes (SEC-08). */
export const hhmmSchema = z.string().regex(hhmmRegex, "Expected HH:MM 24-hour time.");

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export const jobCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export const jobUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  workStart: hhmmSchema.optional(),
  workEnd: hhmmSchema.optional(),
  workDays: z.array(z.number().int().min(1).max(7)).min(1).optional(),
});

export const taskCreateSchema = z.object({
  projectId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  startedAt: z.string().datetime().optional(),
  isBreak: z.boolean().optional(),
});

export const taskActionSchema = z.object({
  taskId: z.number().int().positive(),
  action: z.enum(["complete", "cancel", "resume", "hold", "log-notes"]),
  details: z.string().trim().max(10000).optional(),
  notes: z.string().trim().max(10000).optional(),
  // elapsedSeconds is intentionally NOT accepted from clients: worked time is
  // always computed server-side from business hours (SEC-05).
});

export const settingsSchema = z.object({
  workStart: hhmmSchema,
  workEnd: hhmmSchema,
  workDays: z.array(z.number().int().min(1).max(7)).min(1),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6).max(128),
    confirmPassword: z.string().min(6).max(128),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "New password and confirmation do not match.",
    path: ["confirmPassword"],
  });

export const userProfileSchema = z.object({
  fullName: z.string().trim().max(120).optional(),
  email: z.union([z.literal(""), z.string().trim().email().max(255)]).optional(),
  title: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(2000).optional(),
});

export const breakSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.string().trim().min(1).max(50),
  duration: z.number().int().min(1).max(480).optional(), // Duration in minutes (max 8 hours), optional for recurring
  isOneTime: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const breakUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(100).optional(),
  type: z.string().trim().min(1).max(50).optional(),
  duration: z.number().int().min(1).max(480).nullable().optional(),
  isOneTime: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/**
 * Payload for logging a finished break (UX-03). The client only states which
 * break was taken and when it started; the record itself is written by the
 * server in one transaction, so a break can never be half-logged.
 */
export const breakLogSchema = z.object({
  jobId: z.number().int().positive(),
  // Optional: when the user is on a project page, log the break there.
  projectId: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(100),
  startedAt: z.string().datetime(),
});

export const attendanceSchema = z.object({
  jobId: z.number().int().positive(),
  // nullish: the client sends an explicit `notes: null` when no note is typed.
  notes: z.string().trim().max(2000).nullish(),
});

export const exportQuerySchema = z.object({
  timePeriod: z.enum(["day", "week", "month", "range"]),
  groupBy: z.enum(["date", "job", "project"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const subtaskSchema = z.object({
  taskId: z.number().int().positive(),
  title: z.string().trim().min(1).max(2000),
  isCompleted: z.boolean().default(false),
});

export const subtaskUpdateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(2000).optional(),
  isCompleted: z.boolean().optional(),
});

/** Lowercased single-space-joined key (Project/Job name uniqueness lookup). */
export function toNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Lowercased dash-slug key (Job nameKey). Single-sourced here to prevent the
 * divergent duplicate that used to live in both jobs routes (AR-04). */
export function toSlugKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
