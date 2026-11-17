// 네이버 금융 공개 엔드포인트로 국내 주식 검색 / 현재가 / 일봉을 가져온다
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
};

export type SearchItem = { code: string; name: string; market: string };
export type Quote = {
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  open: boolean;
  tradedDate: string; // YYYYMMDD
  volume: number; // 당일 누적 거래량 (없으면 0)
};
export type Bar = { date: string; open: number; close: number; high: number; low: number; volume: number };

const num = (s: unknown) => Number(String(s ?? "0").replace(/,/g, "")) || 0;

export async function searchStocks(q: string): Promise<SearchItem[]> {
  const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`;
  const r = await fetch(url, { headers: UA, cache: "no-store" });
  if (!r.ok) throw new Error("검색 실패");
  const j = await r.json();
  return (j.items ?? [])
    .filter((it: any) => it.nationCode === "KOR" && /^[0-9A-Z]{6}$/.test(it.code))
    .slice(0, 12)
    .map((it: any) => ({ code: it.code, name: it.name, market: it.typeCode ?? "KOSPI" }));
}

export async function getQuotes(codes: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  for (let i = 0; i < codes.length; i += 20) {
    const part = codes.slice(i, i + 20);
    const r = await fetch(
      `https://polling.finance.naver.com/api/realtime/domestic/stock/${part.join(",")}`,
      { headers: UA, cache: "no-store" }
    );
    if (!r.ok) throw new Error("현재가 조회 실패");
    const j = await r.json();
    for (const d of j.datas ?? []) {
      const dir = d.compareToPreviousPrice?.name ?? "";
      const sign = dir === "FALLING" || dir === "LOWER_LIMIT" ? -1 : 1;
      out[d.itemCode] = {
        code: d.itemCode,
        name: d.stockName,
        price: num(d.closePrice),
        change: sign * Math.abs(num(d.compareToPreviousClosePrice)),
        changePct: sign * Math.abs(num(d.fluctuationsRatio)),
        open: d.marketStatus === "OPEN",
        volume: num(d.accumulatedTradingVolume),
        tradedDate: String(d.localTradedAt ?? "").slice(0, 10).replace(/-/g, ""),
      };
    }
  }
  return out;
}

const ymd = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d).replace(/-/g, "");

/** 최근 days 일(기본 약 2년)치 일봉 (10분 캐시). 마지막 봉은 mergeLive 로 현재가를 반영한다 */
export async function getDaily(code: string, days = 760): Promise<Bar[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const url = `https://fchart.stock.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${ymd(start)}&endTime=${ymd(end)}&timeframe=day`;
  const r = await fetch(url, { headers: UA, next: { revalidate: 600 } });
  if (!r.ok) throw new Error("일봉 조회 실패");
  const text = await r.text();
  const bars: Bar[] = [];
  const re = /\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    bars.push({
      date: m[1],
      open: Number(m[2]),
      high: Number(m[3]),
      low: Number(m[4]),
      close: Number(m[5]),
      volume: Number(m[6] ?? 0),
    });
  }
  return bars;
}

/** 일봉에 실시간 현재가를 반영한다 (오늘 봉이 있으면 교체, 없으면 추가) */
export function mergeLive(bars: Bar[], q?: Quote): Bar[] {
  if (!q || !q.price || !q.tradedDate) return bars;
  const out = bars.slice();
  const last = out[out.length - 1];
  if (last && last.date === q.tradedDate) {
    out[out.length - 1] = {
      ...last,
      close: q.price,
      high: Math.max(last.high, q.price),
      low: Math.min(last.low, q.price),
      volume: Math.max(last.volume, q.volume || 0),
    };
  } else if (!last || last.date < q.tradedDate) {
    out.push({ date: q.tradedDate, open: q.price, close: q.price, high: q.price, low: q.price, volume: q.volume || 0 });
  }
  return out;
}
