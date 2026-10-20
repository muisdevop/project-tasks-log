import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";
import { requireAuth, UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    await requireAuth();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  await clearSession();

  // Bump the token version so the just-cleared token (and any captured copy)
  // is rejected even though sessions are stateless (SEC-06/SEC-11).
  try {
    await prisma.userSettings.update({
      where: { id: 1 },
      data: { tokenVersion: { increment: 1 } },
    });
  } catch {
    // No settings row yet — nothing to invalidate.
  }

  return NextResponse.json({ ok: true });
}
