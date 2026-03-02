import { v4 as uuidv4 } from "uuid";
import db from "../db";

export const PLAN_LIMITS: Record<string, { scans: number; pregrades: number }> = {
  free: { scans: 5, pregrades: 3 },
  starter: { scans: 50, pregrades: 25 },
  pro: { scans: 200, pregrades: 100 },
  premium: { scans: Infinity, pregrades: Infinity },
};

interface CreditRow {
  id: string;
  user_id: string;
  month_year: string;
  used: number;
  limit: number;
}

interface SubscriptionRow {
  plan: string;
}

function getCurrentMonthYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getUserPlan(userId: string): string {
  const sub = db.prepare(
    "SELECT plan FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(userId) as SubscriptionRow | undefined;
  return sub?.plan || "free";
}

export function getOrCreateCredits(userId: string, type: "scan" | "pregrade"): { used: number; limit: number; remaining: number } {
  const table = type === "scan" ? "scan_credits" : "pregrade_credits";
  const monthYear = getCurrentMonthYear();
  const plan = getUserPlan(userId);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const creditLimit = type === "scan" ? limits.scans : limits.pregrades;
  const dbLimit = creditLimit === Infinity ? 999999 : creditLimit;

  let row = db.prepare(
    `SELECT * FROM ${table} WHERE user_id = ? AND month_year = ?`
  ).get(userId, monthYear) as CreditRow | undefined;

  if (!row) {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO ${table} (id, user_id, month_year, used, "limit") VALUES (?, ?, ?, 0, ?)`
    ).run(id, userId, monthYear, dbLimit);
    row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as CreditRow;
  }

  const remaining = Math.max(0, row.limit - row.used);
  return { used: row.used, limit: row.limit, remaining };
}

export function consumeCredit(userId: string, type: "scan" | "pregrade"): { success: boolean; used: number; limit: number; remaining: number } {
  const table = type === "scan" ? "scan_credits" : "pregrade_credits";
  const credits = getOrCreateCredits(userId, type);

  if (credits.remaining <= 0) {
    return { success: false, ...credits };
  }

  const monthYear = getCurrentMonthYear();
  db.prepare(
    `UPDATE ${table} SET used = used + 1 WHERE user_id = ? AND month_year = ?`
  ).run(userId, monthYear);

  return {
    success: true,
    used: credits.used + 1,
    limit: credits.limit,
    remaining: credits.remaining - 1,
  };
}

export function resetMonthlyCredits(): { scanRows: number; pregradeRows: number } {
  const monthYear = getCurrentMonthYear();
  const scanResult = db.prepare("UPDATE scan_credits SET used = 0 WHERE month_year = ?").run(monthYear);
  const pregradeResult = db.prepare("UPDATE pregrade_credits SET used = 0 WHERE month_year = ?").run(monthYear);
  return { scanRows: scanResult.changes, pregradeRows: pregradeResult.changes };
}