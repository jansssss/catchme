"use client";
import { useEffect, useRef, useState } from "react";

type Data = {
  dates: string[];
  close: number[];
  ma160: (number | null)[];
  ma200: (number | null)[];
  ma224: (number | null)[];
};

const SERIES = [
  { key: "close", label: "종가", color: "var(--ink)", w: 2 },
  { key: "ma160", label: "160일선", color: "var(--ma160)", w: 2 },
  { key: "ma200", label: "200일선", color: "var(--ma200)", w: 2 },
  { key: "ma224", label: "224일선", color: "var(--ma224)", w: 2 },
] as const;

const W = 360, H = 210, L = 6, R = 52, T = 8, B = 22;
const fmtDate = (d: string) => `${d.slice(2, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
const fmt = (n: number) => n.toLocaleString("ko-KR");

export default function Chart({ code }: { code: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/chart?code=${code}`)
      .then((r) => r.json())
      .then((j) => alive && (j.error ? setErr(j.error) : setData(j)))
      .catch(() => alive && setErr("차트를 불러오지 못했습니다"));
    return () => {
      alive = false;
    };
  }, [code]);

  if (err) return <p className="hint">{err}</p>;
  if (!data) return <p className="hint">차트 불러오는 중…</p>;

  const n = data.dates.length;
  const all = SERIES.flatMap((s) => (data[s.key] as (number | null)[]).filter((v): v is number => v != null));
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad;
  hi += pad;
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = (arr: (number | null)[]) => {
    let d = "", pen = false;
    arr.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const ticks = [0.1, 0.5, 0.9].map((t) => lo + (hi - lo) * t);

  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const hi_ = hover ?? n - 1;
  const tipLeft = hover !== null && x(hover) / W > 0.5 ? 4 : undefined;

  return (
    <div>
      <div className="legend">
        {SERIES.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div
        className="chart"
        ref={box}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="최근 180거래일 종가와 160·200·224일 이동평균선">
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={W - R + 6} y={y(t) + 4} fontSize="10" fill="var(--muted)">
                {fmt(Math.round(t))}
              </text>
            </g>
          ))}
          {[0, Math.floor((n - 1) / 2), n - 1].map((i, k) => (
            <text
              key={k}
              x={x(i)}
              y={H - 6}
              fontSize="10"
              fill="var(--muted)"
              textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
            >
              {fmtDate(data.dates[i])}
            </text>
          ))}
          {[...SERIES].reverse().map((s) => (
            <path
              key={s.key}
              d={path(data[s.key] as (number | null)[])}
              fill="none"
              stroke={s.color}
              strokeWidth={s.w}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth="1" />
              {SERIES.map((s) => {
                const v = (data[s.key] as (number | null)[])[hover];
                return v == null ? null : (
                  <circle key={s.key} cx={x(hover)} cy={y(v)} r="4" fill={s.color} stroke="var(--card2)" strokeWidth="2" />
                );
              })}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="tip" style={tipLeft !== undefined ? { left: tipLeft } : { right: R }}>
            <div className="d">{fmtDate(data.dates[hi_])}</div>
            {SERIES.map((s) => {
              const v = (data[s.key] as (number | null)[])[hi_];
              return (
                <div className="r" key={s.key}>
                  <span>
                    <i style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <b>{v == null ? "–" : fmt(v)}</b>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
