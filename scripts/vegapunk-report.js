// scripts/vegapunk-report.js
// Run: node scripts/vegapunk-report.js <task-id> <status> <summary>
// Reports task completion to Discord

const BRIEFING_WEBHOOK = process.env.DISCORD_WEBHOOK_CEO_BRIEFINGS;
const P0_WEBHOOK = process.env.DISCORD_WEBHOOK_P0_ALERTS;
const ESCALATION_WEBHOOK = process.env.DISCORD_WEBHOOK_ESCALATIONS;

async function sendDiscordMessage(webhookUrl, embed) {
    if (!webhookUrl) {
        console.error('[VEGAPUNK] Discord webhook URL not configured');
        return;
    }
    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'VEGAPUNK',
                avatar_url: 'https://cdn-icons-png.flaticon.com/512/2721/2721620.png',
                embeds: [embed],
            }),
        });
        if (!res.ok) {
            console.error(`[VEGAPUNK] Discord webhook failed: ${res.status}`);
        }
    } catch (err) {
        console.error('[VEGAPUNK] Discord webhook error:', err.message);
    }
}

(async () => {
    const taskId = process.argv[2] || 'unknown';
    const status = process.argv[3] || 'complete';
    const summary = process.argv[4] || 'No summary provided';

    const timestamp = new Date().toISOString();

    const statusConfig = {
        complete: { title: '✅ Task Complete', color: 0x00ff00, webhook: BRIEFING_WEBHOOK },
        blocked: { title: '⚠️ Task Blocked — CEO Input Needed', color: 0xffa500, webhook: ESCALATION_WEBHOOK },
        failed: { title: '🔴 Task Failed', color: 0xff0000, webhook: P0_WEBHOOK },
        pr_ready: { title: '📋 PR Ready for Review', color: 0x5865f2, webhook: BRIEFING_WEBHOOK },
    };

    const config = statusConfig[status] || statusConfig.complete;

    await sendDiscordMessage(config.webhook, {
        title: `${config.title} — ${taskId}`,
        description: summary,
        color: config.color,
        timestamp,
        fields: [
            { name: 'Task ID', value: taskId, inline: true },
            { name: 'Status', value: status, inline: true },
            { name: 'Agent', value: 'VEGAPUNK', inline: true },
        ],
    });

    console.log(`[VEGAPUNK] Reported ${status} for task ${taskId}`);
})();
