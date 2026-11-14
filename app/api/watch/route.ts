import { authed, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDaily, getQuotes, mergeLive } from "@/lib/naver";
import { computeMetrics, DEFAULT_GAP } from "@/lib/indicators";

export const dynamic = "force-dynamic";

/** 관심 종목 + 현재가 + 이평선 지표 + 알림 목록 */
export async function GET() {
  if (!(await authed())) return unauthorized();
  try {
    const sql = await db();
    const [stocks, alerts] = await Promise.all([
      sql`SELECT code, name, market, buy_price FROM watchlist ORDER BY created_at`,
      sql`SELECT id, code, kind, value, active, fired_at FROM alerts ORDER BY id`,
    ]);
    const codes = stocks.map((s) => s.code as string);
    const quotes = await getQuotes(codes).catch(() => ({}) as Awaited<ReturnType<typeof getQuotes>>);
    const out = await Promise.all(
      stocks.map(async (s) => {
        const mine = alerts.filter((a) => a.code === s.code);
        const bottomAlert = mine.find((a) => a.kind === "bottom");
        let metrics = null;
        try {
          const bars = mergeLive(await getDaily(s.code), quotes[s.code]);
          metrics = computeMetrics(bars, bottomAlert ? Number(bottomAlert.value) : DEFAULT_GAP);
        } catch {
          /* 지표 없이 표시 */
        }
        return {
          code: s.code,
          name: s.name,
          market: s.market,
          buyPrice: s.buy_price === null ? null : Number(s.buy_price),
          quote: quotes[s.code] ?? null,
          metrics,
          alerts: mine.map((a) => ({
            id: a.id,
            kind: a.kind,
            value: Number(a.value),
            active: a.active,
            firedAt: a.fired_at,
          })),
        };
      })
    );
    return Response.json({
      stocks: out,
      pushReady: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY,
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await authed())) return unauthorized();
  const { code, name, market } = await req.json();
  if (!/^[0-9A-Z]{6}$/.test(code ?? "") || !name) {
    return Response.json({ error: "잘못된 종목" }, { status: 400 });
  }
  const sql = await db();
  await sql`INSERT INTO watchlist (code, name, market) VALUES (${code}, ${name}, ${market ?? "KOSPI"})
            ON CONFLICT (code) DO NOTHING`;
  return Response.json({ ok: true });
}

/** 매수가 저장 (null 이면 삭제) */
export async function PATCH(req: Request) {
  if (!(await authed())) return unauthorized();
  const { code, buyPrice } = await req.json();
  const v = buyPrice === null || buyPrice === "" ? null : Number(buyPrice);
  if (v !== null && !(v > 0)) return Response.json({ error: "잘못된 가격" }, { status: 400 });
  const sql = await db();
  await sql`UPDATE watchlist SET buy_price = ${v} WHERE code = ${code}`;
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await authed())) return unauthorized();
  const code = new URL(req.url).searchParams.get("code");
  const sql = await db();
  await sql`DELETE FROM watchlist WHERE code = ${code}`;
  return Response.json({ ok: true });
}
