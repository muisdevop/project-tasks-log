import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

const FALLBACK_TITLE = "Activity Report";

type ReportTitlesPayload = {
  action?: "add" | "update" | "remove" | "set-default";
  title?: string;
  oldTitle?: string;
  newTitle?: string;
};

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

function parseTitleOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [FALLBACK_TITLE];

  const deduped = new Set<string>();
  for (const item of value) {
    const title = normalizeTitle(item);
    if (title) deduped.add(title);
  }

  if (deduped.size === 0) deduped.add(FALLBACK_TITLE);
  return [...deduped];
}

async function ensureSettingsRow() {
  await prisma.userSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

async function loadTitleState() {
  const [row] = await prisma.$queryRaw<
    Array<{
      reportTitleOptions: unknown;
      defaultReportTitle: string | null;
    }>
  >`SELECT "reportTitleOptions", "defaultReportTitle" FROM "UserSettings" WHERE "id" = 1 LIMIT 1`;

  const options = parseTitleOptions(row?.reportTitleOptions);
  const preferredDefault = normalizeTitle(row?.defaultReportTitle ?? "");
  const defaultTitle = options.includes(preferredDefault) ? preferredDefault : options[0];

  return { options, defaultTitle };
}

async function saveTitleState(options: string[], defaultTitle: string) {
  const normalizedDefault = options.includes(defaultTitle) ? defaultTitle : options[0] || FALLBACK_TITLE;
  await prisma.$executeRaw`
    UPDATE "UserSettings"
    SET
      "reportTitleOptions" = ${JSON.stringify(options)},
      "defaultReportTitle" = ${normalizedDefault}
    WHERE "id" = 1
  `;
}

export async function GET() {
  try {
    await requireAuth();
    await ensureSettingsRow();
    const { options, defaultTitle } = await loadTitleState();

    return NextResponse.json({ options, defaultTitle });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAuth();
    await ensureSettingsRow();

    const body = (await request.json().catch(() => ({}))) as ReportTitlesPayload;
    const action = body.action;

    if (!action) {
      return NextResponse.json({ error: "Action is required." }, { status: 400 });
    }

    const current = await loadTitleState();
    let options = [...current.options];
    let defaultTitle = current.defaultTitle;

    if (action === "add") {
      const title = normalizeTitle(body.title);
      if (!title) {
        return NextResponse.json({ error: "Title is required." }, { status: 400 });
      }
      if (options.some((value) => value.toLowerCase() === title.toLowerCase())) {
        return NextResponse.json({ error: "Title already exists." }, { status: 400 });
      }
      options.push(title);
    }

    if (action === "update") {
      const oldTitle = normalizeTitle(body.oldTitle);
      const newTitle = normalizeTitle(body.newTitle);
      if (!oldTitle || !newTitle) {
        return NextResponse.json({ error: "Old and new titles are required." }, { status: 400 });
      }

      const oldIndex = options.findIndex((value) => value === oldTitle);
      if (oldIndex === -1) {
        return NextResponse.json({ error: "Title to update was not found." }, { status: 404 });
      }

      const duplicateIndex = options.findIndex(
        (value, index) => index !== oldIndex && value.toLowerCase() === newTitle.toLowerCase(),
      );
      if (duplicateIndex !== -1) {
        return NextResponse.json({ error: "Another title with that name already exists." }, { status: 400 });
      }

      options[oldIndex] = newTitle;
      if (defaultTitle === oldTitle) {
        defaultTitle = newTitle;
      }
    }

    if (action === "remove") {
      const title = normalizeTitle(body.title);
      if (!title) {
        return NextResponse.json({ error: "Title is required." }, { status: 400 });
      }
      options = options.filter((value) => value !== title);
      if (options.length === 0) {
        options = [FALLBACK_TITLE];
      }
      if (!options.includes(defaultTitle)) {
        defaultTitle = options[0];
      }
    }

    if (action === "set-default") {
      const title = normalizeTitle(body.title);
      if (!title) {
        return NextResponse.json({ error: "Title is required." }, { status: 400 });
      }
      if (!options.includes(title)) {
        return NextResponse.json({ error: "Title not found in options." }, { status: 404 });
      }
      defaultTitle = title;
    }

    await saveTitleState(options, defaultTitle);

    return NextResponse.json({
      ok: true,
      options,
      defaultTitle,
    });
  } catch {
    return NextResponse.json({ error: "Unable to update report titles." }, { status: 500 });
  }
}
