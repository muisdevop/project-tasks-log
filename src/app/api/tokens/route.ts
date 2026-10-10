/**
 * AI-02: `/api/tokens` — mint, list and revoke scoped API tokens.
 *
 * Cookie-session only, deliberately: `requireSessionAuth` refuses any request
 * that presents a Bearer credential, so a leaked token cannot mint a replacement
 * one (that would silently restore the "one cookie = full power" property this
 * finding is about). The plaintext appears in exactly one response — the POST
 * that created it — and is never stored or listed.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSessionAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api-error";
import {
  assertBucketRateLimit,
  clientIp,
  RateLimitedError,
} from "@/lib/rate-limit";
import {
  apiTokenCreateSchema,
  apiTokenIdSchema,
  apiTokenUpdateSchema,
} from "@/lib/validators";
import {
  generateApiToken,
  toApiTokenView,
  type ApiScope,
} from "@/lib/api-tokens";
import { logSecurityEvent } from "@/lib/security-events";
import { withIdempotency } from "@/lib/idempotency";
import { withRequestLogging, type RequestLogContext } from "@/lib/request-log";

/** A minted secret must not sit in the idempotency replay map for an hour. */
const TOKEN_MINT_IDEMPOTENCY_TTL_MS = 5 * 60_000;

/** Cookie callers have no token id, so the limiter falls back to their IP. */
function limiterSubject(request: Request) {
  return { ip: clientIp(request) };
}

export async function GET(request: Request) {
  return withRequestLogging(request, (log) => listTokens(request, log));
}

export async function POST(request: Request) {
  return withRequestLogging(request, (log) => mintToken(request, log));
}

export async function PATCH(request: Request) {
  return withRequestLogging(request, (log) => updateToken(request, log));
}

/** MF-04: every handler logs its actor as `session`, which `requireSessionAuth` just enforced. */
async function listTokens(request: Request, log: RequestLogContext) {
  try {
    const actor = await requireSessionAuth(request);
    log.identify(actor, "session");
    assertBucketRateLimit(limiterSubject(request), "tokens-list");

    const rows = await prisma.apiToken.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ tokens: rows.map((row) => toApiTokenView(row)) });
  } catch (error) {
    return tokenErrorResponse(error, request, "tokens-list");
  }
}

async function mintToken(request: Request, log: RequestLogContext) {
  try {
    const actor = await requireSessionAuth(request);
    log.identify(actor, "session");
    assertBucketRateLimit(limiterSubject(request), "tokens-mint");

    const json = await request.json().catch(() => null);
    const parsed = apiTokenCreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid payload." },
        { status: 400 },
      );
    }

    // AI-03: a retried mint replays the original response (same plaintext)
    // instead of silently creating a second live token.
    return await withIdempotency(
      request,
      parsed.data,
      async () => {
        const { plaintext, tokenHash } = generateApiToken();
        const created = await prisma.apiToken.create({
          data: {
            tokenHash,
            name: parsed.data.name,
            scope: parsed.data.scope as ApiScope,
            expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
          },
        });

        logSecurityEvent({
          evt: "token.created",
          actor,
          ip: clientIp(request),
          detail: { tokenId: created.id, scope: created.scope },
        });

        return NextResponse.json(
          {
            token: toApiTokenView(created),
            // Shown once. The database only ever held the SHA-256 digest.
            plaintext,
            warning: "Copy this token now. It cannot be retrieved again.",
          },
          { status: 201 },
        );
      },
      {
        actor,
        ip: clientIp(request),
        ttlMs: TOKEN_MINT_IDEMPOTENCY_TTL_MS,
      },
    );
  } catch (error) {
    return tokenErrorResponse(error, request, "tokens-mint");
  }
}

async function updateToken(request: Request, log: RequestLogContext) {
  try {
    const actor = await requireSessionAuth(request);
    log.identify(actor, "session");
    // Writes to the token table share the mint budget: one credential cannot be
    // used to enumerate-and-revoke every other token in a burst.
    assertBucketRateLimit(limiterSubject(request), "tokens-mint");

    const json = await request.json().catch(() => null);
    const parsed = apiTokenUpdateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid payload." },
        { status: 400 },
      );
    }

    const existing = await prisma.apiToken.findUnique({ where: { id: parsed.data.id } });
    if (!existing) {
      return NextResponse.json({ error: "Token not found." }, { status: 404 });
    }

    const updated = await prisma.apiToken.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.revoke ? { revokedAt: existing.revokedAt ?? new Date() } : {}),
      },
    });

    if (parsed.data.revoke) {
      logSecurityEvent({
        evt: "token.revoked_by_operator",
        actor,
        ip: clientIp(request),
        detail: { tokenId: updated.id },
      });
    }

    return NextResponse.json({ token: toApiTokenView(updated) });
  } catch (error) {
    return tokenErrorResponse(error, request, "tokens-mint");
  }
}

/**
 * DELETE is a revoke, not an erase: the row (and its digest) stays so the audit
 * trail survives, and a repeated DELETE is a harmless no-op replay.
 */
export async function DELETE(request: Request) {
  return withRequestLogging(request, (log) => revokeToken(request, log));
}

async function revokeToken(request: Request, log: RequestLogContext) {
  try {
    const actor = await requireSessionAuth(request);
    log.identify(actor, "session");
    assertBucketRateLimit(limiterSubject(request), "tokens-mint");

    const parsed = apiTokenIdSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid token ID." }, { status: 400 });
    }

    const existing = await prisma.apiToken.findUnique({ where: { id: parsed.data.id } });
    if (!existing) {
      return NextResponse.json({ error: "Token not found." }, { status: 404 });
    }

    const revokedAt = existing.revokedAt ?? new Date();
    const updated = await prisma.apiToken.update({
      where: { id: existing.id },
      data: { revokedAt },
    });
    if (!existing.revokedAt) {
      logSecurityEvent({
        evt: "token.revoked_by_operator",
        actor,
        ip: clientIp(request),
        detail: { tokenId: updated.id },
      });
    }

    return NextResponse.json({ token: toApiTokenView(updated) });
  } catch (error) {
    return tokenErrorResponse(error, request, "tokens-mint");
  }
}

/**
 * Rate-limit rejections are security events before they are responses (MF-02);
 * everything else keeps the house `toErrorResponse` mapping so a 401 can never
 * degrade into a 500.
 */
function tokenErrorResponse(error: unknown, request: Request, bucket: string) {
  if (error instanceof RateLimitedError) {
    logSecurityEvent({
      evt: "token.rate_limited",
      ip: clientIp(request),
      detail: { bucket },
    });
  }
  return toErrorResponse(error, "Unable to manage API tokens.");
}
