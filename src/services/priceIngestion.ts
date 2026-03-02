import { v4 as uuidv4 } from "uuid";
import db from "../db";
import { fetchCardPrice } from "./pokemonTcgApi";

interface Card {
  id: string;
  name: string;
  number: string | null;
  set_code: string;
  rarity: string | null;
}

interface PriceSnapshot {
  id: string;
  card_id: string;
  price_usd: number;
  source: string;
  snapshot_date: string;
  created_at: string;
}

const PRICE_RANGES: Record<string, [number, number]> = {
  common: [0.1, 2.0],
  uncommon: [0.25, 5.0],
  rare: [1.0, 20.0],
  "holo rare": [5.0, 100.0],
  "ultra rare": [20.0, 300.0],
  "secret rare": [50.0, 500.0],
};

function generateMockPrice(rarity: string | null): number {
  const range = PRICE_RANGES[rarity || "common"] || PRICE_RANGES.common;
  const [min, max] = range;
  const base = min + Math.random() * (max - min);
  const variance = base * (0.95 + Math.random() * 0.1); // +/- 5%
  return Math.round(variance * 100) / 100;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ingestPrices(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const cards = db
    .prepare("SELECT id, name, number, set_code, rarity FROM cards_master")
    .all() as Card[];

  const insert = db.prepare(
    "INSERT INTO price_snapshots (id, card_id, price_usd, source, snapshot_date) VALUES (?, ?, ?, ?, ?)"
  );

  const hasApiKey = !!process.env.POKEMON_TCG_API_KEY;

  if (!hasApiKey) {
    console.log("No POKEMON_TCG_API_KEY set — using mock prices for all cards.");
  } else {
    console.log(`Fetching real prices for ${cards.length} cards (3s between calls)...`);
  }

  let realCount = 0;
  let mockCount = 0;
  const results: { cardId: string; price: number; source: string }[] = [];

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    let price: number | null = null;
    let source = "mock";

    // Try real API price
    if (hasApiKey && card.number) {
      price = fetchCardPrice(card.set_code, card.number);
      if (price != null) {
        source = "tcgplayer";
        realCount++;
        console.log(`[real] ${card.name}: $${price.toFixed(2)}`);
      }
    }

    // Fall back to mock
    if (price == null) {
      price = generateMockPrice(card.rarity);
      source = "mock";
      mockCount++;
      console.log(`[mock] ${card.name}: $${price.toFixed(2)}`);
    }

    results.push({ cardId: card.id, price, source });

    // 3 second delay between API calls to avoid rate limiting
    if (hasApiKey && i < cards.length - 1) {
      await delay(3000);
    }
  }

  // Insert all prices in a transaction
  const insertAll = db.transaction(() => {
    for (const r of results) {
      insert.run(uuidv4(), r.cardId, r.price, r.source, today);
    }
  });
  insertAll();

  console.log(`Price ingestion complete: ${realCount} real, ${mockCount} mock.`);
  return results.length;
}

export function getLatestPrice(cardId: string): PriceSnapshot | undefined {
  return db
    .prepare(
      "SELECT * FROM price_snapshots WHERE card_id = ? ORDER BY snapshot_date DESC, created_at DESC LIMIT 1"
    )
    .get(cardId) as PriceSnapshot | undefined;
}

export function getPriceHistory(cardId: string, range: string): PriceSnapshot[] {
  const now = new Date();
  let startDate: string;

  switch (range) {
    case "d":
      startDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      break;
    case "w":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      break;
    case "m":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      break;
    case "3m":
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      break;
    case "6m":
      startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      break;
    case "y":
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      break;
    case "all":
      return db
        .prepare(
          "SELECT * FROM price_snapshots WHERE card_id = ? ORDER BY snapshot_date ASC, created_at ASC"
        )
        .all(cardId) as PriceSnapshot[];
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  }

  return db
    .prepare(
      "SELECT * FROM price_snapshots WHERE card_id = ? AND snapshot_date >= ? ORDER BY snapshot_date ASC, created_at ASC"
    )
    .all(cardId, startDate) as PriceSnapshot[];
}
