# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PackPulse** (formerly AutoGrade TCG) — a full-stack Pokemon TCG card portfolio manager with AI pre-grading, real-time price tracking, portfolio analytics, trading, and ROI optimization. Node.js/Express backend with SQLite, React SPA frontend. Deployed on Railway.

**Live URL:** https://autograde-tcg-production.up.railway.app
**Repository:** https://github.com/scburja-art/packpulse

### Mission

Mobile-first platform for TCG collectors to scan cards, track portfolio value, get AI grading estimates, and make informed buy/sell/grade decisions. Competes with Collectr by offering more frequent price updates (every 2 hours), real-time graded card pricing, and advanced grading ROI calculations.

## Agent System

This project is managed by the **Antigravity** agent orchestrator. See `AGENTS.md` for the full agent roster, approval tiers, and workflow definitions. Key agents:

- **JARVIS** — Chief Strategy Officer, orchestrates all tasks
- **VEGAPUNK** — Senior Software Engineer, the ONLY agent that writes production code (via Claude Code)
- **ATLAS** — Senior Research Analyst, handles price ingestion and market research
- **TRENDY** — Viral Scout, detects price anomalies and market trends
- **SENTINEL** — QA & Business Monitor, uptime monitoring and code review
- **SCRIBE** — Content Director, social media and marketing content

When working in Claude Code, you are operating as **VEGAPUNK**. Follow the patterns and architecture documented below. Do not make changes outside your scope without JARVIS routing the task to you.

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

# Deploy
railway up --detach            # Deploy to Railway (requires railway login)
```

No test framework is configured yet. This is a Phase 1 priority for SENTINEL.

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
- **Real card images**: Fetched from Pokemon TCG API, displayed throughout the app
- **Simulated scanning**: Camera capture UI exists, card identification uses fuzzy matching against card catalog

## Environment Variables

Copy `.env.example` → `.env`. Key vars:
- `PORT` (default 3000)
- `JWT_SECRET` (required, change from default)
- `NODE_ENV`
- `POKEMON_TCG_API_KEY` (for price ingestion and image fetching)

## Deployment

Configured for Railway (`railway.json`), Render (`render.yaml`), and Heroku (`Procfile`). Requires Node 18+. Production deploy via `railway up --detach`.

## Completed Features (v1.0 — Features 1-21)

All features below are implemented and working in production.

### Core Infrastructure
- **F1: Database schema** — Users, subscriptions, scan/pregrade credits, cards_master, price_snapshots, collections, collection_items, grade_results, trade_intents, roi_signals
- **F2: Authentication** — JWT-based register/login with token refresh
- **F3: Card catalog seed** — 56 Pokemon cards seeded from Pokemon TCG API with real images

### Card Scanning & Grading
- **F4: Card scanning pipeline** — Camera capture → OCR simulation → fuzzy match against catalog → add to collection
- **F5: AI pre-grading engine** — Simulated centering, edge, corner, surface measurements → PSA and BGS grade estimates with confidence scores
- **F6: Credit/quota system** — Monthly scan and pregrade limits per subscription tier, enforced via middleware

### Portfolio & Analytics
- **F7: Collection management** — Add/remove cards, view collection with real images and current prices
- **F8: Portfolio tracking** — Aggregate collection value, profit/loss calculations
- **F9: Price ingestion worker** — Pulls prices from Pokemon TCG API, stores snapshots for historical tracking
- **F10: Price charts** — Chart API endpoints for card-level and portfolio-level price history (d/w/m/3m/6m/y/all ranges)

### Trading & ROI
- **F11: Trade intent matching** — Users mark cards as available_for_trade or looking_for, matching worker pairs compatible intents
- **F12: ROI engine** — Computes raw vs graded value, grading cost estimates, expected value and ROI per card
- **F13: Alerts system** — Price spike detection, portfolio change alerts, new ROI opportunity notifications

### Frontend Pages
- **F14: Login/Register pages** — Auth flow with JWT storage
- **F15: Collection page** — Grid view of user's cards with images, prices, and quick actions
- **F16: Scan page** — Camera capture UI with card identification workflow
- **F17: Grades page** — View AI pre-grade results with PSA/BGS breakdowns
- **F18: Portfolio page** — Value summary, P/L display, chart placeholders
- **F19: More page** — Settings, account info, favorites, trade intents

### Production
- **F20: Railway deployment** — Live at autograde-tcg-production.up.railway.app
- **F21: Real card images** — Pokemon TCG API integration for authentic card artwork throughout the app

## Roadmap (v1.5-v2.0 — Features 22-38)

Features below are planned but NOT yet implemented. This is the build queue for VEGAPUNK.

### v1.5 Critical (Week 1)
- **F22: Real price data** — Replace simulated prices with live TCGPlayer/PriceCharting API data
- **F23: Graded card prices** — PSA/BGS price tabs on card detail pages
- **F24: Portfolio chart fix** — Implement Recharts for actual portfolio visualization
- **F25: PWA to Native wrapper** — Capacitor for iOS/Android
- **F26: App Store assets** — Screenshots, descriptions, metadata

### v1.75 Polish (Week 2)
- **F27: Price updates every 2 hours** — Cron worker for automated price ingestion
- **F28: Set browsing with filters** — Browse cards by set, rarity, price range
- **F29: AI card-only cropping** — Ignore top loaders and backgrounds in scan photos
- **F30: Customizable notifications** — User-configurable alert thresholds
- **F31: Population counts + grade probability** — PSA pop data integration
- **F32: Stripe subscription billing** — Payment processing for tier upgrades

### v2.0 Growth (Week 3)
- **F33: Multi-TCG support** — One Piece, MTG, Yu-Gi-Oh card databases
- **F34: Sealed product tracking** — Booster boxes, ETBs with market prices
- **F35: Portfolio pie chart** — Visual breakdown: raw vs graded vs sealed
- **F36: Pull rate insights** — Pack opening probability data per set
- **F37: CSV collection import** — Port collections from Collectr/TCGPlayer
- **F38: App Store submission** — iOS + Android launch

## Code Style

- TypeScript strict mode on backend, standard on frontend
- No CSS framework — inline styles with dark theme color palette
- Prefer async/await over callbacks
- Service layer handles all database queries — routes call services
- All new API routes go in `src/index.ts` (maintain single-file pattern until router refactor is approved)
- Commit messages should reference the feature number: `F22: Add real price data ingestion`
