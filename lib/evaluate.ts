import { db } from "./db";
import { getDaily, getQuotes, mergeLive, type Bar } from "./naver";
import { computeMetrics, NEAR_PCT } from "./indicators";
import { sendPush } from "./push";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR") + "원";

/**
 * 켜져 있는 알림을 모두 검사하고, 조건이 맞으면 푸시를 보낸다.
 *  - price_up / price_down / stop : 한 번 울리면 꺼진다
 *  - ma     : 이평선 ±1% 안으로 들어오거나 돌파/이탈할 때 울린다 (계속 유지)
 *  - bottom : 역배열 공백 + 횡보 조건이 새로 충족될 때 울린다 (계속 유지)
 */
export async function runCheck() {
  const sql = await db();
  const alerts = await sql`
    SELECT a.id, a.code, a.kind, a.value, a.state, w.name
    FROM alerts a JOIN watchlist w ON w.code = a.code
    WHERE a.active = TRUE`;
  if (!alerts.length) return { checked: 0, fired: 0 };

  const codes = [...new Set(alerts.map((a) => a.code as string))];
  const quotes = await getQuotes(codes);
  const needBars = new Set<string>(
    alerts.filter((a) => a.kind === "ma" || a.kind === "bottom").map((a) => a.code)
  );
  const bars: Record<string, Bar[]> = {};
  await Promise.all(
    [...needBars].map(async (c) => {
      try {
        bars[c] = mergeLive(await getDaily(c), quotes[c]);
      } catch {
        /* 다음 주기에 다시 시도 */
      }
    })
  );

  let fired = 0;
  for (const a of alerts) {
    const q = quotes[a.code];
    if (!q || !q.price) continue;
    const price = q.price;
    const v = Number(a.value);
    const prev = (a.state as string | null) ?? null;
    let msg: { title: string; body: string; urgent?: boolean } | null = null;
    let next: string | null = prev;
    let deactivate = false;

    if (a.kind === "price_up" && price >= v) {
      msg = { title: `🎯 ${a.name} ${won(price)}`, body: `목표가 ${won(v)} 이상 도달` };
      deactivate = true;
    } else if (a.kind === "price_down" && price <= v) {
      msg = { title: `🎯 ${a.name} ${won(price)}`, body: `목표가 ${won(v)} 이하 도달` };
      deactivate = true;
    } else if (a.kind === "stop" && price <= v) {
      msg = {
        title: `🚨 ${a.name} 손절가 도달`,
        body: `현재 ${won(price)} · 손절가 ${won(v)} 이하`,
        urgent: true,
      };
      deactivate = true;
    } else if (a.kind === "ma" && bars[a.code]) {
      const m = computeMetrics(bars[a.code]);
      const ma = m?.ma[v];
      const d = m?.dist[v];
      if (ma != null && d != null) {
        // 근접 구간을 벗어나려면 1.5% 이상 떨어져야 한다 (같은 알림 반복 방지)
        const near =
          Math.abs(d) <= NEAR_PCT || (prev === "near" && Math.abs(d) <= NEAR_PCT * 1.5);
        next = near ? "near" : d > 0 ? "above" : "below";
        if (next !== prev) {
          if (next === "near") {
            msg = {
              title: `📍 ${a.name} ${v}일선 도달`,
              body: `현재 ${won(price)} · ${v}일선 ${won(ma)} (${d > 0 ? "+" : ""}${d}%)`,
            };
          } else if (prev === "below" && next === "above") {
            msg = { title: `📈 ${a.name} ${v}일선 돌파`, body: `현재 ${won(price)} · ${v}일선 ${won(ma)}` };
          } else if (prev === "above" && next === "below") {
            msg = { title: `📉 ${a.name} ${v}일선 이탈`, body: `현재 ${won(price)} · ${v}일선 ${won(ma)}` };
          }
        }
      }
    } else if (a.kind === "bottom" && bars[a.code]) {
      const m = computeMetrics(bars[a.code], v);
      if (m) {
        next = m.bottom ? "on" : "off";
        if (m.bottom && prev !== "on") {
          msg = {
            title: `🟢 ${a.name} 바닥 신호`,
            body: `역배열 공백 ${m.gap}% · 20일 변동폭 ${m.range20}% (횡보) · 현재 ${won(price)}`,
          };
        }
      }
    }

    if (msg) {
      fired++;
      await sql`INSERT INTO alert_log (code, name, kind, title, body, price)
                VALUES (${a.code}, ${a.name}, ${a.kind}, ${msg.title}, ${msg.body}, ${price})`;
      // 상태를 먼저 저장해 두어, 푸시가 실패해도 같은 알림이 반복되지 않게 한다
      await sql`UPDATE alerts SET state = ${next}, active = ${!deactivate}, fired_at = now()
                WHERE id = ${a.id}`;
      await sendPush({ ...msg, tag: `a${a.id}-${Date.now()}` });
    } else if (next !== prev) {
      await sql`UPDATE alerts SET state = ${next} WHERE id = ${a.id}`;
    }
  }
  return { checked: alerts.length, fired };
}
