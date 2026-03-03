# Task Ticket: ATLAS Data Quality Fix

**Task ID:** VPK-001
**Priority:** P1
**Approval Tier:** Tier 2 (CEO review before merge)
**Assigned To:** VEGAPUNK
**Requested By:** CEO (Stove)
**Branch:** `vegapunk/VPK-001-atlas-data-quality`

---

## Problem

ATLAS price ingestion is functional but has data quality issues:

1. **False price spikes** — Gengar ex showed +1000.3% in today's JARVIS briefing. This is a data artifact (likely first snapshot comparison or bad source value), not a real market movement. If users see this in alerts, it destroys credibility.

2. **Low coverage** — Only 28 cards have fresh prices; 28 cards skipped (legacy sets). Modern sets should be fully covered before expanding to other TCGs.

3. **No validation layer** — Prices are accepted as-is from the API with no sanity checking.

---

## Deliverables

### Deliverable 1: Anomaly Filter

Add price anomaly detection to the ingestion pipeline.

**Rules:**
- Any price change > ±80% in 24 hours → flag as `unverified` instead of accepting
- Any card going from $0 or NULL to a price → mark as `initial_snapshot` (not a "movement")
- Unverified price movements trigger a SENTINEL P0 alert for investigation
- JARVIS briefing should show unverified movers separately from confirmed movers

**Implementation location:** `src/services/priceIngestion.ts`

**Logic:**
```
For each card being ingested:
  1. Fetch previous price snapshot (most recent before today)
  2. If no previous snapshot exists → insert normally, tag as initial_snapshot
  3. If previous snapshot exists:
     a. Calculate % change = (new_price - old_price) / old_price * 100
     b. If abs(% change) > 80% → insert with verified = false
     c. If abs(% change) <= 80% → insert normally with verified = true
```

**Schema change needed:** Add `verified` boolean column to `price_snapshots` table (default: true).

### Deliverable 2: Expanded Card Coverage

Increase ingestion from 28 cards to all cards in modern sets (Scarlet & Violet era: sv1 through current).

**Current issue:** Legacy sets are being skipped entirely. Modern sets should be prioritized.

**Approach:**
- Query Pokemon TCG API for all sets where `series` = "Scarlet & Violet"
- Ingest all cards from these sets first (batch by set, not all-at-once)
- Legacy sets (Sword & Shield and older) become a secondary pass if time/quota allows
- Update ATLAS Discord reporting to show: cards updated per set, total coverage %

**Rate limiting:** Keep the 1-second delay between API calls (`INGESTION_RATE_LIMIT_MS=1000`). Batch by set to avoid timeouts.

### Deliverable 3: JARVIS Briefing Update

Modify `scripts/jarvis-briefing.js` to distinguish verified vs unverified price movements.

**Updated Top 3 Price Movers format:**
```
🏆 Top 3 Price Movers (Verified)
1. 📈 Card Name: $XX.XX (+XX%)
2. 📉 Card Name: $XX.XX (-XX%)
3. 📈 Card Name: $XX.XX (+XX%)

⚠️ Unverified Movements (flagged for review)
- Card Name: $XX.XX (+1000%) — awaiting verification
```

---

## Test Plan

After implementation, verify:

1. **Build passes:** `npm run build` → 0 errors
2. **TypeScript compiles:** `npx tsc --noEmit` → 0 errors
3. **Ingestion runs:** `node scripts/atlas-ingest.js` → completes without crash
4. **Anomaly filter works:** Manually insert a price snapshot for a card at $1.00, then ingest a new price of $100.00 → should be flagged as unverified
5. **Coverage increased:** Post-ingestion, count cards with fresh prices → should be significantly more than 28
6. **JARVIS briefing reflects changes:** Run `node scripts/jarvis-briefing.js` → verified and unverified sections appear correctly
7. **Discord notifications work:** Check #ceo-briefings and #p0-alerts for correct formatting

---

## Files to Modify

- `src/db/schema.sql` — Add `verified` column to `price_snapshots`
- `src/services/priceIngestion.ts` — Add anomaly detection logic
- `src/services/pokemonTcgApi.ts` — Expand set coverage to all Scarlet & Violet sets
- `scripts/atlas-ingest.js` — Update Discord reporting format
- `scripts/jarvis-briefing.js` — Separate verified vs unverified movers

---

## Completion Criteria

- [ ] Anomaly filter catches >80% swings and flags as unverified
- [ ] Initial snapshots (first price for a card) don't show as price movements
- [ ] All Scarlet & Violet era cards are being ingested
- [ ] JARVIS briefing separates verified and unverified movers
- [ ] SENTINEL receives P0 alert when unverified movements are detected
- [ ] All tests in test plan pass
- [ ] PR opened with description and test results
- [ ] Reported to Discord via vegapunk-report.js
