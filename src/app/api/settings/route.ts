import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, updateDbPassword, verifyCurrentPassword } from "@/lib/auth";
import { changePasswordSchema } from "@/lib/validators";

export async function GET() {
  try {
    await requireAuth();
    // Ensure a UserSettings record exists (for auth and general settings)
    await prisma.userSettings.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
      },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    // POST is currently unused - work schedules are now per-job
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
