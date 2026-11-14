import { authed, unauthorized } from "@/lib/auth";
import { getDaily, getQuotes, mergeLive } from "@/lib/naver";
import { smaSeries } from "@/lib/indicators";

export const dynamic = "force-dynamic";

const SHOW = 180; // 화면에 그릴 거래일 수

export async function GET(req: Request) {
  if (!(await authed())) return unauthorized();
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!/^[0-9A-Z]{6}$/.test(code)) return Response.json({ error: "잘못된 종목" }, { status: 400 });
  try {
    const quotes = await getQuotes([code]).catch(() => ({}) as Record<string, any>);
    const bars = mergeLive(await getDaily(code), quotes[code]);
    const closes = bars.map((b) => b.close);
    const from = Math.max(0, bars.length - SHOW);
    const cut = <T,>(a: T[]) => a.slice(from);
    const round = (a: (number | null)[]) => a.map((x) => (x === null ? null : Math.round(x)));
    return Response.json({
      dates: cut(bars.map((b) => b.date)),
      close: cut(closes),
      ma160: round(cut(smaSeries(closes, 160))),
      ma200: round(cut(smaSeries(closes, 200))),
      ma224: round(cut(smaSeries(closes, 224))),
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}
