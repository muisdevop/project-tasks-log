import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Unauthenticated liveness/readiness probe (whitelisted in src/proxy.ts).
 * Returns the absolute minimum and keeps all detail server-side (SEC-07/BF-02).
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("[health] database check failed:", error);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
