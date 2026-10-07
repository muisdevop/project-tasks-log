import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWriteAccess } from "@/lib/auth";
import { HttpError, toErrorResponse } from "@/lib/api-error";

const FALLBACK_TITLE = "Activity Report";

type ReportTitlesPayload = {
  action?: "add" | "update" | "remove" | "set-default";
  title?: string;
  oldTitle?: string;
  newTitle?: string;
};

// Minimal shape of the prisma transaction client we rely on.
type TxClient = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

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

async function loadTitleState(tx: TxClient) {
  const [row] = await tx.$queryRaw<
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

async function saveTitleState(tx: TxClient, options: string[], defaultTitle: string) {
  const normalizedDefault = options.includes(defaultTitle) ? defaultTitle : options[0] || FALLBACK_TITLE;
  await tx.$executeRaw`
    UPDATE "UserSettings"
    SET
      "reportTitleOptions" = ${JSON.stringify(options)},
      "defaultReportTitle" = ${normalizedDefault}
    WHERE "id" = 1
  `;
}

export async function GET(request: Request) {
  try {
    await requireAuth(request);
    await ensureSettingsRow();
    const { options, defaultTitle } = await loadTitleState(prisma);

    return NextResponse.json({ options, defaultTitle });
  } catch (error) {
    return toErrorResponse(error, "Unable to load report titles.");
  }
}

export async function PATCH(request: Request) {
  try {
    await requireWriteAccess(request);
    await ensureSettingsRow();

    const body = (await request.json().catch(() => ({}))) as ReportTitlesPayload;
    const action = body.action;

    if (!action) {
      return NextResponse.json({ error: "Action is required." }, { status: 400 });
    }

    // ST-01: read-modify-write of the titles JSON must be serialized.
    // Concurrent PATCHes now race on the row inside a transaction instead of
    // interleaving read/save and silently dropping one writer's change.
    const result = await prisma.$transaction(async (tx) => {
      const current = await loadTitleState(tx);
      let options = [...current.options];
      let defaultTitle = current.defaultTitle;

      if (action === "add") {
        const title = normalizeTitle(body.title);
        if (!title) {
          throw new HttpError(400, "Title is required.");
        }
        if (options.some((value) => value.toLowerCase() === title.toLowerCase())) {
          throw new HttpError(400, "Title already exists.");
        }
        options.push(title);
      }

      if (action === "update") {
        const oldTitle = normalizeTitle(body.oldTitle);
        const newTitle = normalizeTitle(body.newTitle);
        if (!oldTitle || !newTitle) {
          throw new HttpError(400, "Old and new titles are required.");
        }

        const oldIndex = options.findIndex((value) => value === oldTitle);
        if (oldIndex === -1) {
          throw new HttpError(404, "Title to update was not found.");
        }

        const duplicateIndex = options.findIndex(
          (value, index) => index !== oldIndex && value.toLowerCase() === newTitle.toLowerCase(),
        );
        if (duplicateIndex !== -1) {
          throw new HttpError(400, "Another title with that name already exists.");
        }

        options[oldIndex] = newTitle;
        if (defaultTitle === oldTitle) {
          defaultTitle = newTitle;
        }
      }

      if (action === "remove") {
        const title = normalizeTitle(body.title);
        if (!title) {
          throw new HttpError(400, "Title is required.");
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
          throw new HttpError(400, "Title is required.");
        }
        if (!options.includes(title)) {
          throw new HttpError(404, "Title not found in options.");
        }
        defaultTitle = title;
      }

      await saveTitleState(tx, options, defaultTitle);
      return { options, defaultTitle };
    });

    return NextResponse.json({
      ok: true,
      options: result.options,
      defaultTitle: result.defaultTitle,
    });
  } catch (error) {
    return toErrorResponse(error, "Unable to update report titles.");
  }
}
