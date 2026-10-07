import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWriteAccess } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api-error";
import { userProfileSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const username = await requireAuth(request);

    await prisma.userSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    const [settings] = await prisma.$queryRaw<
      Array<{
        fullName: string | null;
        email: string | null;
        title: string | null;
        bio: string | null;
      }>
    >`SELECT "fullName", "email", "title", "bio" FROM "UserSettings" WHERE "id" = 1 LIMIT 1`;

    return NextResponse.json({
      profile: {
        fullName: settings?.fullName ?? "",
        email: settings?.email ?? "",
        title: settings?.title ?? "",
        bio: settings?.bio ?? "",
      },
      username,
    });
  } catch (error) {
    // BG-06: a bare `catch` here reported every failure (locked DB, bad raw query)
    // as "Unauthorized", which logged users out on server faults.
    return toErrorResponse(error, "Unable to load profile.");
  }
}

export async function PATCH(request: Request) {
  try {
    await requireWriteAccess(request);
    const json = await request.json();
    const parsed = userProfileSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid profile payload." },
        { status: 400 },
      );
    }

    const toNullIfEmpty = (value: string | undefined) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    await prisma.userSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    await prisma.$executeRaw`
      UPDATE "UserSettings"
      SET
        "fullName" = ${toNullIfEmpty(parsed.data.fullName)},
        "email" = ${toNullIfEmpty(parsed.data.email)},
        "title" = ${toNullIfEmpty(parsed.data.title)},
        "bio" = ${toNullIfEmpty(parsed.data.bio)}
      WHERE "id" = 1
    `;

    const [updated] = await prisma.$queryRaw<
      Array<{
        fullName: string | null;
        email: string | null;
        title: string | null;
        bio: string | null;
      }>
    >`SELECT "fullName", "email", "title", "bio" FROM "UserSettings" WHERE "id" = 1 LIMIT 1`;

    return NextResponse.json({
      ok: true,
      profile: {
        fullName: updated?.fullName ?? "",
        email: updated?.email ?? "",
        title: updated?.title ?? "",
        bio: updated?.bio ?? "",
      },
    });
  } catch (error) {
    // BG-06: UnauthorizedError must reach the client as 401; the catch-all 500
    // made an expired session look like a server fault (and hid real ones).
    return toErrorResponse(error, "Unable to update profile.");
  }
}
