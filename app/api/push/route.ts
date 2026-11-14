import { authed, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";

/** 이 기기의 푸시 구독 저장 */
export async function POST(req: Request) {
  if (!(await authed())) return unauthorized();
  const sub = await req.json();
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return Response.json({ error: "잘못된 구독 정보" }, { status: 400 });
  }
  const sql = await db();
  await sql`INSERT INTO push_subs (endpoint, p256dh, auth)
            VALUES (${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth})
            ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`;
  return Response.json({ ok: true });
}

/** 테스트 알림 보내기 */
export async function PUT() {
  if (!(await authed())) return unauthorized();
  const r = await sendPush({
    title: "🔔 캐치미 테스트 알림",
    body: "알림이 정상적으로 도착했습니다.",
    tag: `test-${Date.now()}`,
  });
  return Response.json(r);
}

export async function DELETE(req: Request) {
  if (!(await authed())) return unauthorized();
  const { endpoint } = await req.json();
  const sql = await db();
  await sql`DELETE FROM push_subs WHERE endpoint = ${endpoint}`;
  return Response.json({ ok: true });
}
