import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { userProfileSchema } from "@/lib/validators";

export async function GET() {
  try {
    const username = await requireAuth();

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
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAuth();
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
  } catch {
    return NextResponse.json({ error: "Unable to update profile." }, { status: 500 });
  }
}
