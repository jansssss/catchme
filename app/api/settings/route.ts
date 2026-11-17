import { authed, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTrendPeriod, TREND_MAX, TREND_MIN } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Ma = { period: number; color: string; on: boolean };

/** 차트 이동평균선 설정 + 추세 기준선 기간 (기기 간 공유) */
export async function GET() {
  if (!(await authed())) return unauthorized();
  try {
    const sql = await db();
    const rows = await sql`SELECT value FROM settings WHERE key = 'chart_ma'`;
    return Response.json({
      ma: rows[0] ? JSON.parse(rows[0].value) : null,
      trendPeriod: await getTrendPeriod(),
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

/** { ma } 또는 { trendPeriod } 중 보낸 것만 저장한다 */
export async function PUT(req: Request) {
  if (!(await authed())) return unauthorized();
  const { ma, trendPeriod } = await req.json().catch(() => ({}));
  const sql = await db();
  const save = (key: string, value: string) =>
    sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

  if (ma !== undefined) {
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
    await save("chart_ma", JSON.stringify((ma as Ma[]).map((m) => ({ period: m.period, color: m.color, on: m.on }))));
  }
  if (trendPeriod !== undefined) {
    if (!Number.isInteger(trendPeriod) || trendPeriod < TREND_MIN || trendPeriod > TREND_MAX) {
      return Response.json({ error: `기준선은 ${TREND_MIN}~${TREND_MAX}일` }, { status: 400 });
    }
    await save("trend_period", String(trendPeriod));
  }
  if (ma === undefined && trendPeriod === undefined) return Response.json({ error: "잘못된 설정" }, { status: 400 });
  return Response.json({ ok: true });
}
