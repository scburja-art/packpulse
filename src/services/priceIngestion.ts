import { v4 as uuidv4 } from "uuid";
import db from "../db";
import { fetchCardPrice, fetchSetsBySeries, fetchCardsBySet, extractBestPrice } from "./pokemonTcgApi";

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
  verified: number;
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
  const range = PRICE_RANGES[rarity ? rarity.toLowerCase() : "common"] || PRICE_RANGES.common;
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
  realPrices: number;
  mockPrices: number;
}

export async function ingestPrices(): Promise<IngestionResult> {
  const today = new Date().toISOString().split("T")[0];
  const hasApiKey = !!process.env.POKEMON_TCG_API_KEY;
  const allowMockPrices = process.env.ALLOW_MOCK_PRICES !== "false";
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let realPrices = 0;
  let mockPrices = 0;

  const insertSnapshot = db.prepare(
    "INSERT INTO price_snapshots (id, card_id, price_usd, source, snapshot_date, verified) VALUES (?, ?, ?, ?, ?, ?)"
  );

  const upsertCard = db.prepare(`
    INSERT INTO cards_master (id, name, number, set_name, set_code, rarity, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name, number, set_code) DO UPDATE SET
      rarity = excluded.rarity,
      image_url = excluded.image_url
  `);

  if (hasApiKey) {
    console.log("ATLAS: Fetching Scarlet & Violet sets...");
    const svSets = fetchSetsBySeries("Scarlet & Violet");

    if (svSets.length > 0) {
      console.log(`ATLAS: Found ${svSets.length} Scarlet & Violet sets to ingest.`);
      for (const set of svSets) {
        console.log(`ATLAS: Fetching cards for set ${set.name} (${set.id})...`);
        const cards = fetchCardsBySet(set.id);
        console.log(`ATLAS: Ingesting ${cards.length} cards from ${set.name}`);

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          if (!card.number) {
            skipped++;
            continue;
          }

          const cardId = card.id;
          try {
            upsertCard.run(
              cardId,
              card.name,
              card.number,
              set.name,
              set.id,
              card.rarity || null,
              card.images?.small || null
            );
          } catch (e) {
            console.error(`ATLAS: [fail] upsert card ${card.name}`, (e as Error).message);
          }

          let price: number | null = null;
          if (card.tcgplayer?.prices) {
            price = extractBestPrice(card.tcgplayer.prices);
          }

          if (price == null) {
            skipped++;
            continue;
          }

          // Anomaly Filter
          let verified = 1;
          const prev = getLatestPrice(cardId);
          if (prev) {
            const oldPrice = prev.price_usd;
            if (oldPrice > 0) {
              const pctChange = Math.abs((price - oldPrice) / oldPrice * 100);
              if (pctChange > 80) {
                verified = 0;
                console.log(`ATLAS: ⚠️ Anomaly detected for ${card.name}: $${oldPrice} -> $${price} (${pctChange.toFixed(1)}%)`);

                const P0_WEBHOOK = process.env.DISCORD_WEBHOOK_P0_ALERTS;
                if (P0_WEBHOOK) {
                  try {
                    await fetch(P0_WEBHOOK, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        username: "SENTINEL",
                        avatar_url: "https://cdn-icons-png.flaticon.com/512/3135/3135755.png",
                        embeds: [{
                          title: "🔴 P0 Alert: Unverified Price Anomaly",
                          description: `Card: **${card.name}** (${set.name})\nOld Price: $${oldPrice.toFixed(2)}\nNew Price: $${price.toFixed(2)}\nChange: ${pctChange.toFixed(1)}%`,
                          color: 0xff0000,
                          timestamp: new Date().toISOString()
                        }]
                      })
                    });
                  } catch (e) { }
                }
              }
            }
          } else {
            console.log(`ATLAS: [initial_snapshot] First price for ${card.name}`);
          }

          try {
            insertSnapshot.run(uuidv4(), cardId, price, "tcgplayer", today, verified);
            updated++;
            realPrices++;
          } catch (e) {
            failed++;
          }
        }

        await delay(1000);
      }
    }
  }

  console.log("ATLAS: Doing secondary pass for existing legacy cards...");
  const localCards = db.prepare("SELECT id, name, number, set_code, rarity FROM cards_master").all() as Card[];
  for (const card of localCards) {
    const countToday = db.prepare("SELECT COUNT(*) as count FROM price_snapshots WHERE card_id = ? AND snapshot_date = ?").get(card.id, today) as any;
    if (countToday.count > 0) continue;

    let price: number | null = null;
    let source = "mock";

    if (hasApiKey && !LEGACY_SET_CODES.has(card.set_code) && card.number) {
      try {
        price = fetchCardPrice(card.set_code, card.number);
        if (price != null) source = "tcgplayer";
      } catch { }
    }

    if (price == null) {
      if (!allowMockPrices) {
        console.log(`ATLAS: [SKIPPED] ${card.name} — no real price available, mock disabled`);
        skipped++;
        continue;
      }
      price = generateMockPrice(card.rarity);
      source = "mock";
    }

    let verified = 1;
    const prev = getLatestPrice(card.id);
    if (prev && prev.price_usd > 0) {
      const pctChange = Math.abs((price - prev.price_usd) / prev.price_usd * 100);
      if (pctChange > 80) verified = 0;
    }

    try {
      insertSnapshot.run(uuidv4(), card.id, price, source, today, verified);
      updated++;
      if (source === "tcgplayer") {
        realPrices++;
      } else {
        mockPrices++;
      }
    } catch {
      failed++;
    }

    if (hasApiKey && source === "tcgplayer") {
      await delay(1000);
    }
  }

  const processed = updated + skipped + failed;
  const mockPct = updated > 0 ? (mockPrices / updated) * 100 : 0;
  if (mockPct > 50) {
    console.warn(`ATLAS: [INGESTION WARNING] ${realPrices} real prices, ${mockPrices} mock prices — API may be down`);
  } else {
    console.log(`ATLAS: [INGESTION COMPLETE] ${realPrices} real prices, ${mockPrices} mock prices`);
  }
  console.log(`ATLAS: Price ingestion complete — ${updated} updated, ${skipped} skipped, ${failed} failed.`);
  return { updated, skipped, failed, total: processed, realPrices, mockPrices };
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
