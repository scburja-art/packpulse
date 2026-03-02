import { v4 as uuidv4 } from "uuid";
import db from "../db";

interface TradeIntentRow {
  id: string;
  user_id: string;
  card_id: string;
  intent_type: string;
  status: string;
  created_at: string;
}

export function createTradeIntent(userId: string, cardId: string, intentType: "available_for_trade" | "looking_for") {
  const id = uuidv4();
  db.prepare(
    "INSERT INTO trade_intents (id, user_id, card_id, intent_type, status) VALUES (?, ?, ?, ?, 'active')"
  ).run(id, userId, cardId, intentType);
  return db.prepare("SELECT * FROM trade_intents WHERE id = ?").get(id);
}

export function getTradeIntents(userId: string) {
  return db.prepare(`
    SELECT ti.*, cm.name as card_name, cm.set_code, cm.rarity
    FROM trade_intents ti
    JOIN cards_master cm ON cm.id = ti.card_id
    WHERE ti.user_id = ? AND ti.status = 'active'
    ORDER BY ti.created_at DESC
  `).all(userId);
}

export function deleteTradeIntent(intentId: string, userId: string): boolean {
  const result = db.prepare(
    "DELETE FROM trade_intents WHERE id = ? AND user_id = ?"
  ).run(intentId, userId);
  return result.changes > 0;
}

export function findMatches(userId: string) {
  const myIntents = db.prepare(
    "SELECT * FROM trade_intents WHERE user_id = ? AND status = 'active'"
  ).all(userId) as TradeIntentRow[];

  const matches: {
    myIntent: TradeIntentRow;
    matchedUser: { id: string; username: string };
    matchedCard: { id: string; name: string; set_code: string; rarity: string | null };
    matchType: "they_have" | "they_want";
  }[] = [];

  for (const intent of myIntents) {
    const oppositeType = intent.intent_type === "looking_for" ? "available_for_trade" : "looking_for";
    const matchType = intent.intent_type === "looking_for" ? "they_have" as const : "they_want" as const;

    const matched = db.prepare(`
      SELECT ti.*, u.id as matched_user_id, u.username,
             cm.id as card_id, cm.name as card_name, cm.set_code, cm.rarity
      FROM trade_intents ti
      JOIN users u ON u.id = ti.user_id
      JOIN cards_master cm ON cm.id = ti.card_id
      WHERE ti.card_id = ? AND ti.intent_type = ? AND ti.user_id != ? AND ti.status = 'active'
    `).all(intent.card_id, oppositeType, userId) as { matched_user_id: string; username: string; card_id: string; card_name: string; set_code: string; rarity: string | null }[];

    for (const m of matched) {
      matches.push({
        myIntent: intent,
        matchedUser: { id: m.matched_user_id, username: m.username },
        matchedCard: { id: m.card_id, name: m.card_name, set_code: m.set_code, rarity: m.rarity },
        matchType,
      });
    }
  }

  return matches;
}
