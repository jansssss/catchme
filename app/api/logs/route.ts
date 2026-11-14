import { authed, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await authed())) return unauthorized();
  const sql = await db();
  const rows = await sql`SELECT id, code, name, kind, title, body, created_at
                         FROM alert_log ORDER BY id DESC LIMIT 30`;
  return Response.json({ logs: rows });
}

export async function DELETE() {
  if (!(await authed())) return unauthorized();
  const sql = await db();
  await sql`DELETE FROM alert_log`;
  return Response.json({ ok: true });
}
