import { db } from "./db";
import { DEFAULT_TREND_PERIOD } from "./indicators";

export const TREND_MIN = 20;
export const TREND_MAX = 400;

/** 추세 판단 기준선 기간 (설정이 없으면 224) */
export async function getTrendPeriod(): Promise<number> {
  const sql = await db();
  const rows = await sql`SELECT value FROM settings WHERE key = 'trend_period'`;
  const v = Number(rows[0]?.value);
  return Number.isInteger(v) && v >= TREND_MIN && v <= TREND_MAX ? v : DEFAULT_TREND_PERIOD;
}
