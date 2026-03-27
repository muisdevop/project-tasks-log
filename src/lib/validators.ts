import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const taskCreateSchema = z.object({
  projectId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});

export const taskActionSchema = z.object({
  taskId: z.number().int().positive(),
  action: z.enum(["complete", "cancel", "resume", "log-notes"]),
  details: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const settingsSchema = z.object({
  workStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  workEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
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

export const breakSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.string().trim().min(1).max(50),
  time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  isOneTime: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const subtaskSchema = z.object({
  taskId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  isCompleted: z.boolean().default(false),
});

export function toNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
