import { authed, unauthorized } from "@/lib/auth";
import { searchStocks } from "@/lib/naver";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await authed())) return unauthorized();
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json({ items: [] });
  try {
    return Response.json({ items: await searchStocks(q) });
  } catch (e: any) {
    return Response.json({ items: [], error: e.message }, { status: 502 });
  }
}
