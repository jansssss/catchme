import { runCheck } from "@/lib/evaluate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 외부 스케줄러(GitHub Actions 등)가 주기적으로 호출한다 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const given =
    url.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || given !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, ...(await runCheck()) });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
