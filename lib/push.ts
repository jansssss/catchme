import * as wp from "web-push";
import { db } from "./db";

// CJS 모듈이라 번들러에 따라 default 유무가 달라진다
const webpush: typeof wp = (wp as any).default ?? wp;

let configured = false;
function setup() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
  configured = true;
  return true;
}

export type PushMsg = { title: string; body: string; tag?: string; urgent?: boolean };

/** 등록된 모든 기기로 푸시를 보낸다. 만료된 구독은 지운다 */
export async function sendPush(msg: PushMsg) {
  let subs: Record<string, any>[] = [];
  let sql: Awaited<ReturnType<typeof db>>;
  try {
    if (!setup()) return { sent: 0, failed: 0, error: "VAPID 키가 설정되지 않았습니다" };
    sql = await db();
    subs = await sql`SELECT endpoint, p256dh, auth FROM push_subs`;
  } catch (e: any) {
    return { sent: 0, failed: 0, error: String(e?.message ?? e) };
  }
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(msg),
          { TTL: 3600, urgency: "high" }
        );
        sent++;
      } catch (e: any) {
        failed++;
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await sql`DELETE FROM push_subs WHERE endpoint = ${s.endpoint}`.catch(() => {});
        }
      }
    })
  );
  return { sent, failed };
}
