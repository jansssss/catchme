"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { smaSeries } from "@/lib/indicators";

type Raw = { t: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
type Bar = { t: string; o: number; h: number; l: number; c: number; v: number }; // t = YYYY-MM-DD
type Quote = { price: number; change: number; changePct: number } | null;
export type Ma = { period: number; color: string; on: boolean };
type Tf = "D" | "W" | "M";

const UP = "#ff5c61";
const DOWN = "#5b9bff";
const DEFAULT_MA: Ma[] = [
  { period: 160, color: "#c98500", on: true },
  { period: 200, color: "#199e70", on: true },
  { period: 224, color: "#9085e9", on: true },
];
const PALETTE = ["#c98500", "#199e70", "#9085e9", "#e0457b", "#3aa6d8", "#d8d8d8"];
const MAX_MA = 6;

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const shortDate = (t: string) => `${t.slice(2, 4)}.${t.slice(5, 7)}.${t.slice(8, 10)}.`;
const fmtVol = (v: number) =>
  v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e7 ? `${fmt(v / 1e4)}만` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}만` : fmt(v);

/* ───────── 이동평균선 설정 (서버에 저장, 모든 종목 공통) ───────── */

let maCache: Ma[] | null = null;

function useMas(): [Ma[], (next: Ma[]) => Promise<boolean>] {
  const [mas, setMas] = useState<Ma[]>(maCache ?? DEFAULT_MA);
  useEffect(() => {
    if (maCache) return;
    let alive = true;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        if (alive && Array.isArray(j.ma)) {
          maCache = j.ma;
          setMas(j.ma);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const save = useCallback(async (next: Ma[]) => {
    maCache = next;
    setMas(next);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ma: next }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }, []);
  return [mas, save];
}

/* ───────── 봉 가공 ───────── */

function toBars(d: Raw): Bar[] {
  return d.t.map((t, i) => ({
    t: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`,
    o: d.o[i],
    h: d.h[i],
    l: d.l[i],
    c: d.c[i],
    v: d.v[i],
  }));
}

/** 일봉을 주봉·월봉으로 묶는다 */
function aggregate(bars: Bar[], tf: Tf): Bar[] {
  if (tf === "D") return bars;
  const key = (t: string) => {
    if (tf === "M") return t.slice(0, 7);
    const ms = Date.parse(`${t}T00:00:00Z`);
    const dow = (new Date(ms).getUTCDay() + 6) % 7; // 월요일 = 0
    return String(ms - dow * 86400000);
  };
  const out: Bar[] = [];
  let cur = "";
  for (const b of bars) {
    const k = key(b.t);
    const last = out[out.length - 1];
    if (k !== cur || !last) {
      cur = k;
      out.push({ ...b });
    } else {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
    }
  }
  return out;
}

/* ───────── 카드 안: 간단 라인 차트 ───────── */

const RANGES = [
  { label: "1주", days: 7 },
  { label: "1달", days: 30 },
  { label: "3달", days: 91 },
  { label: "1년", days: 365 },
  { label: "최대", days: 0 },
];

/** 기간 시작 직전 봉(기준가)의 인덱스 */
function rangeStart(bars: Bar[], days: number) {
  if (!days) return 0;
  const last = Date.parse(`${bars[bars.length - 1].t}T00:00:00Z`);
  const cut = new Date(last - days * 86400000).toISOString().slice(0, 10);
  const i = bars.findIndex((b) => b.t >= cut);
  return Math.max(0, i - 1);
}

export default function Chart({ code, name, quote }: { code: string; name: string; quote: Quote }) {
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [err, setErr] = useState("");
  const [range, setRange] = useState(2);
  const [open, setOpen] = useState(false);
  const [mas, saveMas] = useMas();

  useEffect(() => {
    let alive = true;
    fetch(`/api/chart?code=${code}`)
      .then((r) => r.json())
      .then((j) => alive && (j.error ? setErr(j.error) : setBars(toBars(j))))
      .catch(() => alive && setErr("차트를 불러오지 못했습니다"));
    return () => {
      alive = false;
    };
  }, [code]);

  // 상세 차트는 뒤로가기로 닫힌다
  useEffect(() => {
    if (!open) return;
    const onPop = () => setOpen(false);
    window.addEventListener("popstate", onPop);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (err) return <p className="hint">{err}</p>;
  if (!bars) return <p className="hint">차트 불러오는 중…</p>;

  const lastClose = bars[bars.length - 1].c;
  const stats = RANGES.map((r) => {
    const from = rangeStart(bars, r.days);
    return { from, chg: ((lastClose - bars[from].c) / bars[from].c) * 100 };
  });
  const view = bars.slice(stats[range].from);

  return (
    <div>
      <div className="mini-top">
        <b>간단</b>
        <span>차트를 누르면 상세 차트</span>
      </div>
      <button
        className="mini"
        aria-label={`${name} 상세 차트 열기`}
        onClick={() => {
          history.pushState({ catchmeChart: true }, "");
          setOpen(true);
        }}
      >
        <MiniLine bars={view} up={stats[range].chg >= 0} />
      </button>
      <div className="ranges">
        {RANGES.map((r, i) => (
          <button key={r.label} className={i === range ? "sel" : ""} onClick={() => setRange(i)}>
            <span>{r.label}</span>
            <b className={`num ${stats[i].chg > 0 ? "up" : stats[i].chg < 0 ? "down" : "flat"}`}>{pct(stats[i].chg)}</b>
          </button>
        ))}
      </div>
      {open && <Detail name={name} quote={quote} daily={bars} mas={mas} saveMas={saveMas} onClose={() => history.back()} />}
    </div>
  );
}

function MiniLine({ bars, up }: { bars: Bar[]; up: boolean }) {
  const W = 360, H = 200, L = 6, R = 14, T = 30, B = 30;
  const n = bars.length;
  const closes = bars.map((b) => b.c);
  const base = closes[0];
  let hiI = 0, loI = 0;
  closes.forEach((v, i) => {
    if (v > closes[hiI]) hiI = i;
    if (v < closes[loI]) loI = i;
  });
  const lo = closes[loI], hi = closes[hiI];
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R);
  const y = (v: number) => (hi === lo ? (T + H - B) / 2 : T + (1 - (v - lo) / (hi - lo)) * (H - T - B));
  const d = closes.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const color = up ? "var(--up)" : "var(--down)";
  const anchor = (px: number) => (px < 90 ? "start" : px > W - 90 ? "end" : "middle");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="종가 추이">
      <line x1={L} x2={W - R} y1={y(base)} y2={y(base)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="1 4" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(hiI)} cy={y(hi) - 7} r="2" fill="var(--muted)" />
      <text x={x(hiI)} y={y(hi) - 14} fontSize="11" fill="var(--ink2)" textAnchor={anchor(x(hiI))}>
        최고 {fmt(hi)}원
      </text>
      <circle cx={x(loI)} cy={y(lo) + 7} r="2" fill="var(--muted)" />
      <text x={x(loI)} y={y(lo) + 23} fontSize="11" fill="var(--ink2)" textAnchor={anchor(x(loI))}>
        최저 {fmt(lo)}원
      </text>
      <circle cx={x(n - 1)} cy={y(closes[n - 1])} r="9" fill={color} opacity="0.18" />
      <circle cx={x(n - 1)} cy={y(closes[n - 1])} r="3.5" fill={color} />
    </svg>
  );
}

/* ───────── 전체 화면: 캔들 + 이동평균선 + 거래량 ───────── */

type Mark = { x: number; y: number; text: string };

function Detail({
  name,
  quote,
  daily,
  mas,
  saveMas,
  onClose,
}: {
  name: string;
  quote: Quote;
  daily: Bar[];
  mas: Ma[];
  saveMas: (next: Ma[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [tf, setTf] = useState<Tf>("D");
  const [ready, setReady] = useState(0);
  const [settings, setSettings] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [marks, setMarks] = useState<{ hi: Mark; lo: Mark; w: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<any>(null);
  const shownTf = useRef<Tf | null>(null);

  const view = useMemo(() => aggregate(daily, tf), [daily, tf]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const price = quote?.price ?? daily[daily.length - 1].c;
  const priceRef = useRef(price);
  priceRef.current = price;

  /** 화면에 보이는 구간의 최고·최저 표시 위치를 다시 계산 */
  const updateMarks = useCallback(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const a = api.current;
        const v = viewRef.current;
        if (!a || !v.length) return;
        const ts = a.chart.timeScale();
        const r = ts.getVisibleLogicalRange();
        if (!r) return;
        const from = Math.max(0, Math.ceil(r.from));
        const to = Math.min(v.length - 1, Math.floor(r.to));
        if (from > to) return setMarks(null);
        let hi = from, lo = from;
        for (let i = from; i <= to; i++) {
          if (v[i].h > v[hi].h) hi = i;
          if (v[i].l < v[lo].l) lo = i;
        }
        const mk = (i: number, val: number, label: string): Mark | null => {
          const x = ts.logicalToCoordinate(i);
          const y = a.candle.priceToCoordinate(val);
          if (x == null || y == null) return null;
          const diff = ((val - priceRef.current) / priceRef.current) * 100;
          return { x, y, text: `${label} ${fmt(val)}원 (${pct(diff)}, ${shortDate(v[i].t)})` };
        };
        const h = mk(hi, v[hi].h, "최고");
        const l = mk(lo, v[lo].l, "최저");
        setMarks(h && l ? { hi: h, lo: l, w: ts.width() } : null);
      })
    );
  }, []);

  // 차트 생성 (한 번)
  useEffect(() => {
    let dead = false;
    let chart: any = null;
    import("lightweight-charts").then((L) => {
      if (dead || !el.current) return;
      const priceFormat = { type: "custom" as const, minMove: 1, formatter: (p: number) => fmt(p) };
      const volFormat = { type: "custom" as const, minMove: 1, formatter: (p: number) => fmtVol(p) };
      chart = L.createChart(el.current, {
        autoSize: true,
        layout: {
          background: { color: "#0b0e14" },
          textColor: "#8089a0",
          fontSize: 11,
          attributionLogo: true,
          panes: { separatorColor: "#262b3a", enableResize: false },
        },
        grid: { vertLines: { color: "#161a24" }, horzLines: { color: "#161a24" } },
        rightPriceScale: { borderVisible: false },
        timeScale: {
          borderColor: "#262b3a",
          rightOffset: 4,
          minBarSpacing: 0.4,
          tickMarkFormatter: (time: any, type: number) => {
            const [y, m, d] = typeof time === "string" ? time.split("-").map(Number) : [time.year, time.month, time.day];
            return type === 0 ? String(y) : type === 1 ? `${m}월` : String(d);
          },
        },
        crosshair: { mode: L.CrosshairMode.Normal },
        localization: { locale: "ko-KR", dateFormat: "yyyy.MM.dd" },
      });
      const candle = chart.addSeries(L.CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
        priceFormat,
      });
      const vol = chart.addSeries(L.HistogramSeries, { priceFormat: volFormat, priceLineVisible: false, lastValueVisible: false }, 1);
      const volMa = chart.addSeries(
        L.LineSeries,
        { color: "#7c8cf8", lineWidth: 1, priceFormat: volFormat, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
        1
      );
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.18, bottom: 0 } });
      const panes = chart.panes();
      panes[0]?.setStretchFactor(4);
      panes[1]?.setStretchFactor(1);
      chart.timeScale().subscribeVisibleLogicalRangeChange(updateMarks);
      chart.timeScale().subscribeSizeChange(updateMarks);
      chart.subscribeCrosshairMove((p: any) => {
        const i = p.point && p.logical != null ? Math.round(p.logical) : null;
        setHover(i !== null && i >= 0 && i < viewRef.current.length ? i : null);
      });
      api.current = { L, chart, candle, vol, volMa, lines: [] as any[], priceFormat };
      setReady((r) => r + 1);
    });
    return () => {
      dead = true;
      api.current = null;
      shownTf.current = null;
      chart?.remove();
    };
  }, [updateMarks]);

  // 봉 데이터
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.candle.setData(view.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })));
    a.vol.setData(
      view.map((b) => ({ time: b.t, value: b.v, color: b.c >= b.o ? "rgba(255,92,97,0.55)" : "rgba(91,155,255,0.55)" }))
    );
    const vm = smaSeries(view.map((b) => b.v), 20);
    a.volMa.setData(view.flatMap((b, i) => (vm[i] == null ? [] : [{ time: b.t, value: vm[i] }])));
    if (shownTf.current !== tf) {
      shownTf.current = tf;
      const n = view.length;
      a.chart.timeScale().setVisibleLogicalRange({ from: n - (tf === "D" ? 130 : tf === "W" ? 110 : 80), to: n + 3 });
    }
    updateMarks();
  }, [ready, view, tf, updateMarks]);

  // 이동평균선
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    for (const s of a.lines) a.chart.removeSeries(s);
    const closes = view.map((b) => b.c);
    a.lines = mas
      .filter((m) => m.on)
      .map((m) => {
        const s = a.chart.addSeries(a.L.LineSeries, {
          color: m.color,
          lineWidth: 2,
          priceFormat: a.priceFormat,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        const ma = smaSeries(closes, m.period);
        s.setData(view.flatMap((b, i) => (ma[i] == null ? [] : [{ time: b.t, value: ma[i] }])));
        return s;
      });
    updateMarks();
  }, [ready, view, mas, updateMarks]);

  const hb = hover !== null ? view[hover] : null;
  const prevC = hover !== null && hover > 0 ? view[hover - 1].c : null;
  const clampX = (m: Mark, w: number) => (w > 240 ? Math.max(118, Math.min(w - 118, m.x)) : w / 2);
  const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={`${name} 상세 차트`}>
      <div className="dhead">
        <button className="dback" onClick={onClose} aria-label="닫기">
          ←
        </button>
        <div className="dtitle">
          <div className="nm">{name}</div>
          <div className="num">
            <b>{fmt(price)}원</b>
            {quote && <span className={tone(quote.change)}> {pct(quote.changePct)}</span>}
          </div>
        </div>
        <span className="dback" aria-hidden />
      </div>

      <div className="dbar">
        {(["D", "W", "M"] as Tf[]).map((k) => (
          <button key={k} className={tf === k ? "sel" : ""} onClick={() => setTf(k)} aria-pressed={tf === k}>
            {k === "D" ? "일" : k === "W" ? "주" : "월"}
          </button>
        ))}
        <span className="sp" />
        <button className="gear" onClick={() => setSettings(true)}>
          ⚙ 이평선 설정
        </button>
      </div>

      <div className="dchart">
        <div className="dcanvas" ref={el} />
        <div className="dlegend">
          <div>
            <span className="k">이동평균선</span>
            {mas.filter((m) => m.on).map((m) => (
              <b key={`${m.period}${m.color}`} style={{ color: m.color }}>
                {m.period}
              </b>
            ))}
            {mas.some((m) => m.on) ? <span className="k">SMA</span> : <span className="k">없음</span>}
          </div>
          {hb && (
            <div className="num ohlc">
              <span>{shortDate(hb.t)}</span>
              <span>시 {fmt(hb.o)}</span>
              <span>고 {fmt(hb.h)}</span>
              <span>저 {fmt(hb.l)}</span>
              <span>
                종 {fmt(hb.c)}
                {prevC ? <i className={tone(hb.c - prevC)}> {pct(((hb.c - prevC) / prevC) * 100)}</i> : null}
              </span>
              <span>거래량 {fmtVol(hb.v)}</span>
            </div>
          )}
        </div>
        {marks && !hb && (
          <>
            <div className="dmark up" style={{ left: marks.hi.x, top: marks.hi.y - 20 }}>↓</div>
            <div className="dmark up txt" style={{ left: clampX(marks.hi, marks.w), top: marks.hi.y - 38 }}>
              {marks.hi.text}
            </div>
            <div className="dmark down" style={{ left: marks.lo.x, top: marks.lo.y + 2 }}>↑</div>
            <div className="dmark down txt" style={{ left: clampX(marks.lo, marks.w), top: marks.lo.y + 20 }}>
              {marks.lo.text}
            </div>
          </>
        )}
      </div>

      {settings && (
        <MaSettings
          mas={mas}
          onClose={() => setSettings(false)}
          onSave={async (next) => {
            setSettings(false);
            await saveMas(next);
          }}
        />
      )}
    </div>
  );
}

/* ───────── 이동평균선 설정 시트 ───────── */

function MaSettings({ mas, onClose, onSave }: { mas: Ma[]; onClose: () => void; onSave: (next: Ma[]) => Promise<void> }) {
  const [rows, setRows] = useState(() => mas.map((m) => ({ ...m, text: String(m.period) })));
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const valid = rows.every((r) => {
    const p = Number(r.text);
    return Number.isInteger(p) && p >= 2 && p <= 600;
  });

  return (
    <div className="sheetwrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h4>이동평균선 설정</h4>
        <p className="hint">기간은 2~600. 일·주·월 차트에서 각각 그 봉 개수 기준으로 계산됩니다.</p>
        {rows.map((r, i) => (
          <div className="marow" key={i}>
            <button
              className={`sw ${r.on ? "on" : ""}`}
              role="switch"
              aria-checked={r.on}
              aria-label={`${r.text}선 표시`}
              onClick={() => set(i, { on: !r.on })}
            >
              <i />
            </button>
            <input
              className="field num"
              inputMode="numeric"
              aria-label="기간"
              value={r.text}
              onChange={(e) => set(i, { text: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
            />
            <span className="unit">선</span>
            <input type="color" aria-label="선 색상" value={r.color} onChange={(e) => set(i, { color: e.target.value })} />
            <button className="del" aria-label="이 선 삭제" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
        ))}
        {rows.length < MAX_MA && (
          <button
            className="btn sm block"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                { period: 20, text: "20", on: true, color: PALETTE.find((c) => !rs.some((r) => r.color === c)) ?? PALETTE[0] },
              ])
            }
          >
            + 선 추가
          </button>
        )}
        <div className="row">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => onSave(rows.map((r) => ({ period: Number(r.text), color: r.color, on: r.on })))}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
