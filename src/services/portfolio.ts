import db from "../db";

interface PortfolioItem {
  cardName: string;
  quantity: number;
  purchasePrice: number | null;
  currentPrice: number | null;
  itemPL: number;
  imageUrl: string | null;
}

interface PortfolioValue {
  totalValue: number;
  totalCost: number;
  profitLoss: number;
  profitLossPercent: number;
  items: PortfolioItem[];
}

interface PortfolioChartPoint {
  date: string;
  totalValue: number;
}

interface CollectionItemRow {
  card_id: string;
  card_name: string;
  quantity: number;
  purchase_price: number | null;
  image_url: string | null;
}

interface PriceRow {
  price_usd: number;
}

interface SnapshotRow {
  snapshot_date: string;
  card_id: string;
  price_usd: number;
  quantity: number;
}

export function getPortfolioValue(userId: string): PortfolioValue {
  const rows = db.prepare(`
    SELECT ci.card_id, cm.name as card_name, ci.quantity, ci.purchase_price, cm.image_url
    FROM collection_items ci
    JOIN collections c ON c.id = ci.collection_id
    JOIN cards_master cm ON cm.id = ci.card_id
    WHERE c.user_id = ?
  `).all(userId) as CollectionItemRow[];

  const latestPriceStmt = db.prepare(`
    SELECT price_usd FROM price_snapshots
    WHERE card_id = ?
    ORDER BY snapshot_date DESC, created_at DESC
    LIMIT 1
  `);

  let totalValue = 0;
  let totalCost = 0;
  const items: PortfolioItem[] = [];

  for (const row of rows) {
    const priceRow = latestPriceStmt.get(row.card_id) as PriceRow | undefined;
    const currentPrice = priceRow?.price_usd ?? null;
    const qty = row.quantity;
    const purchasePrice = row.purchase_price;

    const currentTotal = currentPrice !== null ? currentPrice * qty : 0;
    const costTotal = purchasePrice !== null ? purchasePrice * qty : 0;

    totalValue += currentTotal;
    totalCost += costTotal;

    items.push({
      cardName: row.card_name,
      quantity: qty,
      purchasePrice,
      currentPrice,
      itemPL: currentTotal - costTotal,
      imageUrl: row.image_url,
    });
  }

  const profitLoss = totalValue - totalCost;
  const profitLossPercent = totalCost > 0 ? (profitLoss / totalCost) * 100 : 0;

  return {
    totalValue: Math.round(totalValue * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    profitLoss: Math.round(profitLoss * 100) / 100,
    profitLossPercent: Math.round(profitLossPercent * 100) / 100,
    items,
  };
}

export function getPortfolioChart(userId: string, range: string): PortfolioChartPoint[] {
  const now = new Date();
  let startDate: string | null = null;

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
      startDate = null;
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  }

  const dateFilter = startDate ? "AND ps.snapshot_date >= ?" : "";
  const params: unknown[] = [userId];
  if (startDate) params.push(startDate);

  const rows = db.prepare(`
    SELECT ps.snapshot_date, ps.card_id, ps.price_usd, ci.quantity
    FROM price_snapshots ps
    JOIN collection_items ci ON ci.card_id = ps.card_id
    JOIN collections c ON c.id = ci.collection_id
    WHERE c.user_id = ? ${dateFilter}
    ORDER BY ps.snapshot_date ASC
  `).all(...params) as SnapshotRow[];

  const dateMap = new Map<string, number>();
  for (const row of rows) {
    const current = dateMap.get(row.snapshot_date) || 0;
    dateMap.set(row.snapshot_date, current + row.price_usd * row.quantity);
  }

  return Array.from(dateMap.entries()).map(([date, totalValue]) => ({
    date,
    totalValue: Math.round(totalValue * 100) / 100,
  }));
}