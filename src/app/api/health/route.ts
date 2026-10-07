import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { describeDbFailure, withQueryTimeout } from "@/lib/db-resilience";

/**
 * Unauthenticated liveness/readiness probe (whitelisted in src/proxy.ts).
 * Returns the absolute minimum and keeps all detail server-side (SEC-07/BF-02).
 *
 * RB-01: the probe itself now runs under a deadline, because a health check that
 * hangs is worse than one that fails — the Docker HEALTHCHECK and every load
 * balancer behind it treat a hang as a slow success until they time out
 * together. The failure *kind* is logged server-side (never in the body) so an
 * operator can tell "database locked" from "database unreachable", and the 503
 * carries `Retry-After` so a caller knows to probe again shortly.
 */
export async function GET() {
  try {
    await withQueryTimeout(() => prisma.$queryRaw`SELECT 1`, {
      label: "health probe",
      timeoutMs: 2_000,
    });
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    const { kind, code } = describeDbFailure(error);
    console.error(`[health] database check failed (${kind}${code ? ` ${code}` : ""})`, error);
    return NextResponse.json(
      { status: "error" },
      { status: 503, headers: { "Retry-After": "2" } },
    );
  }
}
