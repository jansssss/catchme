"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Chart from "./Chart";

type Alert = { id: number; kind: string; value: number; active: boolean; firedAt: string | null };
type Phase = "down" | "easing" | "flat" | "up";
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
  line: number[];
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
const PHASES: { key: Phase; label: string; hint: string }[] = [
  { key: "down", label: "하락", hint: "관망" },
  { key: "easing", label: "하락 둔화", hint: "지켜보기" },
  { key: "flat", label: "횡보", hint: "바닥 다지기 · 주목" },
  { key: "up", label: "상승 전환", hint: "매수 검토" },
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
        추세 국면은 {trendPeriod}일선의 기울기(최근 20거래일 변화율)로 판단합니다 · 하락 = -1% 이하, 또는 오르던 선이 눕거나 현재가가 선보다
        3% 넘게 아래로 이탈 · 하락 둔화 = 내려가지만 한 달 전보다 완만 · 횡보 = ±1% 이내에서 안정 · 상승 전환 = +1% 이상이고
        현재가가 선 근처 이상 · 새 국면이 3거래일 이어지면 전환으로 봅니다
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
        <TrendView t={t} alertOn={!!phaseAlert} onBell={togglePhase} />
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
          <Chart code={s.code} name={s.name} quote={s.quote} />
        </div>
      )}
    </section>
  );
}

function TrendView({ t, alertOn, onBell }: { t: Trend; alertOn: boolean; onBell: () => void }) {
  const idx = PHASES.findIndex((p) => p.key === t.phase);
  const W = 150, H = 60, P = 6;
  const n = t.line.length;
  let lo = Math.min(...t.line), hi = Math.max(...t.line);
  // 거의 수평인 선이 과장되어 보이지 않도록 세로 범위를 최소 8%로 잡는다
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, mid * 0.04);
  lo = mid - half;
  hi = mid + half;
  const x = (i: number) => P + (i / Math.max(1, n - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const d = t.line.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  // 하락으로 분류됐지만 선이 아직 내려가지 않는 경우: 고점에서 꺾이는 중
  const hint =
    t.phase === "down" && t.slope > -1
      ? t.slope >= 1
        ? "선 아래로 이탈 · 관망"
        : "꺾이는 중 · 관망"
      : PHASES[idx].hint;
  const dir = t.slope >= 1 ? "오르는 중" : t.slope <= -1 ? "내려가는 중" : "거의 수평";

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
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t.period}일선 최근 흐름`}>
          <path d={d} fill="none" stroke="var(--ph)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={x(n - 1)} cy={y(t.line[n - 1])} r="4" fill="var(--ph)" />
        </svg>
        <div className="ttxt">
          <div className="th">
            <b>{PHASES[idx].label}</b>
            <span>{hint}</span>
          </div>
          <div className="num">
            {t.daysCapped ? `${t.days}거래일 넘게 지속` : `${t.days}거래일째`}
          </div>
          <div className="num">
            {t.period}일선 {dir} (20일간 {pct(t.slope)})
          </div>
          <div className="num">
            현재가는 선 {t.dist >= 0 ? "위" : "아래"} <b className={tone(t.dist)}>{pct(t.dist)}</b>
          </div>
        </div>
        <button className={`bell ${alertOn ? "on" : ""}`} onClick={onBell} aria-label="국면 전환 알림" aria-pressed={alertOn}>
          🔔
        </button>
      </div>
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
          지금은 <b>{period}일선</b>의 기울기로 하락·횡보·상승을 판단합니다. 상세 차트에 그리는 이평선 설정과는 별개입니다.
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
