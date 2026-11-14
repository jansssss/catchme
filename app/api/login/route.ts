import { cookies } from "next/headers";
import { authed, COOKIE, token } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ authed: await authed() });
}

export async function POST(req: Request) {
  const { pin } = await req.json();
  if (!process.env.APP_PIN || String(pin) !== process.env.APP_PIN) {
    await new Promise((r) => setTimeout(r, 800)); // 무차별 대입 지연
    return Response.json({ error: "비밀번호가 틀렸습니다" }, { status: 401 });
  }
  const c = await cookies();
  c.set(COOKIE, token(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return Response.json({ ok: true });
}
