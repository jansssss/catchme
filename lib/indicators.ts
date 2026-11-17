import type { Bar } from "./naver";

export const DEFAULT_TREND_PERIOD = 224; // 추세를 판단하는 기준 이평선
export const SLOPE_WIN = 20; // 기울기 = 기준선이 최근 20거래일 동안 움직인 비율(%)
export const FLAT_PCT = 1; // 기울기가 ±1% 안이면 수평(횡보)
export const EASE_MIN = 0.5; // 한 달 전보다 이만큼(%p) 이상 완만해져야 "하락 둔화"
export const CONFIRM_BARS = 3; // 새 국면이 3거래일 이어져야 바뀐 것으로 본다
const LOOKBACK = 250; // 국면이 며칠째인지 거슬러 볼 최대 거래일
const LINE_POINTS = 250; // 미리보기로 그릴 기준선 길이(약 1년) — 내려오다 눕는 모양이 보이도록 길게

/** 하락 → 하락 둔화 → 횡보 → 상승 */
export type Phase = "down" | "easing" | "flat" | "up";
export const PHASE_LABEL: Record<Phase, string> = {
  down: "하락",
  easing: "하락 둔화",
  flat: "횡보",
  up: "상승",
};

export type Trend = {
  price: number;
  period: number;
  ma: number; // 기준선 현재 값
  dist: number; // 현재가가 기준선 대비 몇 % 위(+) / 아래(-)
  slope: number; // 기준선의 최근 20거래일 변화율 %
  slopePrev: number | null; // 20거래일 전의 기울기
  phase: Phase;
  days: number; // 현재 국면이 이어진 거래일 수
  daysCapped: boolean; // 조회 구간 내내 같은 국면 (실제로는 더 오래됨)
  line: number[]; // 기준선 최근 값들 (미리보기용)
};

/** 추세 계산에 필요한 일봉을 받기 위한 조회 일수 */
export const daysFor = (period: number) => Math.max(760, Math.ceil((period + 300) * 1.5));

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

/** 기준 이평선의 기울기로 추세 국면을 판단한다. 상장 기간이 짧으면 null */
export function computeTrend(bars: Bar[], period = DEFAULT_TREND_PERIOD): Trend | null {
  const closes = bars.map((b) => b.close);
  const last = closes.length - 1;
  const first = period - 1 + SLOPE_WIN; // 기울기를 구할 수 있는 첫 봉
  if (last < first) return null;
  const ma = smaSeries(closes, period);

  const slopeAt = (i: number): number | null => {
    const a = ma[i];
    const b = i - SLOPE_WIN >= 0 ? ma[i - SLOPE_WIN] : null;
    return a == null || b == null ? null : ((a - b) / b) * 100;
  };
  const rawAt = (i: number): Phase | null => {
    const s = slopeAt(i);
    if (s === null) return null;
    // 국면은 기준선의 모양(기울기)만으로 정한다 — 화면에 그리는 선과 항상 같은 이야기를 하도록
    if (s >= FLAT_PCT) return "up";
    if (s > -FLAT_PCT) return "flat";
    const p = slopeAt(i - SLOPE_WIN);
    return p !== null && s - p >= EASE_MIN && s >= p * 0.6 ? "easing" : "down";
  };

  // 하루 이틀 튀는 것으로 국면이 바뀌지 않도록, 며칠 이어져야 전환으로 인정한다
  const start = Math.max(first, last - LOOKBACK);
  let phase: Phase | null = null;
  let since = start;
  let cand: Phase | null = null;
  let run = 0;
  for (let i = start; i <= last; i++) {
    const r = rawAt(i);
    if (r === null) continue;
    if (phase === null) {
      phase = r;
      since = i;
    } else if (r === phase) {
      cand = null;
      run = 0;
    } else {
      if (r === cand) run++;
      else {
        cand = r;
        run = 1;
      }
      if (run >= CONFIRM_BARS) {
        phase = r;
        since = i - run + 1;
        cand = null;
        run = 0;
      }
    }
  }
  if (phase === null) return null;

  const price = closes[last];
  const cur = ma[last]!;
  const sp = slopeAt(last - SLOPE_WIN);
  return {
    price,
    period,
    ma: Math.round(cur),
    dist: r2(((price - cur) / cur) * 100),
    slope: r2(slopeAt(last)!),
    slopePrev: sp === null ? null : r2(sp),
    phase,
    days: last - since + 1,
    daysCapped: since === start && start > first,
    line: ma.slice(-LINE_POINTS).filter((v): v is number => v != null).map(Math.round),  };
}
