"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Chart from "./Chart";

type Alert = { id: number; kind: string; value: number; active: boolean; firedAt: string | null };
type Phase = "down" | "base" | "up" | "dip";
type Checks = { lowHold: boolean; lineOk: boolean; above: boolean; aligned: boolean; dip: boolean };
type Trend = {
  price: number;
  period: number;
  ma: number;
  dist: number;
  slope: number;
  slopePrev: number | null;
  phase: Phase;
  days: number;
  daysCapped: boolean;
  checks: Checks;
  broke: boolean;
  sinceLow: number;
  ma20: number;
  ma60: number;
  d20: number;
  pull: number;
  volRatio: number | null;
  stop: number;
  line: number[];
  prices: number[];
};
type Stock = {
  code: string;
  name: string;
  market: string;
  buyPrice: number | null;
  quote: { price: number; change: number; changePct: number; open: boolean } | null;
  trend: Trend | null;
  trendShort: boolean;
  alerts: Alert[];
};
type Found = { code: string; name: string; market: string };
type Log = { id: number; title: string; body: string; created_at: string };

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
// 떨어지는 동안은 사지 않고 → 바닥을 다지는지 보고 → 추세가 돌아선 뒤 → 눌릴 때 산다
const PHASES: { key: Phase; label: string; act: string }[] = [
  { key: "down", label: "하락", act: "사지 않는다" },
  { key: "base", label: "다지기", act: "지켜보기" },
  { key: "up", label: "상승 추세", act: "눌림 기다리기" },
  { key: "dip", label: "눌림목", act: "매수 검토" },
];

/** 호가 단위에 맞춰 내림 */
function tick(p: number) {
  const u = p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
  return Math.floor(p / u) * u;
}

async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) throw new Error("401");
  return r.json();
}

function b64ToBytes(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function Page() {
  const [stocks, setStocks] = useState<Stock[] | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pushReady, setPushReady] = useState(true);
  const [trendPeriod, setTrendPeriod] = useState(224);
  const [push, setPush] = useState<"unknown" | "on" | "off" | "denied" | "unsupported" | "ios-install">("unknown");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const load = useCallback(async () => {
    try {
      const [w, l] = await Promise.all([api("/api/watch"), api("/api/logs")]);
      if (w.error) {
        setError(w.error);
        return;
      }
      setError("");
      setStocks(w.stocks);
      setPushReady(w.pushReady);
      if (w.trendPeriod) setTrendPeriod(w.trendPeriod);
      setLogs(l.logs ?? []);
      setLocked(false);
    } catch (e: any) {
      if (e.message === "401") setLocked(true);
      else setError("서버에 연결하지 못했습니다");
    }
  }, []);

  // 최초 로드 + 20초마다 갱신 (화면이 보일 때만)
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 20000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  // 푸시 상태 확인
  useEffect(() => {
    (async () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setPush(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      if (Notification.permission === "denied") return setPush("denied");
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") {
        setPush("on");
        api("/api/push", "POST", sub.toJSON()).catch(() => {});
      } else setPush("off");
    })().catch(() => setPush("unsupported"));
  }, []);

  const enablePush = async () => {
    try {
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) return say("서버에 푸시 키가 설정되지 않았습니다");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setPush(perm === "denied" ? "denied" : "off");
        return say("알림 권한이 필요합니다");
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
      await api("/api/push", "POST", sub.toJSON());
      setPush("on");
      await api("/api/push", "PUT");
      say("알림 켜짐 — 테스트 알림을 보냈습니다");
    } catch {
      say("알림 설정에 실패했습니다");
    }
  };

  const testPush = async () => {
    const r = await api("/api/push", "PUT");
    say(r.sent ? "테스트 알림을 보냈습니다" : "알림을 받을 기기가 없습니다");
  };

  if (locked) return <Pin onDone={load} />;

  const open = stocks?.some((s) => s.quote?.open);

  return (
    <main className="app">
      <header className="top">
        <div className="logo">
          캐치<i>미</i>
        </div>
        {stocks && stocks.length > 0 && <span className={`mkt ${open ? "open" : ""}`}>{open ? "장중" : "장마감"}</span>}
        <span className="sp" />
        {push === "on" && (
          <button className="iconbtn on" onClick={testPush}>
            🔔 알림 켜짐
          </button>
        )}
      </header>

      {!pushReady && (
        <div className="banner warn">
          <b>푸시 키가 설정되지 않았습니다</b>
          <p style={{ margin: 0 }}>서버 환경변수(VAPID)를 설정해야 알림이 발송됩니다.</p>
        </div>
      )}
      {push === "off" && (
        <div className="banner">
          <b>📲 이 기기로 알림 받기</b>
          <p>앱을 닫아 두어도 설정한 가격에 도달하면 알려 드립니다.</p>
          <button className="btn primary block" onClick={enablePush}>
            알림 켜기
          </button>
        </div>
      )}
      {push === "ios-install" && (
        <div className="banner warn">
          <b>홈 화면에 추가해 주세요</b>
          <p style={{ margin: 0 }}>
            아이폰은 Safari 하단의 <b style={{ display: "inline" }}>공유 → 홈 화면에 추가</b> 후, 홈 화면의 캐치미 아이콘으로 실행해야
            알림을 받을 수 있습니다.
          </p>
        </div>
      )}
      {push === "denied" && (
        <div className="banner warn">
          <b>알림이 차단되어 있습니다</b>
          <p style={{ margin: 0 }}>휴대폰 설정 → 알림에서 캐치미(또는 브라우저) 알림을 허용해 주세요.</p>
        </div>
      )}
      {push === "unsupported" && (
        <div className="banner warn">
          <b>이 브라우저는 푸시 알림을 지원하지 않습니다</b>
          <p style={{ margin: 0 }}>Chrome(안드로이드) 또는 홈 화면에 추가한 Safari(아이폰)에서 열어 주세요.</p>
        </div>
      )}

      <Search
        have={stocks?.map((s) => s.code) ?? []}
        onAdd={async (f) => {
          await api("/api/watch", "POST", f);
          say(`${f.name} 추가됨`);
          load();
        }}
      />

      {error && (
        <div className="banner warn">
          <b>문제가 발생했습니다</b>
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      {stocks === null && !error && <div className="emptybox">불러오는 중…</div>}
      {stocks?.length === 0 && (
        <div className="emptybox">
          <b>캐치할 종목을 추가해 보세요</b>
          위 검색창에 종목명을 입력하면 됩니다.
        </div>
      )}
      {stocks?.map((s) => <Card key={s.code} s={s} reload={load} say={say} />)}

      {logs.length > 0 && (
        <>
          <div className="sect">
            <h3>알림 기록</h3>
            <button
              onClick={async () => {
                if (!confirm("알림 기록을 모두 지울까요?")) return;
                await api("/api/logs", "DELETE");
                load();
              }}
            >
              지우기
            </button>
          </div>
          {logs.map((l) => (
            <div className="log" key={l.id}>
              <b>{l.title}</b>
              <span>{l.body}</span>
              <time>
                {new Date(l.created_at).toLocaleString("ko-KR", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          ))}
        </>
      )}

      {stocks && stocks.length > 0 && (
        <TrendSetting
          period={trendPeriod}
          onSave={async (p) => {
            const r = await api("/api/settings", "PUT", { trendPeriod: p });
            if (r.error) return say(r.error);
            say(`추세 기준선을 ${p}일선으로 변경`);
            load();
          }}
        />
      )}

      <p className="foot">
        단계는 매수 조건 다섯 가지로 정합니다 · ① 신저가 멈춤 = 석 달 최저 종가를 찍고 20거래일 넘게 안 깨짐 · ② {trendPeriod}일선
        하락 멈춤 = 최근 20거래일 변화율이 -1%보다 큼 · ③ 주가가 {trendPeriod}일선 위 · ④ 상승 추세 확인 = {trendPeriod}일선이 +1% 이상
        오르고 20일선이 60일선 위 · ⑤ 눌림목 = 20일 고점에서 3% 이상 내려와 20일선 +2% 이내, 60일선은 지킴 · ①②가 되면 다지기,
        ①~④면 상승 추세, 다섯 개 모두면 눌림목 · 선이 아직 안 내려가도 주가가 선보다 3% 넘게 아래로 무너졌으면 하락으로 봅니다
        · 새 단계가 3거래일(상승 추세↔눌림목은 2거래일) 이어지면 전환으로 봅니다
        <br />
        조건이 맞아도 수익이 보장되지는 않습니다. 손절 기준을 정하고 나눠서 매수하세요.
        <br />
        시세는 네이버 금융 기준이며 장중 약 5분 간격으로 확인합니다. 투자 판단과 책임은 본인에게 있습니다.
      </p>

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function Pin({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    setBusy(false);
    if (r.ok) onDone();
    else setErr("비밀번호가 틀렸습니다");
  };
  return (
    <main className="app">
      <form className="pin" onSubmit={go}>
        <div className="logo">
          캐치<i>미</i>
        </div>
        <input
          className="field"
          type="password"
          inputMode="numeric"
          autoFocus
          placeholder="비밀번호"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <div className="err">{err}</div>
        <button className="btn primary block" disabled={!pin || busy}>
          들어가기
        </button>
      </form>
    </main>
  );
}

function Search({ have, onAdd }: { have: string[]; onAdd: (f: Found) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Found[] | null>(null);

  useEffect(() => {
    const s = q.trim();
    if (!s) {
      setItems(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const j = await api(`/api/search?q=${encodeURIComponent(s)}`);
        if (alive) setItems(j.items ?? []);
      } catch {
        if (alive) setItems([]);
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="search">
      <span className="mag">🔍</span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="종목명 또는 코드 검색"
        enterKeyHint="search"
        autoComplete="off"
        aria-label="종목 검색"
      />
      {items && (
        <div className="results">
          {items.length === 0 && <div className="empty">검색 결과가 없습니다</div>}
          {items.map((it) => {
            const added = have.includes(it.code);
            return (
              <button
                key={it.code}
                disabled={added}
                onClick={async () => {
                  setQ("");
                  setItems(null);
                  await onAdd(it);
                }}
              >
                {it.name}
                <span className="code num">{it.code}</span>
                <span className="tag">{it.market}</span>
                <span className="add" style={added ? { color: "var(--muted)" } : undefined}>
                  {added ? "추가됨" : "+ 추가"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Card({ s, reload, say }: { s: Stock; reload: () => Promise<void>; say: (m: string) => void }) {
  const [panel, setPanel] = useState<null | "price" | "stop" | "chart">(null);
  const [autoDetail, setAutoDetail] = useState(false); // 추세 그래프를 눌러 상세 차트를 바로 여는 경우
  const t = s.trend;
  const price = s.quote?.price ?? t?.price ?? 0;
  const phaseAlert = s.alerts.find((a) => a.kind === "phase");
  const chips = s.alerts.filter((a) => ["price_up", "price_down", "stop"].includes(a.kind));
  const toggle = (k: typeof panel) => setPanel(panel === k ? null : k);

  const togglePhase = async () => {
    if (phaseAlert) await api(`/api/alerts?id=${phaseAlert.id}`, "DELETE");
    else await api("/api/alerts", "POST", { code: s.code, kind: "phase" });
    say(phaseAlert ? "국면 전환 알림 끔" : "국면이 바뀌면 알림");
    reload();
  };

  const pl = s.buyPrice && price ? ((price - s.buyPrice) / s.buyPrice) * 100 : null;

  return (
    <section className={`card ${t ? `ph-${t.phase}` : ""}`}>
      <div className="head">
        <div>
          <div className="nm">{s.name}</div>
          <div className="sub">
            <span className="num">{s.code}</span>
            <span className="tag">{s.market}</span>
            {pl !== null && (
              <span className={`num ${tone(pl)}`}>
                매수 {fmt(s.buyPrice!)} · {pct(pl)}
              </span>
            )}
          </div>
        </div>
        <div className="px">
          <div className={`price num ${tone(s.quote?.change ?? 0)}`}>{price ? fmt(price) : "–"}</div>
          {s.quote && (
            <div className={`chg num ${tone(s.quote.change)}`}>
              {s.quote.change > 0 ? "▲" : s.quote.change < 0 ? "▼" : ""} {fmt(Math.abs(s.quote.change))} ·{" "}
              {pct(s.quote.changePct)}
            </div>
          )}
        </div>
      </div>

      {t ? (
        <TrendView
          t={t}
          alertOn={!!phaseAlert}
          onBell={togglePhase}
          onChart={() => {
            setPanel("chart");
            setAutoDetail(true);
          }}
        />
      ) : (
        s.trendShort && <div className="trend none">상장 기간이 짧아 추세를 계산할 수 없습니다</div>
      )}

      {chips.length > 0 && (
        <div className="chips">
          {chips.map((a) => (
            <span key={a.id} className={`chip num ${a.kind === "stop" ? "stop" : ""} ${a.active ? "" : "off"}`}>
              {a.kind === "stop" ? "🚨 손절 " : "🎯 "}
              {fmt(a.value)}
              {a.kind === "price_up" ? " 이상" : a.kind === "price_down" ? " 이하" : ""}
              {!a.active && (
                <button
                  className="re"
                  onClick={async () => {
                    await api("/api/alerts", "PATCH", { id: a.id, active: true });
                    reload();
                  }}
                >
                  울림 · 다시 켜기
                </button>
              )}
              <button
                className="x"
                aria-label="알림 삭제"
                onClick={async () => {
                  await api(`/api/alerts?id=${a.id}`, "DELETE");
                  reload();
                }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="acts">
        <button className={`btn ${panel === "price" ? "act" : ""}`} onClick={() => toggle("price")}>
          🎯 가격
        </button>
        <button className={`btn ${panel === "stop" ? "act" : ""}`} onClick={() => toggle("stop")}>
          🚨 손절
        </button>
        <button className={`btn ${panel === "chart" ? "act" : ""}`} onClick={() => toggle("chart")}>
          📈 차트
        </button>
        <button
          className="btn"
          onClick={async () => {
            if (!confirm(`${s.name}을(를) 목록에서 삭제할까요? 설정한 알림도 함께 지워집니다.`)) return;
            await api(`/api/watch?code=${s.code}`, "DELETE");
            reload();
          }}
        >
          삭제
        </button>
      </div>

      {panel === "price" && (
        <PricePanel
          price={price}
          onSave={async (kind, value) => {
            await api("/api/alerts", "POST", { code: s.code, kind, value });
            say(`${fmt(value)}원 ${kind === "price_up" ? "이상" : "이하"} 알림 설정`);
            setPanel(null);
            reload();
          }}
        />
      )}
      {panel === "stop" && (
        <StopPanel
          price={price}
          buyPrice={s.buyPrice}
          onSave={async (buy, stop) => {
            await api("/api/watch", "PATCH", { code: s.code, buyPrice: buy });
            for (const a of s.alerts.filter((a) => a.kind === "stop")) await api(`/api/alerts?id=${a.id}`, "DELETE");
            await api("/api/alerts", "POST", { code: s.code, kind: "stop", value: stop });
            say(`손절가 ${fmt(stop)}원 알림 설정`);
            setPanel(null);
            reload();
          }}
          onClear={async () => {
            await api("/api/watch", "PATCH", { code: s.code, buyPrice: null });
            for (const a of s.alerts.filter((a) => a.kind === "stop")) await api(`/api/alerts?id=${a.id}`, "DELETE");
            setPanel(null);
            reload();
          }}
        />
      )}
      {panel === "chart" && (
        <div className="panel">
          <Chart code={s.code} name={s.name} quote={s.quote} autoOpen={autoDetail} onAutoOpened={() => setAutoDetail(false)} />
        </div>
      )}
    </section>
  );
}

function TrendView({ t, alertOn, onBell, onChart }: { t: Trend; alertOn: boolean; onBell: () => void; onChart: () => void }) {
  const idx = PHASES.findIndex((p) => p.key === t.phase);
  // 기준선(굵은 선)과 주가(가는 선)를 약 1년치 같은 눈금에 그리고, 맨 오른쪽 최근 구간을 상자로 강조한다
  // — 선이 내려오다 눕는지·고개를 드는지, 주가가 선 위인지 아래로 무너졌는지가 그대로 보이도록
  const W = 320, H = 120, PX = 8, PT = 20, PB = 10;
  const prices = t.prices?.length ? t.prices : t.line;
  const n = prices.length;
  const off = n - t.line.length; // 기준선이 주가보다 짧으면 오른쪽 정렬
  const RECENT = Math.min(40, t.line.length - 1); // 강조할 최근 구간(약 2달)
  let lo = Math.min(...t.line, ...prices), hi = Math.max(...t.line, ...prices);
  // 거의 수평인 흐름이 과장되어 보이지 않도록 세로 범위를 최소 8%로 잡는다
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, mid * 0.04);
  lo = mid - half;
  hi = mid + half;
  const x = (i: number) => PX + (i / Math.max(1, n - 1)) * (W - 2 * PX);
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const path = (vs: number[], from: number, to: number, o: number) =>
    vs
      .slice(from, to)
      .map((v, i) => `${i ? "L" : "M"}${x(i + from + o).toFixed(1)},${y(v).toFixed(1)}`)
      .join("");
  const cutL = t.line.length - 1 - RECENT;
  const dOld = path(t.line, 0, cutL + 1, off);
  const dNew = path(t.line, cutL, t.line.length, off);
  const dPrice = path(prices, 0, n, 0);
  const boxX = x(cutL + off) - 3;
  const c = t.checks;
  const trendOk = c.lowHold && c.lineOk && c.above && c.aligned; // ①~④
  const deep = t.price < t.ma60 * 0.97; // 60일선 아래로 깊게 밀림
  // 지금 왜 이 단계인지 한 줄
  const why =
    t.phase === "down"
      ? !c.lowHold
        ? `${t.sinceLow === 0 ? "오늘" : `${t.sinceLow}거래일 전에`} 석 달 신저가 · 바닥 확인 전`
        : !c.lineOk
          ? `${t.period}일선이 아직 내려가는 중 · 반등해도 기다리기`
          : `주가가 ${t.period}일선 아래로 무너진 상태 · 싸 보여도 기다리기`
      : t.phase === "base"
        ? c.above
          ? `하락은 멈춤 · ${t.period}일선이 오르기 시작하는지 확인`
          : `하락은 멈춤 · 주가가 ${t.period}일선 위로 올라설 때까지 대기`
        : t.phase === "up"
          ? deep
            ? "조정이 깊음 · 60일선을 되찾는지 확인"
            : `추격 매수 금지 · 20일선(${fmt(t.ma20)}원)까지 눌릴 때 검토`
          : "오르는 추세 안에서 20일선 근처까지 조정 · 나눠서 매수 검토";
  const rows: { ok: boolean; wait?: boolean; label: string; fact: string }[] = [
    {
      ok: c.lowHold,
      label: "신저가 멈춤",
      fact:
        t.sinceLow === 0
          ? "오늘 석 달 최저가"
          : !c.lowHold
            ? `${t.sinceLow}거래일 전 석 달 최저가`
            : t.sinceLow >= 59
              ? "석 달째 저점 안 깨짐"
              : `저점 후 ${t.sinceLow}거래일째 지킴`,
    },
    { ok: c.lineOk, label: `${t.period}일선 하락 멈춤`, fact: `20일간 ${pct(t.slope)}` },
    { ok: c.above, label: `주가가 ${t.period}일선 위`, fact: `선 ${t.dist >= 0 ? "위" : "아래"} ${pct(t.dist)}` },
    {
      ok: c.aligned,
      label: "상승 추세 확인",
      fact: c.aligned ? "선 상승 · 20일선 > 60일선" : t.slope < 1 ? `${t.period}일선이 아직 안 오름` : "20일선이 60일선 아래",
    },
    {
      ok: c.dip,
      wait: !trendOk,
      label: "눌림목",
      fact: !trendOk
        ? "추세 확인 뒤에 봄"
        : c.dip
          ? `20일선 대비 ${pct(t.d20)} · 고점 대비 ${pct(t.pull)}`
          : deep
            ? "60일선 아래 · 눌림이 아니라 이탈"
            : t.d20 > 2
              ? `20일선보다 ${pct(t.d20)} 위 · 아직 높음`
              : "고점 대비 조정 폭 부족",
    },
  ];
  const met = rows.filter((r) => r.ok).length;
  const stopPct = ((t.stop - t.price) / t.price) * 100;

  return (
    <div className={`trend ph-${t.phase}`}>
      <ol className="steps" aria-label={`추세 국면: ${PHASES[idx].label}`}>
        {PHASES.map((p, i) => (
          <li key={p.key} className={i === idx ? "on" : i < idx ? "past" : ""} aria-current={i === idx ? "step" : undefined}>
            <i />
            <span>{p.label}</span>
          </li>
        ))}
      </ol>
      <div className="tbody">
        <div className="ttxt">
          <div className="th">
            <b>{PHASES[idx].label}</b>
            <span>{PHASES[idx].act}</span>
          </div>
          <div>{why}</div>
          <div className="num tdays">{t.daysCapped ? `${t.days}거래일 넘게 지속` : `${t.days}거래일째`}</div>
        </div>
        <button className={`bell ${alertOn ? "on" : ""}`} onClick={onBell} aria-label="단계 전환 알림" aria-pressed={alertOn}>
          🔔
        </button>
      </div>
      <button className="tspark" onClick={onChart} aria-label="상세 차트 열기">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t.period}일선 과 주가의 최근 1년 흐름`}>
          <rect x={boxX} y="3" width={W - boxX - 2} height={H - 6} rx="8" fill="var(--ph)" fillOpacity="0.1" stroke="var(--ph)" strokeOpacity="0.7" strokeWidth="1.2" />
          <text x={boxX + 7} y="16" fontSize="10" fontWeight="700" fill="var(--ph)">
            최근 2달
          </text>
          <path d={dPrice} fill="none" stroke="var(--ink2)" strokeOpacity="0.75" strokeWidth="1.2" strokeLinejoin="round" />
          <path d={dOld} fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={dNew} fill="none" stroke="var(--ph)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={x(n - 1)} cy={y(t.line[t.line.length - 1])} r="5" fill="var(--ph)" />
          <circle cx={x(n - 1)} cy={y(prices[n - 1])} r="2.5" fill="var(--ink)" />
        </svg>
        <span>
          <i className="ll" /> {t.period}일선 <i className="lp" /> 주가 · 최근 1년 · 누르면 상세 차트
        </span>
      </button>
      <div className="chkh">
        매수 조건 <b className="num">{met}/5</b>
      </div>
      <ul className="chk">
        {rows.map((r) => (
          <li key={r.label} className={r.ok ? "ok" : r.wait ? "wait" : "no"}>
            <i aria-hidden="true">{r.ok ? "✓" : r.wait ? "·" : "✕"}</i>
            <b>{r.label}</b>
            <span className="num">{r.fact}</span>
          </li>
        ))}
      </ul>
      {t.phase === "dip" && (
        <div className="stopline num">
          손절 기준 <b>{fmt(t.stop)}원</b> ({pct(stopPct)}) · 최근 20일 최저가
          {t.volRatio !== null && (
            <>
              <br />
              거래량 평소의 {t.volRatio.toFixed(1)}배 · {t.volRatio < 0.9 ? "거래량 줄며 눌림 (양호)" : t.volRatio > 1.2 ? "거래량 실린 하락 · 주의" : "평소 수준"}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TrendSetting({ period, onSave }: { period: number; onSave: (p: number) => Promise<void> }) {
  const [v, setV] = useState("");
  const n = Number(v);
  const ok = Number.isInteger(n) && n >= 20 && n <= 400 && n !== period;
  return (
    <>
      <div className="sect">
        <h3>추세 기준선</h3>
      </div>
      <div className="panel" style={{ marginTop: 0 }}>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          지금은 <b>{period}일선</b>을 기준으로 하락·다지기·상승 추세·눌림목을 판단합니다. 상세 차트에 그리는 이평선 설정과는 별개입니다.
        </p>
        <div className="quick" style={{ marginTop: 0 }}>
          {[120, 200, 224, 240].map((p) => (
            <button key={p} className={period === p ? "sel" : ""} onClick={() => p !== period && onSave(p)}>
              {p}일
            </button>
          ))}
        </div>
        <div className="row">
          <input
            className="field num"
            inputMode="numeric"
            placeholder="직접 입력 (20~400)"
            aria-label="추세 기준선 기간"
            value={v}
            onChange={(e) => setV(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
          />
          <button
            className="btn"
            style={{ flex: "none" }}
            disabled={!ok}
            onClick={async () => {
              await onSave(n);
              setV("");
            }}
          >
            적용
          </button>
        </div>
      </div>
    </>
  );
}

function PricePanel({ price, onSave }: { price: number; onSave: (kind: string, v: number) => Promise<void> }) {
  const [v, setV] = useState("");
  const n = Number(v.replace(/,/g, ""));
  const ok = n > 0;
  return (
    <div className="panel">
      <h4>이 가격이 되면 알림</h4>
      <input
        className="field num"
        inputMode="numeric"
        placeholder={price ? fmt(price) : "가격"}
        value={v}
        onChange={(e) => {
          const d = e.target.value.replace(/[^\d]/g, "");
          setV(d ? Number(d).toLocaleString("ko-KR") : "");
        }}
      />
      <div className="quick">
        {[-10, -5, -3, 3, 5].map((p) => (
          <button key={p} onClick={() => setV(fmt(tick(price * (1 + p / 100))))}>
            {p > 0 ? "+" : ""}
            {p}%
          </button>
        ))}
      </div>
      <div className="row">
        <button className="btn" disabled={!ok} onClick={() => onSave("price_down", n)}>
          ▼ 이하로 내려오면
        </button>
        <button className="btn" disabled={!ok} onClick={() => onSave("price_up", n)}>
          ▲ 이상 올라가면
        </button>
      </div>
      <p className="hint">한 번 울리면 꺼지고, 칩에서 다시 켤 수 있습니다.</p>
    </div>
  );
}

function StopPanel({
  price,
  buyPrice,
  onSave,
  onClear,
}: {
  price: number;
  buyPrice: number | null;
  onSave: (buy: number, stop: number) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [buy, setBuy] = useState(buyPrice ? fmt(buyPrice) : price ? fmt(price) : "");
  const [cut, setCut] = useState(3);
  const b = Number(buy.replace(/,/g, ""));
  const stop = b > 0 ? tick(b * (1 - cut / 100)) : 0;
  return (
    <div className="panel">
      <h4>매수가 기준 손절 알림</h4>
      <input
        className="field num"
        inputMode="numeric"
        placeholder="매수가"
        value={buy}
        onChange={(e) => {
          const d = e.target.value.replace(/[^\d]/g, "");
          setBuy(d ? Number(d).toLocaleString("ko-KR") : "");
        }}
      />
      <div className="quick">
        {[2, 3, 5, 7, 10].map((p) => (
          <button key={p} className={cut === p ? "sel" : ""} onClick={() => setCut(p)}>
            -{p}%
          </button>
        ))}
      </div>
      <div className="row">
        <button className="btn danger" disabled={!stop} onClick={() => onSave(b, stop)}>
          {stop ? `${fmt(stop)}원 이하면 알림` : "매수가를 입력하세요"}
        </button>
      </div>
      {buyPrice && (
        <div className="row">
          <button className="btn sm" onClick={onClear}>
            매수가·손절 알림 지우기
          </button>
        </div>
      )}
      <p className="hint">매수가를 저장하면 카드에 수익률이 함께 표시됩니다.</p>
    </div>
  );
}
