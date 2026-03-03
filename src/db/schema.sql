CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    plan TEXT NOT NULL CHECK (plan IN ('free', 'starter', 'pro', 'premium')),
    billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
    status TEXT NOT NULL,
    current_period_start TEXT,
    current_period_end TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scan_credits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    month_year TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pregrade_credits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    month_year TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards_master (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    number TEXT,
    set_name TEXT NOT NULL,
    set_code TEXT NOT NULL,
    rarity TEXT,
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, number, set_code)
);

CREATE TABLE IF NOT EXISTS price_snapshots (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards_master(id),
    price_usd REAL NOT NULL,
    source TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_items (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id),
    card_id TEXT NOT NULL REFERENCES cards_master(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    date_acquired TEXT,
    purchase_price REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grade_results (
    id TEXT PRIMARY KEY,
    collection_item_id TEXT NOT NULL REFERENCES collection_items(id),
    estimated_psa_grade REAL,
    estimated_psa_range_low REAL,
    estimated_psa_range_high REAL,
    estimated_bgs_grade REAL,
    estimated_bgs_range_low REAL,
    estimated_bgs_range_high REAL,
    confidence_score REAL,
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grade_measurements (
    id TEXT PRIMARY KEY,
    grade_result_id TEXT NOT NULL REFERENCES grade_results(id),
    centering_lr REAL,
    centering_tb REAL,
    edge_score REAL,
    corner_score REAL,
    whitening_score REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trade_intents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    card_id TEXT NOT NULL REFERENCES cards_master(id),
    intent_type TEXT NOT NULL CHECK (intent_type IN ('available_for_trade', 'looking_for')),
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    alert_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    card_id TEXT REFERENCES cards_master(id),
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    card_id TEXT NOT NULL REFERENCES cards_master(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, card_id)
);

CREATE TABLE IF NOT EXISTS roi_signals (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards_master(id),
    raw_price REAL,
    estimated_grading_cost REAL,
    estimated_graded_value REAL,
    expected_value REAL,
    roi_percentage REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);