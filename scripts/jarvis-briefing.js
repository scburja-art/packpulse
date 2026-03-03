// scripts/jarvis-briefing.js
// JARVIS — CEO Daily Briefing with live database + health data
// Run: node scripts/jarvis-briefing.js [daily|weekly|escalate]
// Daily cron: 0 15 * * * cd /app && node scripts/jarvis-briefing.js daily  (15:00 UTC = 8:00 AM MT)

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const path = require('path');

const BRIEFING_WEBHOOK = process.env.DISCORD_WEBHOOK_CEO_BRIEFINGS;
const WEEKLY_WEBHOOK = process.env.DISCORD_WEBHOOK_WEEKLY_REPORT;
const ESCALATION_WEBHOOK = process.env.DISCORD_WEBHOOK_ESCALATIONS;
const PROJECT_ROOT = path.resolve(__dirname, '..');

function getDb() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(PROJECT_ROOT, 'data', 'autograde.db');
  return new Database(dbPath, { readonly: true });
}

async function sendDiscordEmbed(webhookUrl, embeds) {
  if (!webhookUrl) {
    console.error('[JARVIS] Discord webhook URL not configured');
    return false;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'JARVIS',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/4712/4712027.png',
        embeds: Array.isArray(embeds) ? embeds : [embeds],
      }),
    });
    if (!res.ok) {
      console.error(`[JARVIS] Discord webhook failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[JARVIS] Discord webhook error:', err.message);
    return false;
  }
}

function gatherMetrics() {
  const db = getDb();
  const metrics = {};

  try {
    // Total registered users
    metrics.totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    // Subscription breakdown
    try {
      const subs = db.prepare(
        "SELECT plan, COUNT(*) as count FROM subscriptions WHERE status = 'active' GROUP BY plan"
      ).all();
      metrics.subscriptions = subs;
    } catch {
      metrics.subscriptions = [];
    }

    // Price ingestion status — uses snapshot_date (not recorded_at)
    const today = new Date().toISOString().split('T')[0];
    const latestRow = db.prepare('SELECT MAX(snapshot_date) as latest FROM price_snapshots').get();
    const freshCount = db.prepare(
      'SELECT COUNT(DISTINCT card_id) as count FROM price_snapshots WHERE snapshot_date = ?'
    ).get(today);
    const totalSnapshots = db.prepare('SELECT COUNT(*) as count FROM price_snapshots').get();

    metrics.priceData = {
      latestDate: latestRow.latest || 'Never',
      cardsFreshToday: freshCount.count || 0,
      totalSnapshots: totalSnapshots.count || 0,
      isFresh: latestRow.latest === today,
    };

    // Top 3 price movers — compare latest two distinct snapshot_dates
    try {
      const dates = db.prepare(
        'SELECT DISTINCT snapshot_date FROM price_snapshots ORDER BY snapshot_date DESC LIMIT 2'
      ).all();

      if (dates.length >= 2) {
        const movers = db.prepare(`
          SELECT cm.name, cm.set_name,
            curr.price_usd as current_price,
            prev.price_usd as previous_price,
            (curr.price_usd - prev.price_usd) as change,
            ROUND(((curr.price_usd - prev.price_usd) / prev.price_usd) * 100, 1) as change_pct
          FROM price_snapshots curr
          JOIN price_snapshots prev ON curr.card_id = prev.card_id
          JOIN cards_master cm ON cm.id = curr.card_id
          WHERE curr.snapshot_date = ?
            AND prev.snapshot_date = ?
            AND prev.price_usd > 0
            AND curr.verified = 1
          ORDER BY ABS(curr.price_usd - prev.price_usd) DESC
          LIMIT 3
        `).all(dates[0].snapshot_date, dates[1].snapshot_date);
        metrics.topMovers = movers;

        const unverifiedMovers = db.prepare(`
          SELECT cm.name, cm.set_name,
            curr.price_usd as current_price,
            prev.price_usd as previous_price,
            (curr.price_usd - prev.price_usd) as change,
            ROUND(((curr.price_usd - prev.price_usd) / prev.price_usd) * 100, 1) as change_pct
          FROM price_snapshots curr
          JOIN price_snapshots prev ON curr.card_id = prev.card_id
          JOIN cards_master cm ON cm.id = curr.card_id
          WHERE curr.snapshot_date = ?
            AND prev.snapshot_date = ?
            AND prev.price_usd > 0
            AND curr.verified = 0
          ORDER BY ABS(curr.price_usd - prev.price_usd) DESC
          LIMIT 10
        `).all(dates[0].snapshot_date, dates[1].snapshot_date);
        metrics.unverifiedMovers = unverifiedMovers;
      } else {
        metrics.topMovers = [];
        metrics.unverifiedMovers = [];
      }
    } catch {
      metrics.topMovers = [];
      metrics.unverifiedMovers = [];
    }

    // Card catalog size
    metrics.totalCards = db.prepare('SELECT COUNT(*) as count FROM cards_master').get().count;

  } finally {
    db.close();
  }

  return metrics;
}

async function checkAppHealth() {
  const url = 'https://autograde-tcg-production.up.railway.app/health';
  const startMs = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - startMs;
    return {
      status: res.ok ? 'UP' : `DOWN (${res.status})`,
      latencyMs,
      ok: res.ok,
    };
  } catch (err) {
    return {
      status: `DOWN (${err.message})`,
      latencyMs: Date.now() - startMs,
      ok: false,
    };
  }
}

function formatCurrency(val) {
  if (typeof val !== 'number') return '$0.00';
  return `$${val.toFixed(2)}`;
}

async function sendDailyBriefing() {
  const timestamp = new Date().toISOString();
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Denver',
  });

  console.log(`[JARVIS] [${timestamp}] Compiling CEO morning briefing...`);

  const [metrics, health] = await Promise.all([
    Promise.resolve(gatherMetrics()),
    checkAppHealth(),
  ]);

  // Subscription summary
  const subSummary = metrics.subscriptions.length > 0
    ? metrics.subscriptions.map(s => `${s.plan}: ${s.count}`).join(' | ')
    : 'No active subscriptions';

  // Health display
  const healthEmoji = health.ok ? '🟢' : '🔴';
  const healthStr = `${healthEmoji} ${health.status} (${health.latencyMs}ms)`;

  // Price data display
  const priceEmoji = metrics.priceData.isFresh ? '🟢' : '🟡';
  const priceStr = [
    `${priceEmoji} Latest: ${metrics.priceData.latestDate}`,
    `Cards w/ fresh prices today: ${metrics.priceData.cardsFreshToday}`,
    `Total snapshots: ${metrics.priceData.totalSnapshots}`,
  ].join('\n');

  // Top movers display
  let moversStr = '';
  if (metrics.topMovers.length > 0) {
    moversStr += '🏆 **Top 3 Price Movers (Verified)**\n';
    moversStr += metrics.topMovers.map((m, i) => {
      const arrow = m.change >= 0 ? '📈' : '📉';
      const sign = m.change >= 0 ? '+' : '';
      return `${i + 1}. ${arrow} **${m.name}** (${m.set_name}): ${formatCurrency(m.current_price)} (${sign}${m.change_pct}%)`;
    }).join('\n');
  } else {
    moversStr += '_Insufficient verified historical data to compare_\n';
  }

  if (metrics.unverifiedMovers && metrics.unverifiedMovers.length > 0) {
    moversStr += '\n\n⚠️ **Unverified Movements (flagged for review)**\n';
    moversStr += metrics.unverifiedMovers.map(m => {
      const sign = m.change >= 0 ? '+' : '';
      return `- **${m.name}**: ${formatCurrency(m.current_price)} (${sign}${m.change_pct}%) — awaiting verification`;
    }).join('\n');
  }

  const embed = {
    title: `📊 PACKPULSE DAILY BRIEFING — ${dateStr}`,
    color: 0x6C5CE7, // purple
    timestamp,
    fields: [
      {
        name: '👥 Users',
        value: `Registered: **${metrics.totalUsers}**\nSubscriptions: ${subSummary}`,
        inline: true,
      },
      {
        name: '🏥 App Health',
        value: healthStr,
        inline: true,
      },
      {
        name: '💰 Price Data',
        value: priceStr,
        inline: false,
      },
      {
        name: '🏆 Price Movers',
        value: moversStr,
        inline: false,
      },
      {
        name: '📋 Tier 1 Approval Queue',
        value: '_No pending items_',
        inline: false,
      },
    ],
    footer: {
      text: 'JARVIS • Antigravity Orchestrator',
    },
  };

  const sent = await sendDiscordEmbed(BRIEFING_WEBHOOK, embed);
  if (sent) {
    console.log('[JARVIS] CEO morning briefing sent to #ceo-briefings.');
  }

  // Log summary to console
  console.log('[JARVIS] Briefing data:', JSON.stringify({
    users: metrics.totalUsers,
    cards: metrics.totalCards,
    health: health.status,
    latency_ms: health.latencyMs,
    price_fresh: metrics.priceData.isFresh,
    latest_snapshot: metrics.priceData.latestDate,
    movers: metrics.topMovers.length,
  }));
}

// Main execution
(async () => {
  const mode = process.argv[2] || 'daily';

  switch (mode) {
    case 'daily':
      await sendDailyBriefing();
      break;
    case 'escalate': {
      const title = process.argv[3] || 'Escalation';
      const desc = process.argv[4] || 'Requires CEO review';
      await sendDiscordEmbed(ESCALATION_WEBHOOK, {
        title: `🚨 Tier 2 Escalation: ${title}`,
        description: desc,
        color: 0xED4245,
        timestamp: new Date().toISOString(),
        footer: { text: 'JARVIS • Requires CEO approval before execution' },
      });
      console.log('[JARVIS] Tier 2 escalation sent.');
      break;
    }
    default:
      console.log('Usage: node scripts/jarvis-briefing.js [daily|escalate]');
  }
})();
