import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { breakSchema } from "@/lib/validators";

export async function GET() {
  try {
    await requireAuth();
    
    const breaks = await prisma.breakType.findMany({
      where: { settingsId: 1 },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ breaks });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    
    const json = await request.json();
    const parsed = breakSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid break data." }, { status: 400 });
    }

    const breakType = await prisma.breakType.create({
      data: {
        ...parsed.data,
        settingsId: 1,
      },
    });

    return NextResponse.json({ break: breakType }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create break." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAuth();
    
    const json = await request.json();
    const { id, ...data } = json;
    
    if (!id || typeof id !== "number") {
      return NextResponse.json({ error: "Invalid break ID." }, { status: 400 });
    }

    const breakType = await prisma.breakType.update({
      where: { id },
      data,
    });

    return NextResponse.json({ break: breakType });
  } catch {
    return NextResponse.json({ error: "Failed to update break." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAuth();
    
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid break ID." }, { status: 400 });
    }

    await prisma.breakType.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete break." }, { status: 500 });
  }
}
