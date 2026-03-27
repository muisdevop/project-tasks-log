import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, updateDbPassword, verifyCurrentPassword } from "@/lib/auth";
import { changePasswordSchema, settingsSchema } from "@/lib/validators";

const defaultDays = [1, 2, 3, 4, 5];

export async function GET() {
  try {
    await requireAuth();
    const settings = await prisma.userSettings.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        workStart: "09:00",
        workEnd: "17:00",
        workDays: defaultDays,
      },
      select: {
        id: true,
        workStart: true,
        workEnd: true,
        workDays: true,
      },
    });
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    const json = await request.json();
    const parsed = settingsSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
    }
    if (parsed.data.workEnd <= parsed.data.workStart) {
      return NextResponse.json(
        { error: "workEnd must be after workStart." },
        { status: 400 },
      );
    }

    const settings = await prisma.userSettings.upsert({
      where: { id: 1 },
      update: parsed.data,
      create: { id: 1, ...parsed.data },
      select: {
        id: true,
        workStart: true,
        workEnd: true,
        workDays: true,
      },
    });

    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ error: "Unable to save settings." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAuth();
    const json = await request.json();
    const parsed = changePasswordSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid password payload." },
        { status: 400 },
      );
    }

    const isCurrentValid = await verifyCurrentPassword(parsed.data.currentPassword);
    if (!isCurrentValid) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    await updateDbPassword(parsed.data.newPassword);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to change password." }, { status: 500 });
  }
}
