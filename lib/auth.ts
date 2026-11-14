import { createHash } from "crypto";
import { cookies } from "next/headers";

export const COOKIE = "cm_auth";

export function token() {
  return createHash("sha256")
    .update(`${process.env.APP_PIN ?? ""}|${process.env.CRON_SECRET ?? ""}|catchme`)
    .digest("hex");
}

/** APP_PIN 이 설정되어 있으면 로그인 쿠키를 검사한다 */
export async function authed() {
  if (!process.env.APP_PIN) return true;
  const c = await cookies();
  return c.get(COOKIE)?.value === token();
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
