import type { Bar } from "./naver";

export const PERIODS = [160, 200, 224] as const;
export const NEAR_PCT = 1; // 이평선 ±1% 안이면 "도달"
export const SIDEWAYS_RANGE = 10; // 최근 20일 종가 변동폭 10% 이내
export const SIDEWAYS_DRIFT = 5; // 20일 전 대비 등락 5% 이내
export const DEFAULT_GAP = 5; // 바닥 신호 기본 공백 기준(%)

export type Metrics = {
  price: number;
  ma: Record<number, number | null>;
  /** 현재가가 이평선 대비 몇 % 위(+) / 아래(-) 인지 */
  dist: Record<number, number | null>;
  /** (224선-160선)/224선 %. 양수면 역배열 공백 */
  gap: number | null;
  gapPrev: number | null; // 20거래일 전 공백
  gapTrend: "widening" | "narrowing" | "flat" | null;
  range20: number | null;
  drift20: number | null;
  reversed: boolean; // 현재가 < 160선 < 224선
  sideways: boolean;
  bottom: boolean; // 역배열 + 공백 기준 이상 + 횡보
};

function smaAt(closes: number[], n: number, endIdx: number): number | null {
  if (endIdx + 1 < n) return null;
  let s = 0;
  for (let i = endIdx - n + 1; i <= endIdx; i++) s += closes[i];
  return s / n;
}

export function smaSeries(closes: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let s = 0;
  for (let i = 0; i < closes.length; i++) {
    s += closes[i];
    if (i >= n) s -= closes[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function computeMetrics(bars: Bar[], minGap = DEFAULT_GAP): Metrics | null {
  if (!bars.length) return null;
  const closes = bars.map((b) => b.close);
  const last = closes.length - 1;
  const price = closes[last];
  const ma: Record<number, number | null> = {};
  const dist: Record<number, number | null> = {};
  for (const p of PERIODS) {
    const v = smaAt(closes, p, last);
    ma[p] = v === null ? null : Math.round(v);
    dist[p] = v === null ? null : r2(((price - v) / v) * 100);
  }
  const gapAt = (idx: number) => {
    const a = smaAt(closes, 160, idx);
    const b = smaAt(closes, 224, idx);
    return a === null || b === null ? null : ((b - a) / b) * 100;
  };
  const g = gapAt(last);
  const gp = last >= 20 ? gapAt(last - 20) : null;
  let gapTrend: Metrics["gapTrend"] = null;
  if (g !== null && gp !== null) {
    gapTrend = g - gp > 0.3 ? "widening" : g - gp < -0.3 ? "narrowing" : "flat";
  }

  let range20: number | null = null;
  let drift20: number | null = null;
  if (closes.length >= 21) {
    const w = closes.slice(-20);
    const hi = Math.max(...w);
    const lo = Math.min(...w);
    range20 = r2(((hi - lo) / lo) * 100);
    const base = closes[last - 20];
    drift20 = r2(((price - base) / base) * 100);
  }
  const sideways =
    range20 !== null &&
    drift20 !== null &&
    range20 <= SIDEWAYS_RANGE &&
    Math.abs(drift20) <= SIDEWAYS_DRIFT;
  const reversed =
    ma[160] !== null && ma[224] !== null && price < ma[160]! && ma[160]! < ma[224]!;
  const bottom = reversed && sideways && g !== null && g >= minGap;
  return {
    price,
    ma,
    dist,
    gap: g === null ? null : r2(g),
    gapPrev: gp === null ? null : r2(gp),
    gapTrend,
    range20,
    drift20,
    reversed,
    sideways,
    bottom,
  };
}
