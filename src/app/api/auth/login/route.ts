import { NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { validateLogin } from "@/lib/auth";
import { loginSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = loginSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const ok = await validateLogin(parsed.data.username, parsed.data.password);
    if (!ok) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    await createSession(parsed.data.username);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to login." }, { status: 500 });
  }
}
