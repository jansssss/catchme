import type { Bar } from "./naver";

export const DEFAULT_TREND_PERIOD = 224; // 추세를 판단하는 기준 이평선
export const SLOPE_WIN = 20; // 기울기 = 기준선이 최근 20거래일 동안 움직인 비율(%)
export const FLAT_PCT = 1; // 기울기가 ±1% 안이면 수평
export const EASE_MIN = 0.5; // 기울기가 한 달 전보다 이만큼(%p) 줄었으면 "오르던 선이 눕는 중"
export const BREAK_PCT = 3; // 현재가가 기준선보다 이만큼(%) 넘게 아래면 "선 아래로 이탈"
export const LOW_WIN = 60; // 신저가를 따질 구간(약 석 달)
export const LOW_HOLD = 20; // 석 달 최저가를 찍고 이만큼(거래일) 안 깨져야 "신저가 멈춤"
export const DIP_NEAR = 2; // 눌림목: 현재가가 20일선보다 +2% 이내(또는 그 아래)
export const DIP_FLOOR = 3; // 눌림목: 60일선보다 3% 넘게 아래로 깨지면 눌림이 아니라 이탈
export const DIP_PULL = 3; // 눌림목: 최근 20일 고점에서 3% 이상 내려왔을 것
export const CONFIRM_BARS = 3; // 새 국면이 3거래일 이어져야 바뀐 것으로 본다
const CONFIRM_DIP = 2; // 상승 추세 ↔ 눌림목은 기회가 짧으므로 2거래일
const LOOKBACK = 250; // 국면이 며칠째인지 거슬러 볼 최대 거래일
const LINE_POINTS = 250; // 미리보기로 그릴 길이(약 1년)

/** 하락 → 다지기 → 상승 추세 → 눌림목(매수 구간) */
export type Phase = "down" | "base" | "up" | "dip";
export const PHASE_LABEL: Record<Phase, string> = {
  down: "하락",
  base: "다지기",
  up: "상승 추세",
  dip: "눌림목",
};

/** 매수 전 확인할 다섯 가지. 전부 충족되면 눌림목(매수 검토) */
export type Checks = {
  lowHold: boolean; // ① 신저가가 멈췄다
  lineOk: boolean; // ② 기준선이 더 내려가지 않는다
  above: boolean; // ③ 주가가 기준선 위에 있다
  aligned: boolean; // ④ 기준선이 오르고 20일선이 60일선 위 (상승 추세 확인)
  dip: boolean; // ⑤ 상승 추세 안에서 20일선 근처까지 눌렸다
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
  checks: Checks;
  broke: boolean; // 기준선은 아직 안 내려가는데 주가가 선 아래로 무너짐 (고점에서 꺾임)
  sinceLow: number; // 최근 석 달 최저 종가를 찍은 뒤 지난 거래일
  ma20: number;
  ma60: number;
  d20: number; // 현재가가 20일선 대비 몇 %
  pull: number; // 최근 20일 고점 대비 몇 % (0 이하)
  volRatio: number | null; // 최근 5일 평균 거래량 ÷ 20일 평균
  stop: number; // 최근 20거래일 최저가 — 손절 기준 후보
  line: number[]; // 기준선 최근 값들 (미리보기용)
  prices: number[]; // 같은 기간의 종가 (미리보기용)
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

/**
 * "떨어지는 칼날은 잡지 않고, 바닥을 다진 뒤 돌아선 종목을 눌림목에서 산다"는 순서대로
 * 지금 어느 단계인지 판단한다. 상장 기간이 짧으면 null
 */
export function computeTrend(bars: Bar[], period = DEFAULT_TREND_PERIOD): Trend | null {
  const closes = bars.map((b) => b.close);
  const last = closes.length - 1;
  const first = Math.max(period - 1 + SLOPE_WIN, LOW_WIN); // 모든 값을 구할 수 있는 첫 봉
  if (last < first) return null;
  const ma = smaSeries(closes, period);
  const ma20 = smaSeries(closes, 20);
  const ma60 = smaSeries(closes, 60);

  const slopeAt = (i: number): number | null => {
    const a = ma[i];
    const b = i - SLOPE_WIN >= 0 ? ma[i - SLOPE_WIN] : null;
    return a == null || b == null ? null : ((a - b) / b) * 100;
  };

  const stateAt = (i: number) => {
    const s = slopeAt(i);
    const m = ma[i], m20 = ma20[i], m60 = ma60[i];
    if (s === null || m == null || m20 == null || m60 == null) return null;
    const c = closes[i];
    const p = slopeAt(i - SLOPE_WIN);
    const dist = ((c - m) / m) * 100;

    // ① 석 달 최저 종가를 찍은 지 며칠 지났나
    let lowI = i;
    for (let k = i; k > i - LOW_WIN && k >= 0; k--) if (closes[k] < closes[lowI]) lowI = k;
    const sinceLow = i - lowI;
    let hi20 = c;
    for (let k = i; k > i - 20 && k >= 0; k--) if (closes[k] > hi20) hi20 = closes[k];
    const d20 = ((c - m20) / m20) * 100;
    const pull = ((c - hi20) / hi20) * 100;

    const lowHold = sinceLow >= LOW_HOLD;
    const lineOk = s > -FLAT_PCT;
    const above = dist >= 0;
    const aligned = s >= FLAT_PCT && m20 > m60;
    const trendOk = lowHold && lineOk && above && aligned; // ①~④
    const checks: Checks = {
      lowHold,
      lineOk,
      above,
      aligned,
      // 눌림목은 상승 추세 안에서만 뜻이 있다 — 하락 중에 20일선 아래인 것은 눌림이 아니라 그냥 하락
      dip: trendOk && d20 <= DIP_NEAR && c >= m60 * (1 - DIP_FLOOR / 100) && pull <= -DIP_PULL,
    };
    // 기준선은 느려서 주가가 고점에서 무너져도 한동안 오르거나 눕기만 한다.
    // 그런 상태에서 주가가 선 아래로 크게 벌어졌으면 바닥이 아니라 꺾인 것이다.
    const rolling = s < FLAT_PCT && p !== null && s - p <= -EASE_MIN;
    const broke = checks.lineOk && dist < -BREAK_PCT && (s >= FLAT_PCT || rolling);

    // 조건을 순서대로 채워야 다음 단계로 간다: ①② → 다지기, ①~④ → 상승 추세, ①~⑤ → 눌림목
    let phase: Phase = "down";
    if (trendOk) phase = checks.dip ? "dip" : "up";
    else if (lowHold && lineOk && !broke) phase = "base";
    return { phase, checks, broke, sinceLow, s, p, dist, m, m20, m60, d20, pull };
  };

  // 하루 이틀 튀는 것으로 국면이 바뀌지 않도록, 며칠 이어져야 전환으로 인정한다
  const start = Math.max(first, last - LOOKBACK);
  let phase: Phase | null = null;
  let since = start;
  let cand: Phase | null = null;
  let run = 0;
  for (let i = start; i <= last; i++) {
    const r = stateAt(i)?.phase;
    if (!r) continue;
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
      const quick = (r === "dip" || r === "up") && (phase === "dip" || phase === "up");
      if (run >= (quick ? CONFIRM_DIP : CONFIRM_BARS)) {
        phase = r;
        since = i - run + 1;
        cand = null;
        run = 0;
      }
    }
  }
  const now = stateAt(last);
  if (phase === null || !now) return null;

  const vols = bars.map((b) => b.volume);
  const avg = (n: number) => vols.slice(-n).reduce((a, b) => a + b, 0) / n;
  const v20 = avg(20);
  const lows = bars.slice(-20).map((b) => b.low || b.close);

  return {
    price: closes[last],
    period,
    ma: Math.round(now.m),
    dist: r2(now.dist),
    slope: r2(now.s),
    slopePrev: now.p === null ? null : r2(now.p),
    phase,
    days: last - since + 1,
    daysCapped: since === start && start > first,
    checks: now.checks,
    broke: now.broke,
    sinceLow: now.sinceLow,
    ma20: Math.round(now.m20),
    ma60: Math.round(now.m60),
    d20: r2(now.d20),
    pull: r2(now.pull),
    volRatio: v20 > 0 ? r2(avg(5) / v20) : null,
    stop: Math.min(...lows),
    line: ma.slice(-LINE_POINTS).filter((v): v is number => v != null).map(Math.round),
    prices: closes.slice(-LINE_POINTS),
  };
}
