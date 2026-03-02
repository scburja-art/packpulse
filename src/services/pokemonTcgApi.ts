import { execSync } from "child_process";
import db from "../db";

// CDN set IDs for card images (images.pokemontcg.io/{id}/{number}.png)
const CDN_SET_MAP: Record<string, string> = {
  BS: "base1",
  JU: "base2",
  FO: "base3",
  TR: "base5",
  N1: "neo1",
  SV1: "sv1",
  SV2: "sv2",
  SV3: "sv3",
  MEW: "sv3pt5",
  SV4: "sv4",
};

// API set IDs for card data lookups (api.pokemontcg.io/v2/cards/{id}-{number})
// Classic sets use different IDs than the CDN; modern sets are the same
const API_SET_MAP: Record<string, string> = {
  BS: "base1",
  JU: "base2",
  FO: "base3",
  TR: "base5",
  N1: "neo1",
  SV1: "sv1",
  SV2: "sv2",
  SV3: "sv3",
  MEW: "sv3pt5",
  SV4: "sv4",
};

interface CardRow {
  id: string;
  name: string;
  number: string | null;
  set_code: string;
}

function buildImageUrl(setCode: string, number: string): string | null {
  const cdnSetId = CDN_SET_MAP[setCode];
  if (!cdnSetId) return null;
  const cardNum = number.split("/")[0].replace(/^0+/, "") || number.split("/")[0];
  return `https://images.pokemontcg.io/${cdnSetId}/${cardNum}.png`;
}

export async function fetchAndUpdateAllCards(): Promise<number> {
  const cards = db
    .prepare("SELECT id, name, number, set_code FROM cards_master WHERE image_url IS NULL")
    .all() as CardRow[];

  if (cards.length === 0) {
    console.log("All cards already have images.");
    return 0;
  }

  console.log(`Setting image URLs for ${cards.length} cards...`);
  const updateStmt = db.prepare("UPDATE cards_master SET image_url = ? WHERE id = ?");
  let updated = 0;

  for (const card of cards) {
    if (!card.number) {
      console.log(`Skipping ${card.name}: no card number`);
      continue;
    }

    const imageUrl = buildImageUrl(card.set_code, card.number);
    if (imageUrl) {
      updateStmt.run(imageUrl, card.id);
      updated++;
      console.log(`Updated ${updated}/${cards.length}: ${card.name}`);
    } else {
      console.log(`Unknown set code for: ${card.name} (${card.set_code})`);
    }
  }

  console.log(`Done. Updated ${updated} of ${cards.length} cards.`);
  return updated;
}

// --- Price fetching ---

interface TcgPlayerPriceVariant {
  low?: number;
  mid?: number;
  high?: number;
  market?: number;
  directLow?: number;
}

interface TcgPlayerPrices {
  holofoil?: TcgPlayerPriceVariant;
  normal?: TcgPlayerPriceVariant;
  reverseHolofoil?: TcgPlayerPriceVariant;
  "1stEditionHolofoil"?: TcgPlayerPriceVariant;
  "1stEditionNormal"?: TcgPlayerPriceVariant;
}

export function extractBestPrice(prices: TcgPlayerPrices): number | null {
  const variants: (keyof TcgPlayerPrices)[] = [
    "holofoil",
    "normal",
    "reverseHolofoil",
    "1stEditionHolofoil",
    "1stEditionNormal",
  ];

  for (const variant of variants) {
    const v = prices[variant];
    if (!v) continue;
    if (v.market != null && v.market > 0) return v.market;
    if (v.mid != null && v.mid > 0) return v.mid;
    if (v.low != null && v.low > 0) return v.low;
  }

  return null;
}

function curlJsonWithKey(url: string, retries = 1): any | null {
  const apiKey = process.env.POKEMON_TCG_API_KEY;
  const keyHeader = apiKey ? `-H "X-Api-Key: ${apiKey}"` : "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = execSync(
        `curl -s --max-time 20 ${keyHeader} "${url}"`,
        { timeout: 25000, encoding: "utf-8" }
      );
      if (!result.trim()) {
        if (attempt < retries) continue;
        return null;
      }
      return JSON.parse(result);
    } catch {
      if (attempt < retries) continue;
      return null;
    }
  }
  return null;
}

export function getCardNumber(number: string): string {
  return number.split("/")[0].replace(/^0+/, "") || number.split("/")[0];
}

/**
 * Fetch price for a single card by its API set ID and card number.
 * Uses direct card ID lookup: /v2/cards/{setId}-{number}
 */
export function fetchCardPrice(setCode: string, cardNumber: string): number | null {
  const apiSetId = API_SET_MAP[setCode];
  if (!apiSetId) return null;

  const num = getCardNumber(cardNumber);
  const url = `https://api.pokemontcg.io/v2/cards/${apiSetId}-${num}`;
  const response = curlJsonWithKey(url);

  if (!response?.data?.tcgplayer?.prices) return null;

  return extractBestPrice(response.data.tcgplayer.prices);
}
