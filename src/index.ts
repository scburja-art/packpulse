import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import multer from "multer";
import db, { initializeDatabase } from "./db";
import { ingestPrices, getPriceHistory } from "./services/priceIngestion";
import { v4 as uuidv4 } from "uuid";
import { getPortfolioValue, getPortfolioChart } from "./services/portfolio";
import { registerUser, loginUser } from "./services/auth";
import { authenticateToken, AuthenticatedRequest } from "./middleware/auth";
import { getOrCreateCredits, resetMonthlyCredits } from "./services/credits";
import { checkCredit } from "./middleware/checkCredit";
import { scanCard } from "./services/cardScanner";
import { preGradeCard, getGradeHistory } from "./services/gradingEngine";
import { computeAllROI, getTopROICards, getCardROI } from "./services/roiEngine";
import { checkPlan } from "./middleware/checkPlan";
import { createTradeIntent, getTradeIntents, deleteTradeIntent, findMatches } from "./services/matching";
import { getUserAlerts, markAlertRead, detectPriceSpikes, detectPortfolioChanges, detectROIOpportunities } from "./services/alerts";
import { fetchAndUpdateAllCards } from "./services/pokemonTcgApi";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ dest: uploadsDir });

// --- Health check (stays at root) ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// --- API Router ---
const router = express.Router();

router.post("/auth/register", (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password) {
      res.status(400).json({ error: "email, username, and password are required" });
      return;
    }
    const user = registerUser(email, username, password);
    res.status(201).json(user);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint failed")) {
      res.status(409).json({ error: "Email or username already exists" });
      return;
    }
    console.error("Error in POST /auth/register:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/login", (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }
    const result = loginUser(email, password);
    if (!result) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error("Error in POST /auth/login:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cards", (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (req.query.set) {
      conditions.push("set_code = ?");
      params.push(req.query.set);
    }

    if (req.query.rarity) {
      conditions.push("rarity = ?");
      params.push(req.query.rarity);
    }

    if (req.query.search) {
      conditions.push("name LIKE ?");
      params.push(`%${req.query.search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM cards_master ${where}`).get(...params) as { count: number };
    const cards = db.prepare(`SELECT * FROM cards_master ${where} ORDER BY set_code, number LIMIT ? OFFSET ?`).all(...params, limit, offset);

    res.json({
      data: cards,
      pagination: {
        page,
        limit,
        total: countRow.count,
        totalPages: Math.ceil(countRow.count / limit),
      },
    });
  } catch (err) {
    console.error("Error in /cards:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cards/:id/chart", (req, res) => {
  try {
    const range = (req.query.range as string) || "m";
    const prices = getPriceHistory(req.params.id, range).map((p) => ({
      price_usd: p.price_usd,
      snapshot_date: p.snapshot_date,
    }));
    res.json({ cardId: req.params.id, range, prices });
  } catch (err) {
    console.error("Error in /cards/:id/chart:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Protected endpoints ---

router.post("/collections", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const id = uuidv4();
    db.prepare("INSERT INTO collections (id, user_id, name) VALUES (?, ?, ?)").run(id, userId, name);
    const collection = db.prepare("SELECT * FROM collections WHERE id = ?").get(id);
    res.status(201).json(collection);
  } catch (err) {
    console.error("Error in POST /collections:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/collections/:id/items", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const collection = db.prepare("SELECT * FROM collections WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!collection) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    const { cardId, quantity, purchasePrice } = req.body;
    if (!cardId) {
      res.status(400).json({ error: "cardId is required" });
      return;
    }
    const id = uuidv4();
    const today = new Date().toISOString().split("T")[0];
    db.prepare(
      "INSERT INTO collection_items (id, collection_id, card_id, quantity, date_acquired, purchase_price) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, req.params.id, cardId, quantity || 1, today, purchasePrice ?? null);
    const item = db.prepare("SELECT * FROM collection_items WHERE id = ?").get(id);
    res.status(201).json(item);
  } catch (err) {
    console.error("Error in POST /collections/:id/items:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/collections", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const collections = db.prepare(`
      SELECT c.*, COUNT(ci.id) as item_count
      FROM collections c
      LEFT JOIN collection_items ci ON ci.collection_id = c.id
      WHERE c.user_id = ?
      GROUP BY c.id
    `).all(userId);
    res.json(collections);
  } catch (err) {
    console.error("Error in GET /collections:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/collections/:id/items", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const collection = db.prepare("SELECT * FROM collections WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!collection) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    const items = db.prepare(`
      SELECT ci.*, cm.name, cm.number, cm.set_name, cm.set_code, cm.rarity, cm.image_url,
        (SELECT ps.price_usd FROM price_snapshots ps WHERE ps.card_id = ci.card_id ORDER BY ps.snapshot_date DESC LIMIT 1) as current_price,
        (SELECT 1 FROM favorites f WHERE f.card_id = ci.card_id AND f.user_id = ?) as is_favorited
      FROM collection_items ci
      JOIN cards_master cm ON cm.id = ci.card_id
      WHERE ci.collection_id = ?
      ORDER BY cm.name
    `).all(userId, req.params.id);
    res.json(items);
  } catch (err) {
    console.error("Error in GET /collections/:id/items:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/portfolio", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    res.json(getPortfolioValue(userId));
  } catch (err) {
    console.error("Error in GET /portfolio:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/portfolio/chart", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const range = (req.query.range as string) || "m";
    res.json(getPortfolioChart(userId, range));
  } catch (err) {
    console.error("Error in GET /portfolio/chart:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/credits", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const scan = getOrCreateCredits(userId, "scan");
    const pregrade = getOrCreateCredits(userId, "pregrade");
    res.json({ scan, pregrade });
  } catch (err) {
    console.error("Error in GET /credits:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/scan", authenticateToken, checkCredit("scan"), upload.single("image"), (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const imagePath = req.file?.path || "";
    const { cardName, cardNumber, setCode } = req.body;

    const result = scanCard(imagePath, { cardName, cardNumber, setCode });

    if (result.matched && result.card) {
      // Auto-add to default collection
      let collection = db.prepare(
        "SELECT * FROM collections WHERE user_id = ? AND name = 'Default Collection' LIMIT 1"
      ).get(userId) as { id: string } | undefined;

      if (!collection) {
        const collId = uuidv4();
        db.prepare("INSERT INTO collections (id, user_id, name) VALUES (?, ?, 'Default Collection')").run(collId, userId);
        collection = { id: collId };
      }

      const itemId = uuidv4();
      const today = new Date().toISOString().split("T")[0];
      db.prepare(
        "INSERT INTO collection_items (id, collection_id, card_id, quantity, date_acquired) VALUES (?, ?, ?, 1, ?)"
      ).run(itemId, collection.id, result.card.id, today);

      res.json({
        success: true,
        confidence: result.confidence,
        card: result.card,
        addedToCollection: true,
      });
    } else if (result.candidates.length > 0) {
      res.json({
        success: false,
        confidence: result.confidence,
        card: null,
        candidates: result.candidates,
      });
    } else {
      res.json({
        success: false,
        confidence: result.confidence,
        card: null,
        candidates: [],
      });
    }
  } catch (err) {
    console.error("Error in POST /scan:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/scan/confirm", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { cardId, collectionId } = req.body;

    if (!cardId) {
      res.status(400).json({ error: "cardId is required" });
      return;
    }

    const card = db.prepare("SELECT * FROM cards_master WHERE id = ?").get(cardId);
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }

    let targetCollectionId = collectionId;
    if (!targetCollectionId) {
      let collection = db.prepare(
        "SELECT * FROM collections WHERE user_id = ? AND name = 'Default Collection' LIMIT 1"
      ).get(userId) as { id: string } | undefined;

      if (!collection) {
        const collId = uuidv4();
        db.prepare("INSERT INTO collections (id, user_id, name) VALUES (?, ?, 'Default Collection')").run(collId, userId);
        collection = { id: collId };
      }
      targetCollectionId = collection.id;
    }

    const itemId = uuidv4();
    const today = new Date().toISOString().split("T")[0];
    db.prepare(
      "INSERT INTO collection_items (id, collection_id, card_id, quantity, date_acquired) VALUES (?, ?, ?, 1, ?)"
    ).run(itemId, targetCollectionId, cardId, today);

    res.json({ success: true, card, addedToCollection: true });
  } catch (err) {
    console.error("Error in POST /scan/confirm:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pregrade", authenticateToken, checkCredit("pregrade"), upload.single("image"), (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { collectionItemId } = req.body;
    if (!collectionItemId) {
      res.status(400).json({ error: "collectionItemId is required" });
      return;
    }

    const item = db.prepare(`
      SELECT ci.* FROM collection_items ci
      JOIN collections c ON c.id = ci.collection_id
      WHERE ci.id = ? AND c.user_id = ?
    `).get(collectionItemId, userId);
    if (!item) {
      res.status(404).json({ error: "Collection item not found" });
      return;
    }

    const imagePath = req.file?.path || "";
    const result = preGradeCard(collectionItemId, imagePath);
    res.json(result);
  } catch (err) {
    console.error("Error in POST /pregrade:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/grades/:collectionItemId", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const item = db.prepare(`
      SELECT ci.id FROM collection_items ci
      JOIN collections c ON c.id = ci.collection_id
      WHERE ci.id = ? AND c.user_id = ?
    `).get(req.params.collectionItemId, userId);
    if (!item) {
      res.status(404).json({ error: "Collection item not found" });
      return;
    }
    const results = getGradeHistory(req.params.collectionItemId as string);
    res.json(results);
  } catch (err) {
    console.error("Error in GET /grades/:collectionItemId:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/trade-intents", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { cardId, intentType } = req.body;
    if (!cardId || !intentType) {
      res.status(400).json({ error: "cardId and intentType are required" });
      return;
    }
    if (intentType !== "available_for_trade" && intentType !== "looking_for") {
      res.status(400).json({ error: "intentType must be 'available_for_trade' or 'looking_for'" });
      return;
    }
    const card = db.prepare("SELECT id FROM cards_master WHERE id = ?").get(cardId);
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const intent = createTradeIntent(userId, cardId, intentType);
    res.status(201).json(intent);
  } catch (err) {
    console.error("Error in POST /trade-intents:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/trade-intents", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    res.json(getTradeIntents(userId));
  } catch (err) {
    console.error("Error in GET /trade-intents:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/trade-intents/:id", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const deleted = deleteTradeIntent(req.params.id as string, userId);
    if (!deleted) {
      res.status(404).json({ error: "Trade intent not found or not owned by you" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error in DELETE /trade-intents/:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/trade-intents/matches", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    res.json(findMatches(userId));
  } catch (err) {
    console.error("Error in GET /trade-intents/matches:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/roi/top", authenticateToken, checkPlan(["starter", "pro", "premium"]), (req: AuthenticatedRequest, res) => {
  try {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10));
    const results = getTopROICards(limit);
    res.json(results);
  } catch (err) {
    console.error("Error in GET /roi/top:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/roi/:cardId", authenticateToken, checkPlan(["starter", "pro", "premium"]), (req: AuthenticatedRequest, res) => {
  try {
    const result = getCardROI(req.params.cardId as string);
    if (!result) {
      res.status(404).json({ error: "No ROI data found for this card" });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error("Error in GET /roi/:cardId:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/alerts", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const unreadOnly = req.query.unread === "true";
    res.json(getUserAlerts(userId, unreadOnly));
  } catch (err) {
    console.error("Error in GET /alerts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/alerts/:id/read", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const updated = markAlertRead(req.params.id as string, userId);
    if (!updated) {
      res.status(404).json({ error: "Alert not found or not owned by you" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error in PATCH /alerts/:id/read:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/run-alerts", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const priceSpikes = detectPriceSpikes();
    const portfolioChanges = detectPortfolioChanges();
    const roiOpportunities = detectROIOpportunities();
    res.json({ priceSpikes, portfolioChanges, roiOpportunities });
  } catch (err) {
    console.error("Error in POST /admin/run-alerts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/compute-roi", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const result = computeAllROI();
    res.json(result);
  } catch (err) {
    console.error("Error in POST /admin/compute-roi:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/reset-credits", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const result = resetMonthlyCredits();
    res.json(result);
  } catch (err) {
    console.error("Error in POST /admin/reset-credits:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/fetch-images", authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const count = await fetchAndUpdateAllCards();
    res.json({ updated: count });
  } catch (err) {
    console.error("Error in POST /admin/fetch-images:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/ingest-prices", authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await ingestPrices();
    res.json(result);
  } catch (err) {
    console.error("Error in /admin/ingest-prices:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/favorites", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const favorites = db.prepare(`
      SELECT f.id, f.card_id, f.created_at, cm.name, cm.number, cm.set_name, cm.set_code, cm.rarity,
        (SELECT ps.price_usd FROM price_snapshots ps WHERE ps.card_id = f.card_id ORDER BY ps.snapshot_date DESC LIMIT 1) as current_price
      FROM favorites f
      JOIN cards_master cm ON cm.id = f.card_id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
    `).all(userId);
    res.json(favorites);
  } catch (err) {
    console.error("Error in GET /favorites:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/favorites/:cardId", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const cardId = req.params.cardId as string;
    const card = db.prepare("SELECT id FROM cards_master WHERE id = ?").get(cardId);
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const existing = db.prepare("SELECT id FROM favorites WHERE user_id = ? AND card_id = ?").get(userId, cardId);
    if (existing) {
      res.json({ favorited: true });
      return;
    }
    const id = uuidv4();
    db.prepare("INSERT INTO favorites (id, user_id, card_id) VALUES (?, ?, ?)").run(id, userId, cardId);
    res.status(201).json({ favorited: true });
  } catch (err) {
    console.error("Error in POST /favorites/:cardId:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/favorites/:cardId", authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const cardId = req.params.cardId as string;
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND card_id = ?").run(userId, cardId);
    res.json({ favorited: false });
  } catch (err) {
    console.error("Error in DELETE /favorites/:cardId:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.use("/api", router);

// Serve built frontend in production
const clientPath = path.join(__dirname, "../dist/client");
if (fs.existsSync(clientPath)) {
  app.use(express.static(clientPath));
  app.use((_req, res) => {
    res.sendFile(path.join(clientPath, "index.html"));
  });
}

initializeDatabase();

// Auto-seed cards if database is empty
const cardCount = db.prepare("SELECT COUNT(*) as count FROM cards_master").get() as { count: number };
if (cardCount.count === 0) {
  console.log("Empty database detected, seeding cards...");
  const { seedCards } = require("./db/seed-data");
  seedCards();
}

// Background fetch card images if any are missing
const missingImages = db.prepare("SELECT COUNT(*) as count FROM cards_master WHERE image_url IS NULL").get() as { count: number };
if (missingImages.count > 0) {
  console.log(`${missingImages.count} cards missing images, fetching in background...`);
  fetchAndUpdateAllCards().then((count) => {
    console.log(`Background image fetch complete: ${count} cards updated.`);
  }).catch((err) => {
    console.error("Background image fetch failed:", err);
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});