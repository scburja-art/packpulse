// scripts/atlas-ingest.js
// Run: node scripts/atlas-ingest.js
// Or via cron: 0 */2 * * * node /path/to/scripts/atlas-ingest.js

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
    raw_output: '',
  };

  try {
    const output = execSync('npm run ingest 2>&1', {
      cwd: PROJECT_ROOT,
      timeout: 300000, // 5-minute timeout
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'production' },
    });

    result.duration_ms = Date.now() - startMs;
    result.raw_output = output;

    // Parse output for counts
    const insertedMatch = output.match(/Inserted:\s*(\d+)/i);
    const updatedMatch = output.match(/(\d+)\s*(?:prices?\s*(?:inserted|updated|ingested)|cards?\s*updated)/i);
    const failedMatch = output.match(/(\d+)\s*(?:failed|errors?)/i);

    result.cards_updated = insertedMatch
      ? parseInt(insertedMatch[1], 10)
      : (updatedMatch ? parseInt(updatedMatch[1], 10) : 0);
    result.cards_failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    result.status = result.cards_updated > 0 ? 'success' : 'partial';

    console.log(`[ATLAS] Ingestion complete:`, JSON.stringify({
      status: result.status,
      cards_updated: result.cards_updated,
      cards_failed: result.cards_failed,
      duration_ms: result.duration_ms,
    }));
  } catch (err) {
    result.duration_ms = Date.now() - startMs;
    result.raw_output = err.stdout || err.stderr || err.message;
    result.errors.push(err.message.substring(0, 500));
    result.status = 'failed';

    console.error(`[ATLAS] Ingestion FAILED after ${result.duration_ms}ms`);
    console.error(result.raw_output.substring(0, 1000));
  }

  return result;
}

async function checkDataFreshness() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(PROJECT_ROOT, 'data', 'autograde.db');
    const db = new Database(dbPath, { readonly: true });

    const row = db.prepare(`
      SELECT MAX(snapshot_date) as latest
      FROM price_snapshots
    `).get();

    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM price_snapshots
    `).get();

    db.close();

    if (!row || !row.latest) {
      console.warn('[ATLAS] No price snapshots found in database');
      return { fresh: false, latest: null, age_hours: Infinity, total_snapshots: 0 };
    }

    const latestDate = new Date(row.latest);
    const ageMs = Date.now() - latestDate.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    const freshness = {
      fresh: ageHours < 2,
      latest: row.latest,
      age_hours: parseFloat(ageHours.toFixed(2)),
      total_snapshots: countRow.total,
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

// Main execution
(async () => {
  // Step 1: Run ingestion
  const result = await runIngestion();

  // Step 2: Check freshness
  const freshness = await checkDataFreshness();

  // Step 3: Send Discord summary
  const freshnessStatus = freshness.fresh
    ? `✅ Fresh (${freshness.age_hours}h old)`
    : `⚠️ Stale (${freshness.age_hours}h old)`;

  const embed = {
    title: result.status === 'success'
      ? '✅ ATLAS Price Ingestion Complete'
      : result.status === 'partial'
        ? '⚠️ ATLAS Price Ingestion Partial'
        : '🔴 ATLAS Price Ingestion Failed',
    color: result.status === 'success' ? 0x00ff00 : result.status === 'partial' ? 0xffa500 : 0xff0000,
    timestamp: result.timestamp,
    fields: [
      { name: 'Cards Updated', value: `${result.cards_updated}`, inline: true },
      { name: 'Failures', value: `${result.cards_failed}`, inline: true },
      { name: 'Duration', value: `${(result.duration_ms / 1000).toFixed(1)}s`, inline: true },
      { name: 'Data Freshness', value: freshnessStatus, inline: true },
      { name: 'Latest Snapshot', value: freshness.latest || 'None', inline: true },
      { name: 'Total Snapshots', value: `${freshness.total_snapshots || 0}`, inline: true },
    ],
    footer: { text: 'ATLAS — PackPulse Price Ingestion' },
  };

  if (result.errors.length > 0) {
    embed.fields.push({
      name: 'Errors',
      value: result.errors.join('\n').substring(0, 1024),
      inline: false,
    });
  }

  if (result.status === 'failed') {
    await sendDiscordMessage(P0_WEBHOOK, embed);
    console.log('[ATLAS] Failure alert sent to #p0-alerts');
  } else {
    await sendDiscordMessage(BRIEFING_WEBHOOK, embed);
    console.log('[ATLAS] Summary sent to #ceo-briefings');
  }

  console.log('[ATLAS] Run complete:', JSON.stringify({
    ingestion: result.status,
    cards_updated: result.cards_updated,
    data_fresh: freshness.fresh,
    duration_s: (result.duration_ms / 1000).toFixed(1),
  }));
})();
