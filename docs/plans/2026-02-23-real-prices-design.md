# Real Price Ingestion from Pokemon TCG API

## Problem
All prices in the app are random mock data. We need real market prices from TCGplayer via the Pokemon TCG API.

## Approach
Use the Pokemon TCG API with an API key (20k requests/day free tier). Each card is fetched individually by its set ID and card number. TCGplayer market prices are extracted and stored in the existing `price_snapshots` table.

## API Details
- Endpoint: `GET https://api.pokemontcg.io/v2/cards/{setId}-{cardNumber}`
- Auth: `X-Api-Key` header
- Price data location: `response.data.tcgplayer.prices`
- Price variants: `holofoil`, `normal`, `reverseHolofoil`, `1stEditionHolofoil`
- Preferred field: `market` (falls back to `mid`, then `low`)

## Files Changed

### `src/services/pokemonTcgApi.ts`
- Add `fetchCardPrice(setId, cardNumber)` using curl with API key header
- Extract best price from tcgplayer.prices with priority: holofoil > normal > reverseHolofoil > 1stEditionHolofoil
- Prefer `market` price, fall back to `mid` then `low`

### `src/services/priceIngestion.ts`
- `ingestPrices()` tries real API prices first, falls back to mock
- 500ms delay between API calls
- Logs real vs mock for each card
- Source field: `"tcgplayer"` for real, `"mock"` for fallback

### `.env`
- Add `POKEMON_TCG_API_KEY=your-key-here`

## What Stays the Same
- `price_snapshots` schema unchanged
- Frontend pages unchanged (already read from price_snapshots)
- Portfolio calculations unchanged
- Node fetch not used (hangs on this API); curl via execSync instead
