import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWriteAccess, updateDbPassword, verifyCurrentPassword } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api-error";
import { changePasswordSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    await requireAuth(request);
    // Ensure a UserSettings record exists (for auth and general settings)
    await prisma.userSettings.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // BG-06: a single `catch` that answers 401 turned every failure (a locked
    // SQLite file, for instance) into a fake "sign in again".
    return toErrorResponse(error, "Unable to load settings.");
  }
}

export async function POST(request: Request) {
  try {
    await requireWriteAccess(request);
    // POST is currently unused - work schedules are now per-job
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error, "Unable to load settings.");
  }
}

export async function PATCH(request: Request) {
  try {
    await requireWriteAccess(request);
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
  } catch (error) {
    // BG-06: UnauthorizedError must map to 401 here; swallowing it as 500 made an
    // expired session look like a server fault to the client.
    return toErrorResponse(error, "Unable to change password.");
  }
}
