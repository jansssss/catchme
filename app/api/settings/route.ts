import { authed, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ma = { period: number; color: string; on: boolean };

/** 차트 이동평균선 설정 (기기 간 공유) */
export async function GET() {
  if (!(await authed())) return unauthorized();
  try {
    const sql = await db();
    const rows = await sql`SELECT value FROM settings WHERE key = 'chart_ma'`;
    return Response.json({ ma: rows[0] ? JSON.parse(rows[0].value) : null });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!(await authed())) return unauthorized();
  const { ma } = await req.json().catch(() => ({}));
  const ok =
    Array.isArray(ma) &&
    ma.length <= 6 &&
    ma.every(
      (m: Ma) =>
        Number.isInteger(m?.period) &&
        m.period >= 2 &&
        m.period <= 600 &&
        /^#[0-9a-fA-F]{6}$/.test(m.color ?? "") &&
        typeof m.on === "boolean"
    );
  if (!ok) return Response.json({ error: "잘못된 설정" }, { status: 400 });
  const clean = (ma as Ma[]).map((m) => ({ period: m.period, color: m.color, on: m.on }));
  const sql = await db();
  await sql`INSERT INTO settings (key, value) VALUES ('chart_ma', ${JSON.stringify(clean)})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  return Response.json({ ok: true });
}
