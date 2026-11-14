import { authed, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const KINDS = ["price_up", "price_down", "stop", "ma", "bottom"];

export async function POST(req: Request) {
  if (!(await authed())) return unauthorized();
  const { code, kind, value } = await req.json();
  const v = Number(value);
  if (!KINDS.includes(kind) || !(v > 0)) {
    return Response.json({ error: "잘못된 알림" }, { status: 400 });
  }
  if (kind === "ma" && ![160, 200, 224].includes(v)) {
    return Response.json({ error: "지원하지 않는 이평선" }, { status: 400 });
  }
  const sql = await db();
  // 이평선·바닥 알림은 종목당 하나씩만 둔다
  if (kind === "ma") {
    await sql`DELETE FROM alerts WHERE code = ${code} AND kind = 'ma' AND value = ${v}`;
  } else if (kind === "bottom") {
    await sql`DELETE FROM alerts WHERE code = ${code} AND kind = 'bottom'`;
  }
  await sql`INSERT INTO alerts (code, kind, value) VALUES (${code}, ${kind}, ${v})`;
  return Response.json({ ok: true });
}

/** 알림 켜기/끄기. 다시 켜면 상태를 초기화한다 */
export async function PATCH(req: Request) {
  if (!(await authed())) return unauthorized();
  const { id, active } = await req.json();
  const sql = await db();
  await sql`UPDATE alerts SET active = ${!!active}, state = NULL WHERE id = ${Number(id)}`;
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await authed())) return unauthorized();
  const id = Number(new URL(req.url).searchParams.get("id"));
  const sql = await db();
  await sql`DELETE FROM alerts WHERE id = ${id}`;
  return Response.json({ ok: true });
}
