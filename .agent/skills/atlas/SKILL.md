# ATLAS — Senior Research Analyst Skill

**Agent:** ATLAS
**Division:** Research
**Approval Tier:** Tier 0 (scheduled price ingestion is fully autonomous)

---

## Capabilities

### 1. Price Ingestion (2-Hour Cron)

Run `npm run ingest` on a 2-hour schedule to pull latest prices from Pokemon TCG API.

- **Schedule:** Every 2 hours (`0 */2 * * *`)
- **Source:** Pokemon TCG API via `src/services/pokemonTcgApi.ts`
- **Worker:** `src/services/priceIngestion.ts`
- **Output:** New rows in `price_snapshots` table

### 2. Data Source Health Check

After each ingestion run, verify the Pokemon TCG API responded correctly:

| Check | Pass Criteria |
|-------|---------------|
| API Response Status | HTTP 200 from Pokemon TCG API |
| Cards Returned | At least 1 card with price data |
| Response Time | API responded within 30 seconds |
| Data Integrity | Prices are numeric and > 0 |

On failure, flag to SENTINEL immediately with error details.

### 3. Ingestion Logging

Every run records:

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 start time |
| `duration_ms` | Total run duration |
| `cards_updated` | Number of cards with new price snapshots |
| `cards_failed` | Number of cards that failed to fetch |
| `cards_skipped` | Cards with no price data available |
| `api_calls` | Total API requests made |
| `status` | `success`, `partial`, or `failed` |
| `errors` | Array of error messages (if any) |

Logs are written to stdout in JSON format for Railway log aggregation.

### 4. Stale Data Detection

Flag any card whose latest `price_snapshot` is older than 2 hours:

```sql
SELECT cm.name, cm.set_name, MAX(ps.recorded_at) as last_price
FROM cards_master cm
LEFT JOIN price_snapshots ps ON cm.id = ps.card_id
GROUP BY cm.id
HAVING last_price < datetime('now', '-2 hours')
   OR last_price IS NULL;
```

Stale cards are reported to SENTINEL for inclusion in the next CEO briefing.

### 5. New Set Detection

After each ingestion run, check the Pokemon TCG API for sets not yet in `cards_master`:

```bash
# Query API for all available sets
curl -H "X-Api-Key: $POKEMON_TCG_API_KEY" https://api.pokemontcg.io/v2/sets
```

New sets are flagged to JARVIS for Tier 2 approval before adding to the database.

---

## Environment Variables

```env
POKEMON_TCG_API_KEY=your-api-key-here
DISCORD_WEBHOOK_CEO_BRIEFINGS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_P0_ALERTS=https://discord.com/api/webhooks/...
INGESTION_INTERVAL_HOURS=2
INGESTION_RATE_LIMIT_MS=1000
```

---

## Implementation

### Cron Wrapper Script

```js
// scripts/atlas-ingest.js
// Run: node scripts/atlas-ingest.js
// Or via cron: 0 */2 * * * node /path/to/scripts/atlas-ingest.js
// Or via node-cron in a long-running process (see bottom)

const { execSync } = require('child_process');
const path = require('path');

const BRIEFING_WEBHOOK = process.env.DISCORD_WEBHOOK_CEO_BRIEFINGS;
const P0_WEBHOOK = process.env.DISCORD_WEBHOOK_P0_ALERTS;
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function sendDiscordMessage(webhookUrl, embed) {
  if (!webhookUrl) {
    console.error('[ATLAS] Discord webhook URL not configured');
    return;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'ATLAS',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/3135/3135755.png',
        embeds: [embed],
      }),
    });
    if (!res.ok) {
      console.error(`[ATLAS] Discord webhook failed: ${res.status}`);
    }
  } catch (err) {
    console.error('[ATLAS] Discord webhook error:', err.message);
  }
}

async function runIngestion() {
  const timestamp = new Date().toISOString();
  const startMs = Date.now();

  console.log(`[ATLAS] [${timestamp}] Starting price ingestion...`);

  const result = {
    timestamp,
    duration_ms: 0,
    cards_updated: 0,
    cards_failed: 0,
    status: 'failed',
    errors: [],
  };

  try {
    const output = execSync('npm run ingest 2>&1', {
      cwd: PROJECT_ROOT,
      timeout: 300000, // 5-minute timeout
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'production' },
    });

    result.duration_ms = Date.now() - startMs;

    // Parse output for counts
    const updatedMatch = output.match(/(\d+)\s*(?:prices?\s*(?:inserted|updated|ingested)|cards?\s*updated)/i);
    const failedMatch = output.match(/(\d+)\s*(?:failed|errors?)/i);

    result.cards_updated = updatedMatch ? parseInt(updatedMatch[1], 10) : 0;
    result.cards_failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    result.status = result.cards_updated > 0 ? 'success' : 'partial';

    console.log(`[ATLAS] Ingestion complete:`, JSON.stringify(result));

    // Report success to briefing channel
    await sendDiscordMessage(BRIEFING_WEBHOOK, {
      title: result.status === 'success' ? '✅ Price Ingestion Complete' : '⚠️ Price Ingestion Partial',
      color: result.status === 'success' ? 0x00ff00 : 0xffa500,
      timestamp,
      fields: [
        { name: 'Cards Updated', value: `${result.cards_updated}`, inline: true },
        { name: 'Failures', value: `${result.cards_failed}`, inline: true },
        { name: 'Duration', value: `${(result.duration_ms / 1000).toFixed(1)}s`, inline: true },
      ],
    });
  } catch (err) {
    result.duration_ms = Date.now() - startMs;
    result.errors.push(err.message);
    result.status = 'failed';

    console.error(`[ATLAS] Ingestion FAILED:`, JSON.stringify(result));

    // Alert SENTINEL via P0 channel on total failure
    await sendDiscordMessage(P0_WEBHOOK, {
      title: '🔴 Price Ingestion Failed',
      description: 'ATLAS price ingestion encountered a critical error. SENTINEL should investigate.',
      color: 0xff0000,
      timestamp,
      fields: [
        { name: 'Duration', value: `${(result.duration_ms / 1000).toFixed(1)}s`, inline: true },
        { name: 'Error', value: err.message.substring(0, 1024), inline: false },
        { name: 'Action', value: 'Flagged to SENTINEL for investigation', inline: false },
      ],
    });
  }

  return result;
}

async function checkDataFreshness() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(PROJECT_ROOT, 'data', 'autograde.db');
    const db = new Database(dbPath, { readonly: true });

    const row = db.prepare(`
      SELECT MAX(recorded_at) as latest
      FROM price_snapshots
    `).get();

    db.close();

    if (!row || !row.latest) {
      console.warn('[ATLAS] No price snapshots found in database');
      return { fresh: false, latest: null, age_hours: Infinity };
    }

    const latestDate = new Date(row.latest);
    const ageMs = Date.now() - latestDate.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    const freshness = {
      fresh: ageHours < 2,
      latest: row.latest,
      age_hours: parseFloat(ageHours.toFixed(2)),
    };

    if (!freshness.fresh) {
      console.warn(`[ATLAS] Stale data detected: latest snapshot is ${freshness.age_hours}h old`);
    } else {
      console.log(`[ATLAS] Data is fresh: latest snapshot is ${freshness.age_hours}h old`);
    }

    return freshness;
  } catch (err) {
    console.error('[ATLAS] Freshness check failed:', err.message);
    return { fresh: false, error: err.message };
  }
}

async function checkNewSets() {
  const apiKey = process.env.POKEMON_TCG_API_KEY;
  if (!apiKey) {
    console.warn('[ATLAS] POKEMON_TCG_API_KEY not set — skipping new set detection');
    return [];
  }

  try {
    const res = await fetch('https://api.pokemontcg.io/v2/sets', {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error(`[ATLAS] Sets API returned ${res.status}`);
      return [];
    }

    const { data: apiSets } = await res.json();

    // Compare against local database
    const Database = require('better-sqlite3');
    const dbPath = path.join(PROJECT_ROOT, 'data', 'autograde.db');
    const db = new Database(dbPath, { readonly: true });

    const localSets = db.prepare(`SELECT DISTINCT set_name FROM cards_master`).all();
    db.close();

    const localSetNames = new Set(localSets.map(s => s.set_name.toLowerCase()));
    const newSets = apiSets.filter(s => !localSetNames.has(s.name.toLowerCase()));

    if (newSets.length > 0) {
      console.log(`[ATLAS] Found ${newSets.length} new sets:`, newSets.map(s => s.name));
    }

    return newSets;
  } catch (err) {
    console.error('[ATLAS] New set detection failed:', err.message);
    return [];
  }
}

// Main execution
(async () => {
  const mode = process.argv[2] || 'ingest';

  if (mode === 'ingest') {
    const result = await runIngestion();

    // Post-ingestion checks
    const freshness = await checkDataFreshness();
    const newSets = await checkNewSets();

    console.log('[ATLAS] Post-ingestion summary:', JSON.stringify({
      ingestion: result.status,
      data_fresh: freshness.fresh,
      new_sets_found: newSets.length,
    }));
  } else if (mode === 'freshness') {
    await checkDataFreshness();
  } else if (mode === 'sets') {
    const newSets = await checkNewSets();
    if (newSets.length > 0) {
      console.log('New sets requiring Tier 2 approval:');
      newSets.forEach(s => console.log(`  - ${s.name} (${s.id}) — ${s.total} cards`));
    } else {
      console.log('No new sets detected.');
    }
  }
})();

// --- Optional: node-cron long-running mode ---
// Uncomment below to run as a persistent process with node-cron
// Requires: npm install node-cron
//
// const cron = require('node-cron');
// console.log('[ATLAS] Starting cron scheduler — ingestion every 2 hours');
// cron.schedule('0 */2 * * *', async () => {
//   console.log('[ATLAS] Cron triggered — starting ingestion');
//   await runIngestion();
//   await checkDataFreshness();
//   await checkNewSets();
// });
```

### Usage

```bash
# Run price ingestion (default)
node scripts/atlas-ingest.js

# Check data freshness only
node scripts/atlas-ingest.js freshness

# Check for new sets only
node scripts/atlas-ingest.js sets

# Crontab entry for 2-hour ingestion
# 0 */2 * * * cd /app && node scripts/atlas-ingest.js >> /var/log/atlas.log 2>&1
```

---

## Existing Code References

- **Price ingestion worker:** `src/services/priceIngestion.ts`
- **Pokemon TCG API client:** `src/services/pokemonTcgApi.ts`
- **Ingest npm script:** `npm run ingest` (defined in `package.json`)
- **Database:** `data/autograde.db` (SQLite, WAL mode)
- **Schema:** `src/db/schema.sql`

## Integration Points

- **ATLAS → SENTINEL:** Flag API failures and stale data after each run
- **ATLAS → JARVIS:** Report ingestion results for CEO briefing; flag new sets for Tier 2 approval
- **ATLAS → TRENDY:** Fresh price data triggers anomaly detection
