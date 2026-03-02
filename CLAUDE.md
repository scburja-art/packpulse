# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoGrade TCG — a full-stack Pokemon TCG card collection manager with grading simulation, portfolio analytics, trading, and ROI optimization. Node.js/Express backend with SQLite, React SPA frontend.

## Commands

```bash
# Development
npm run dev                    # Backend dev server (ts-node, port 3000)
cd client && npm run dev       # Frontend dev server (Vite, proxies to :3000)

# Build
npm run build                  # Full build (client + server)
npm run build:server           # Backend only (tsc + copy schema.sql)
npm run build:client           # Frontend only (Vite → dist/client)

# Database
npm run seed                   # Seed card catalog
npm run ingest                 # Ingest prices from Pokemon TCG API
npm run db:setup               # seed + seed:prices
npm run db:reset               # backup, reset, re-setup

# Data
npm run fetch:images           # Download card images from Pokemon TCG API
```

No test framework is configured.

## Architecture

**Backend** (`src/`): Express 5 REST API, CommonJS TypeScript (target ES2020), SQLite via better-sqlite3.

**Frontend** (`client/src/`): React 19 SPA with React Router 7, Vite build, ESM TypeScript. Axios with Bearer token interceptor for API calls.

**Database**: SQLite file at `data/autograde.db`. WAL mode, foreign keys enabled. Auto-seeds on startup if empty.

### Backend Structure

- `src/index.ts` — Express server, all route definitions (no router files)
- `src/services/` — Business logic: auth, cardScanner, gradingEngine, portfolio, priceIngestion, pokemonTcgApi, matching, roiEngine, alerts, credits
- `src/middleware/` — auth (JWT verification), checkCredit (quota enforcement), checkPlan (subscription gating)
- `src/db/` — Database init, schema.sql, seed files, migrations, backup

### Frontend Structure

- `client/src/App.tsx` — Route definitions with auth-gated redirects
- `client/src/pages/` — Feature pages (Collection, Scan, Grades, Portfolio, More, Login, Register)
- `client/src/context/AuthContext.tsx` — JWT auth state, client-side token decoding
- `client/src/services/api.ts` — Axios instance with auth interceptor
- `client/src/components/Layout.tsx` — Dark-themed shell with 5-tab bottom nav

### Key Patterns

- **All routes in one file**: `src/index.ts` contains every API endpoint — no separate router modules
- **Middleware chain**: Routes use `authenticateToken` → `checkCredit`/`checkPlan` as needed
- **Service layer**: Business logic lives in `src/services/`, DB queries happen there (not in routes)
- **Credit system**: Monthly scan/pregrade quotas tracked per user, enforced via middleware
- **Subscription tiers**: free/starter/pro/premium — ROI features require starter+
- **Price snapshots**: Historical price records enable portfolio charting and ROI analysis
- **Inline CSS**: Frontend uses inline styles with dark theme, no CSS framework

## Environment Variables

Copy `.env.example` → `.env`. Key vars:
- `PORT` (default 3000)
- `JWT_SECRET` (required, change from default)
- `NODE_ENV`
- `POKEMON_TCG_API_KEY` (for price ingestion and image fetching)

## Deployment

Configured for Railway (`railway.json`), Render (`render.yaml`), and Heroku (`Procfile`). Requires Node 18+.
