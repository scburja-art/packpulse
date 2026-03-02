# JARVIS — Chief Strategy Officer Skill

**Agent:** JARVIS
**Division:** Orchestration
**Approval Tier:** Tier 0 (daily briefings and metric aggregation are autonomous)

---

## Capabilities

### 1. Morning CEO Briefing

Compile overnight metrics into a Discord embed and send to `#ceo-briefings` at 8:00 AM MT daily.

- **Schedule:** Daily at 8:00 AM MT (`0 8 * * *` in America/Denver)
- **Channel:** `DISCORD_WEBHOOK_CEO_BRIEFINGS`

### 2. Briefing Format

Each morning briefing contains:

| Section | Data Source |
|---------|------------|
| **User Count** | `SELECT COUNT(*) FROM users` |
| **Active Users (24h)** | Users with activity in last 24 hours |
| **Revenue (MRR)** | `SELECT COUNT(*) * tier_price FROM subscriptions WHERE status='active' GROUP BY plan` |
| **Price Ingestion Status** | Last ATLAS run: timestamp, cards updated, status |
| **App Health** | SENTINEL health check results (uptime %, avg response time) |
| **Top 3 Price Movers** | Cards with largest absolute price change in 24h |
| **Tier 1 Approval Queue** | Pending items from SCRIBE, VEGAPUNK, TRENDY needing CEO review |

### 3. Task Routing

Classify incoming signals by approval tier per AGENTS.md:

| Tier | Routing |
|------|---------|
| **Tier 0** | Execute immediately, log for FYI in next briefing |
| **Tier 1** | Queue for morning CEO briefing batch review |
| **Tier 2** | Send immediate Discord DM via `DISCORD_WEBHOOK_ESCALATIONS` |
| **Tier 3** | Full stop — flag to CEO, nothing executes until approved |

### 4. Tier 1 Queue

Batch non-critical items for the morning briefing:

- SCRIBE content drafts (tweets, newsletter)
- VEGAPUNK P1/P2 bug fix PRs
- TRENDY content opportunity flags
- SAGE feature request summaries
- PIXEL social media graphics
- CLIP short-form video clips

Items are numbered for quick CEO approve/reject via Discord reactions.

### 5. Tier 2 Escalation

Urgent items that can't wait for the morning briefing:

- New feature requests marked high-priority
- Security vulnerability reports from SENTINEL
- New data source integration requests
- Infrastructure scaling needs

Sent immediately to `DISCORD_WEBHOOK_ESCALATIONS`.

### 6. Weekly Report

Comprehensive metrics summary sent every Sunday to `DISCORD_WEBHOOK_WEEKLY_REPORT`:

- Week-over-week user growth
- Revenue trend (MRR change)
- Feature completion progress (roadmap %)
- Price ingestion reliability (% successful runs)
- Top 10 price movers of the week
- App uptime percentage
- Key decisions made / pending

---

## Environment Variables

```env
DISCORD_WEBHOOK_CEO_BRIEFINGS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_ESCALATIONS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_WEEKLY_REPORT=https://discord.com/api/webhooks/...
BRIEFING_TIMEZONE=America/Denver
BRIEFING_HOUR=8
```

---

## Implementation

### CEO Briefing Script

```js
// scripts/jarvis-briefing.js
// Run: node scripts/jarvis-briefing.js
// Daily cron: 0 8 * * * cd /app && node scripts/jarvis-briefing.js daily
// Weekly cron: 0 8 * * 0 cd /app && node scripts/jarvis-briefing.js weekly

const path = require('path');

const BRIEFING_WEBHOOK = process.env.DISCORD_WEBHOOK_CEO_BRIEFINGS;
const ESCALATION_WEBHOOK = process.env.DISCORD_WEBHOOK_ESCALATIONS;
const WEEKLY_WEBHOOK = process.env.DISCORD_WEBHOOK_WEEKLY_REPORT;
const PROJECT_ROOT = path.resolve(__dirname, '..');

function getDb() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(PROJECT_ROOT, 'data', 'autograde.db');
  return new Database(dbPath, { readonly: true });
}

async function sendDiscordEmbed(webhookUrl, embeds) {
  if (!webhookUrl) {
    console.error('[JARVIS] Discord webhook URL not configured');
    return;
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
    }
  } catch (err) {
    console.error('[JARVIS] Discord webhook error:', err.message);
  }
}

function gatherMetrics() {
  const db = getDb();
  const metrics = {};

  try {
    // User count
    metrics.totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    // Active users (24h) — users who logged in recently
    try {
      metrics.activeUsers24h = db.prepare(`
        SELECT COUNT(*) as count FROM users
        WHERE last_login > datetime('now', '-1 day')
      `).get().count;
    } catch {
      metrics.activeUsers24h = 'N/A';
    }

    // Subscription breakdown
    try {
      const subs = db.prepare(`
        SELECT plan, COUNT(*) as count FROM users GROUP BY plan
      `).all();
      metrics.subscriptions = subs;
    } catch {
      metrics.subscriptions = [];
    }

    // Price ingestion status
    try {
      const latestPrice = db.prepare(`
        SELECT MAX(recorded_at) as latest, COUNT(*) as total
        FROM price_snapshots
        WHERE recorded_at > datetime('now', '-1 day')
      `).get();
      metrics.priceIngestion = {
        lastRun: latestPrice.latest || 'Never',
        snapshotsToday: latestPrice.total || 0,
      };
    } catch {
      metrics.priceIngestion = { lastRun: 'Unknown', snapshotsToday: 0 };
    }

    // Top 3 price movers (24h)
    try {
      const movers = db.prepare(`
        WITH latest AS (
          SELECT card_id, price,
            ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY recorded_at DESC) as rn
          FROM price_snapshots
          WHERE recorded_at > datetime('now', '-1 day')
        ),
        previous AS (
          SELECT card_id, price,
            ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY recorded_at DESC) as rn
          FROM price_snapshots
          WHERE recorded_at <= datetime('now', '-1 day')
            AND recorded_at > datetime('now', '-2 days')
        )
        SELECT cm.name, cm.set_name,
          l.price as current_price,
          p.price as previous_price,
          (l.price - p.price) as change,
          ROUND(((l.price - p.price) / p.price) * 100, 1) as change_pct
        FROM latest l
        JOIN previous p ON l.card_id = p.card_id AND p.rn = 1
        JOIN cards_master cm ON cm.id = l.card_id
        WHERE l.rn = 1 AND p.price > 0
        ORDER BY ABS(l.price - p.price) DESC
        LIMIT 3
      `).all();
      metrics.topMovers = movers;
    } catch {
      metrics.topMovers = [];
    }
  } finally {
    db.close();
  }

  return metrics;
}

function formatCurrency(val) {
  if (typeof val !== 'number') return '$0.00';
  return `$${val.toFixed(2)}`;
}

async function sendDailyBriefing() {
  const timestamp = new Date().toISOString();
  console.log(`[JARVIS] [${timestamp}] Compiling morning briefing...`);

  const metrics = gatherMetrics();

  // Build subscription summary
  const subSummary = metrics.subscriptions.length > 0
    ? metrics.subscriptions.map(s => `${s.plan}: ${s.count}`).join(' | ')
    : 'No subscription data';

  // Build movers summary
  const moverLines = metrics.topMovers.length > 0
    ? metrics.topMovers.map((m, i) => {
        const arrow = m.change >= 0 ? '📈' : '📉';
        return `${i + 1}. ${arrow} **${m.name}** (${m.set_name}): ${formatCurrency(m.current_price)} (${m.change >= 0 ? '+' : ''}${m.change_pct}%)`;
      }).join('\n')
    : 'No significant movers in 24h';

  const embed = {
    title: '☀️ PackPulse Morning Briefing',
    description: `Daily report for ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Denver' })}`,
    color: 0x5865f2, // Discord blurple
    timestamp,
    fields: [
      {
        name: '👥 Users',
        value: `Total: **${metrics.totalUsers}**\nActive (24h): **${metrics.activeUsers24h}**`,
        inline: true,
      },
      {
        name: '💳 Subscriptions',
        value: subSummary,
        inline: true,
      },
      {
        name: '📊 Price Ingestion',
        value: `Last run: ${metrics.priceIngestion.lastRun}\nSnapshots (24h): ${metrics.priceIngestion.snapshotsToday}`,
        inline: true,
      },
      {
        name: '🏆 Top Price Movers (24h)',
        value: moverLines,
        inline: false,
      },
      {
        name: '📋 Tier 1 Approval Queue',
        value: '_No pending items_',
        inline: false,
      },
    ],
    footer: {
      text: 'JARVIS — PackPulse Orchestration | React with ✅ to approve, ❌ to reject',
    },
  };

  await sendDiscordEmbed(BRIEFING_WEBHOOK, embed);
  console.log('[JARVIS] Morning briefing sent.');
}

async function sendWeeklyReport() {
  const timestamp = new Date().toISOString();
  console.log(`[JARVIS] [${timestamp}] Compiling weekly report...`);

  const metrics = gatherMetrics();

  const embed = {
    title: '📊 PackPulse Weekly Report',
    description: `Week ending ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Denver' })}`,
    color: 0x57f287, // green
    timestamp,
    fields: [
      {
        name: '👥 Total Users',
        value: `${metrics.totalUsers}`,
        inline: true,
      },
      {
        name: '📊 Price Snapshots (24h)',
        value: `${metrics.priceIngestion.snapshotsToday}`,
        inline: true,
      },
      {
        name: '💳 Plans',
        value: metrics.subscriptions.length > 0
          ? metrics.subscriptions.map(s => `${s.plan}: ${s.count}`).join('\n')
          : 'N/A',
        inline: true,
      },
      {
        name: '🏆 Top Movers This Week',
        value: metrics.topMovers.length > 0
          ? metrics.topMovers.map((m, i) => `${i + 1}. **${m.name}** — ${formatCurrency(m.current_price)} (${m.change >= 0 ? '+' : ''}${m.change_pct}%)`).join('\n')
          : 'No significant movers',
        inline: false,
      },
      {
        name: '🗺️ Roadmap Progress',
        value: 'Features 1-21 complete (v1.0)\nNext: F22-F26 (v1.5)',
        inline: false,
      },
    ],
    footer: {
      text: 'JARVIS — PackPulse Weekly Summary',
    },
  };

  await sendDiscordEmbed(WEEKLY_WEBHOOK || BRIEFING_WEBHOOK, embed);
  console.log('[JARVIS] Weekly report sent.');
}

async function escalateTier2(title, description, fields) {
  await sendDiscordEmbed(ESCALATION_WEBHOOK, {
    title: `🚨 Tier 2 Escalation: ${title}`,
    description,
    color: 0xed4245, // red
    timestamp: new Date().toISOString(),
    fields: fields || [],
    footer: {
      text: 'JARVIS — Requires CEO approval before execution',
    },
  });
}

// Main execution
(async () => {
  const mode = process.argv[2] || 'daily';

  switch (mode) {
    case 'daily':
      await sendDailyBriefing();
      break;
    case 'weekly':
      await sendWeeklyReport();
      break;
    case 'escalate':
      // Usage: node scripts/jarvis-briefing.js escalate "Title" "Description"
      const title = process.argv[3] || 'Escalation';
      const desc = process.argv[4] || 'Requires CEO review';
      await escalateTier2(title, desc);
      break;
    default:
      console.log('Usage: node scripts/jarvis-briefing.js [daily|weekly|escalate]');
  }
})();
```

### Usage

```bash
# Send morning briefing (default)
node scripts/jarvis-briefing.js daily

# Send weekly report
node scripts/jarvis-briefing.js weekly

# Escalate a Tier 2 item
node scripts/jarvis-briefing.js escalate "New Feature Request" "User requests CSV import — requires Tier 2 approval"

# Crontab entries
# Daily briefing at 8:00 AM MT
# 0 15 * * * cd /app && node scripts/jarvis-briefing.js daily   # 15:00 UTC = 8:00 AM MT
# Weekly report on Sundays at 8:00 AM MT
# 0 15 * * 0 cd /app && node scripts/jarvis-briefing.js weekly
```

---

## Task Routing Logic

```
INCOMING SIGNAL
  ├─ Price ingestion complete (ATLAS) ──────── Tier 0 → Log for briefing FYI
  ├─ Price anomaly detected (TRENDY) ──────── Tier 0 → Trigger user alerts
  ├─ Content draft ready (SCRIBE) ─────────── Tier 1 → Queue for morning review
  ├─ P1/P2 bug fix PR (VEGAPUNK) ─────────── Tier 1 → Queue for morning review
  ├─ New feature request (SAGE) ───────────── Tier 1 → Queue for morning review
  ├─ New data source proposal (ATLAS) ─────── Tier 2 → Immediate escalation
  ├─ Security vulnerability (SENTINEL) ────── Tier 2 → Immediate escalation
  ├─ New dependency needed (VEGAPUNK) ─────── Tier 2 → Immediate escalation
  ├─ DB migration needed (VEGAPUNK) ───────── Tier 3 → Full stop, CEO required
  ├─ Pricing changes ──────────────────────── Tier 3 → Full stop, CEO required
  └─ App store submission ─────────────────── Tier 3 → Full stop, CEO required
```

## Integration Points

- **ATLAS → JARVIS:** Ingestion results logged for briefing; new sets flagged for Tier 2
- **TRENDY → JARVIS:** Price anomalies and content opportunities routed
- **SCRIBE → JARVIS:** Content drafts queued for Tier 1 review
- **SENTINEL → JARVIS:** Health status for briefing; security issues escalated to Tier 2
- **SAGE → JARVIS:** Feature requests and feedback summaries for briefing
- **JARVIS → CEO:** Daily briefing, weekly report, Tier 2 escalations
