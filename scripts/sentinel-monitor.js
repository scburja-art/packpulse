// scripts/sentinel-monitor.js
// Run: node scripts/sentinel-monitor.js
// Or via cron: */5 * * * * node /path/to/scripts/sentinel-monitor.js

const HEALTH_URL = process.env.HEALTH_CHECK_URL || 'https://autograde-tcg-production.up.railway.app/health';
const P0_WEBHOOK = process.env.DISCORD_WEBHOOK_P0_ALERTS;
const BRIEFING_WEBHOOK = process.env.DISCORD_WEBHOOK_CEO_BRIEFINGS;
const TIMEOUT_MS = parseInt(process.env.SMOKE_TEST_TIMEOUT_MS || '5000', 10);

async function sendDiscordAlert(webhookUrl, embed) {
  if (!webhookUrl) {
    console.error('[SENTINEL] Discord webhook URL not configured');
    return;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'SENTINEL',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/2581/2581865.png',
        embeds: [embed],
      }),
    });
    if (!res.ok) {
      console.error(`[SENTINEL] Discord webhook failed: ${res.status}`);
    }
  } catch (err) {
    console.error('[SENTINEL] Discord webhook error:', err.message);
  }
}

async function healthCheck() {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeout);

    const elapsed = Date.now() - start;
    const timestamp = new Date().toISOString();

    if (res.ok) {
      console.log(`[SENTINEL] [${timestamp}] Health OK — ${elapsed}ms`);

      if (elapsed > 500) {
        await sendDiscordAlert(BRIEFING_WEBHOOK, {
          title: '⚠️ P1: Slow API Response',
          description: `Health endpoint responded in ${elapsed}ms (threshold: 500ms)`,
          color: 0xffa500, // orange
          timestamp,
          fields: [
            { name: 'Response Time', value: `${elapsed}ms`, inline: true },
            { name: 'Status', value: `${res.status}`, inline: true },
            { name: 'Severity', value: 'P1 — Next Briefing', inline: true },
          ],
        });
      }

      return { ok: true, status: res.status, elapsed };
    } else {
      console.error(`[SENTINEL] [${timestamp}] Health FAILED — HTTP ${res.status} (${elapsed}ms)`);

      await sendDiscordAlert(P0_WEBHOOK, {
        title: '🔴 P0: App Health Check Failed',
        description: `Production returned HTTP ${res.status}`,
        color: 0xff0000, // red
        timestamp,
        fields: [
          { name: 'URL', value: HEALTH_URL, inline: false },
          { name: 'Status', value: `${res.status}`, inline: true },
          { name: 'Response Time', value: `${elapsed}ms`, inline: true },
          { name: 'Action', value: 'Investigating — VEGAPUNK notified', inline: false },
        ],
      });

      return { ok: false, status: res.status, elapsed };
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    const timestamp = new Date().toISOString();
    const isTimeout = err.name === 'AbortError';

    console.error(`[SENTINEL] [${timestamp}] Health FAILED — ${isTimeout ? 'TIMEOUT' : err.message} (${elapsed}ms)`);

    await sendDiscordAlert(P0_WEBHOOK, {
      title: '🔴 P0: App Unreachable',
      description: isTimeout
        ? `Health check timed out after ${TIMEOUT_MS}ms`
        : `Connection failed: ${err.message}`,
      color: 0xff0000,
      timestamp,
      fields: [
        { name: 'URL', value: HEALTH_URL, inline: false },
        { name: 'Error', value: isTimeout ? 'Timeout' : err.message, inline: true },
        { name: 'Elapsed', value: `${elapsed}ms`, inline: true },
        { name: 'Action', value: 'P0 — Immediate investigation required', inline: false },
      ],
    });

    return { ok: false, error: err.message, elapsed };
  }
}

async function runSmokeTests(baseUrl) {
  const base = baseUrl || HEALTH_URL.replace('/health', '');
  const results = [];

  const tests = [
    {
      name: 'Card Search',
      fn: async () => {
        const res = await fetch(`${base}/api/cards`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('Response is not an array');
        return `${data.length} cards returned`;
      },
    },
    {
      name: 'Price Loading',
      fn: async () => {
        const res = await fetch(`${base}/api/cards`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        const data = await res.json();
        const withPrice = data.filter(c => c.current_price > 0);
        if (withPrice.length === 0) throw new Error('No cards have prices');
        return `${withPrice.length}/${data.length} cards have prices`;
      },
    },
    {
      name: 'API Response Time',
      fn: async () => {
        const start = Date.now();
        await fetch(`${base}/api/cards`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        const elapsed = Date.now() - start;
        if (elapsed > 500) throw new Error(`Response took ${elapsed}ms (>500ms)`);
        return `${elapsed}ms`;
      },
    },
  ];

  for (const test of tests) {
    try {
      const detail = await test.fn();
      results.push({ name: test.name, passed: true, detail });
      console.log(`  ✅ ${test.name}: ${detail}`);
    } catch (err) {
      results.push({ name: test.name, passed: false, detail: err.message });
      console.log(`  ❌ ${test.name}: ${err.message}`);
    }
  }

  return results;
}

// Main execution
(async () => {
  const mode = process.argv[2] || 'health';

  if (mode === 'smoke') {
    console.log('[SENTINEL] Running post-deploy smoke tests...');
    const results = await runSmokeTests();
    const failed = results.filter(r => !r.passed);

    if (failed.length > 0) {
      await sendDiscordAlert(P0_WEBHOOK, {
        title: '🔴 P0: Smoke Tests Failed — Rollback Required',
        description: `${failed.length}/${results.length} tests failed after deploy`,
        color: 0xff0000,
        timestamp: new Date().toISOString(),
        fields: results.map(r => ({
          name: `${r.passed ? '✅' : '❌'} ${r.name}`,
          value: r.detail,
          inline: true,
        })),
      });
      console.log(`[SENTINEL] ${failed.length} smoke tests failed — triggering rollback`);
      process.exit(1);
    } else {
      console.log(`[SENTINEL] All ${results.length} smoke tests passed`);
      await sendDiscordAlert(BRIEFING_WEBHOOK, {
        title: '✅ Deploy Verified',
        description: `All ${results.length} smoke tests passed`,
        color: 0x00ff00,
        timestamp: new Date().toISOString(),
        fields: results.map(r => ({
          name: `✅ ${r.name}`,
          value: r.detail,
          inline: true,
        })),
      });
    }
  } else {
    await healthCheck();
  }
})();
