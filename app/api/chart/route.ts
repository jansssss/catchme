import { authed, unauthorized } from "@/lib/auth";
import { getDaily, getQuotes, mergeLive } from "@/lib/naver";

export const dynamic = "force-dynamic";

const DAYS = 3660; // 약 10년치 일봉 — 주봉·월봉과 긴 이평선 계산에 쓴다

/** 일봉 OHLCV. 이평선·주봉·월봉은 화면에서 계산한다 */
export async function GET(req: Request) {
  if (!(await authed())) return unauthorized();
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!/^[0-9A-Z]{6}$/.test(code)) return Response.json({ error: "잘못된 종목" }, { status: 400 });
  try {
    const quotes = await getQuotes([code]).catch(() => ({}) as Record<string, any>);
    const bars = mergeLive(await getDaily(code, DAYS), quotes[code]);
    if (!bars.length) return Response.json({ error: "차트 데이터가 없습니다" }, { status: 502 });
    return Response.json({
      t: bars.map((b) => b.date),
      o: bars.map((b) => b.open),
      h: bars.map((b) => b.high),
      l: bars.map((b) => b.low),
      c: bars.map((b) => b.close),
      v: bars.map((b) => b.volume),
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}
