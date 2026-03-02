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

// Legacy set codes that don't work with the Pokemon TCG API
const LEGACY_SET_CODES = new Set(["BS", "JU", "FO", "TR", "N1"]);

export interface IngestionResult {
  updated: number;
  skipped: number;
  failed: number;
  total: number;
}

export async function ingestPrices(): Promise<IngestionResult> {
  const today = new Date().toISOString().split("T")[0];
  const cards = db
    .prepare("SELECT id, name, number, set_code, rarity FROM cards_master")
    .all() as Card[];

  const insert = db.prepare(
    "INSERT INTO price_snapshots (id, card_id, price_usd, source, snapshot_date) VALUES (?, ?, ?, ?, ?)"
  );

  const hasApiKey = !!process.env.POKEMON_TCG_API_KEY;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  if (!hasApiKey) {
    console.log("ATLAS: No POKEMON_TCG_API_KEY set — using mock prices for all cards.");
  } else {
    console.log(`ATLAS: Fetching real prices for ${cards.length} cards (1s between calls)...`);
  }

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];

    // Skip legacy set codes that don't work with the API
    if (LEGACY_SET_CODES.has(card.set_code)) {
      skipped++;
      if (skipped === 1 || skipped % 5 === 0) {
        console.log(`ATLAS: [skip] ${card.name} — legacy set ${card.set_code} not supported by API`);
      }
      continue;
    }

    let price: number | null = null;
    let source = "mock";

    // Try real API price
    if (hasApiKey && card.number) {
      try {
        price = fetchCardPrice(card.set_code, card.number);
        if (price != null) {
          source = "tcgplayer";
        }
      } catch {
        failed++;
        console.log(`ATLAS: [fail] ${card.name} — API error`);
      }
    }

    // Fall back to mock if API failed or no key
    if (price == null) {
      price = generateMockPrice(card.rarity);
      source = "mock";
    }

    // Insert immediately — survives process death
    try {
      insert.run(uuidv4(), card.id, price, source, today);
      updated++;
      console.log(`ATLAS: [${source}] ${card.name}: $${price.toFixed(2)}`);
    } catch (err: any) {
      failed++;
      console.log(`ATLAS: [fail] ${card.name} — DB insert error: ${err.message}`);
    }

    // Progress logging every 10 cards
    const processed = updated + skipped + failed;
    if (processed % 10 === 0) {
      console.log(`ATLAS: ${processed}/${cards.length} cards processed (${skipped} skipped)`);
    }

    // 1 second delay between API calls to avoid rate limiting
    if (hasApiKey && source === "tcgplayer" && i < cards.length - 1) {
      await delay(1000);
    }
  }

  const processed = updated + skipped + failed;
  console.log(`ATLAS: ${processed}/${cards.length} cards processed (${skipped} skipped)`);
  console.log(`ATLAS: Price ingestion complete — ${updated} updated, ${skipped} skipped, ${failed} failed.`);
  return { updated, skipped, failed, total: cards.length };
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
