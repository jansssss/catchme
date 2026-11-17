import { db } from "./db";
import { getDaily, getQuotes, mergeLive, type Bar } from "./naver";
import { computeTrend, daysFor, PHASE_LABEL, type Phase } from "./indicators";
import { getTrendPeriod } from "./settings";
import { sendPush } from "./push";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR") + "원";

/**
 * 켜져 있는 알림을 모두 검사하고, 조건이 맞으면 푸시를 보낸다.
 *  - price_up / price_down / stop : 한 번 울리면 꺼진다
 *  - phase  : 추세 국면(하락·하락 둔화·횡보·상승 전환)이 바뀔 때 울린다 (계속 유지)
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
    alerts.filter((a) => a.kind === "phase").map((a) => a.code)
  );
  const period = needBars.size ? await getTrendPeriod() : 0;
  const bars: Record<string, Bar[]> = {};
  await Promise.all(
    [...needBars].map(async (c) => {
      try {
        bars[c] = mergeLive(await getDaily(c, daysFor(period)), quotes[c]);
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
    } else if (a.kind === "phase" && bars[a.code]) {
      const t = computeTrend(bars[a.code], period);
      if (t) {
        // 기준선 기간이 바뀌면 비교 대상이 달라지므로 조용히 다시 시작한다
        const [pp, was] = (prev ?? "").split(":");
        next = `${period}:${t.phase}`;
        if (Number(pp) === period && was && was !== t.phase) {
          const icon = t.phase === "up" ? "📈" : t.phase === "flat" ? "➡️" : t.phase === "easing" ? "↘️" : "📉";
          msg = {
            title: `${icon} ${a.name} ${PHASE_LABEL[t.phase]}`,
            body: `${PHASE_LABEL[was as Phase] ?? was} → ${PHASE_LABEL[t.phase]} · ${period}일선 20일간 ${t.slope > 0 ? "+" : ""}${t.slope}% · 현재 ${won(price)}`,
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
