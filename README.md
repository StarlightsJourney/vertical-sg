# Vertical (formerly StairTrain)

**Mobile app that maps Singapore HDB blocks by height, so you can find tall blocks nearby to train stair-climbing on.**

Built with React Native + Expo, Mapbox, and Supabase (PostGIS).

---

## Architecture

```
vertical/
├── docs/                    # Project documentation
│   └── vertical_mvp_plan.md # Full MVP spec (read this first)
├── supabase/
│   └── migrations/          # SQL migrations (run in Supabase SQL editor)
│       └── 001_blocks_schema.sql
├── scripts/                 # Data ingestion (one-off / annual)
│   ├── ingest.py            # Pull HDB data → geocode → upsert into Supabase
│   └── requirements.txt
├── mobile/                  # React Native + Expo app
│   └── src/
│       ├── config/          # Supabase client init
│       ├── types/           # TypeScript types (Block, SortMode)
│       ├── services/        # Supabase query functions (nearby_blocks RPC)
│       ├── hooks/           # useLocation hook (GPS permission + position)
│       ├── screens/         # Screen components
│       │   └── MapScreen.tsx
│       └── components/      # Reusable UI components
│           └── BlockDetailSheet.tsx
├── .env.example             # Template — copy to .env.local
├── .env.local               # Your real credentials (git-ignored)
└── .gitignore
```

---

## Setup

### Prerequisites

- **Node.js** 18+
- **Python** 3.9+ (for ingestion script only)
- **Supabase** project (free tier works)
- **Mapbox** account (free tier: 50K map loads/month)
- **OneMap** account (free — register at [onemap.gov.sg](https://www.onemap.gov.sg))

### 1. Clone & install

```bash
git clone https://github.com/StarlightsJourney/vertical-sg.git
cd vertical-sg

# Mobile app
cd mobile
npm install
```

### 2. Environment variables

**Root `.env.local`** (for the ingestion script):
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # service_role secret — NEVER put in the app
ONEMAP_EMAIL=your_email@example.com
ONEMAP_PASSWORD=your_password
# OR use a token directly:
# ONEMAP_TOKEN=your_jwt_token
```

**Mobile `.env.local`** (for the Expo app):
```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...     # anon public key — safe for client
EXPO_PUBLIC_MAPBOX_TOKEN=pk.eyJ...       # Mapbox public access token
```

### 3. Supabase — run the migration

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Paste the contents of `supabase/migrations/001_blocks_schema.sql`
4. Click **Run**

This creates the `blocks` table, `unmatched_hdb_blocks` table, PostGIS indexes, and the `nearby_blocks` RPC function.

### 4. Run data ingestion

```bash
cd scripts
pip install -r requirements.txt
python ingest.py
```

The script will:
- Pull ~13K HDB residential blocks from data.gov.sg
- Standardize addresses and geocode via multi-pass join
- Upsert into your Supabase `blocks` table

Expected runtime: a few minutes (rate-limited to respect OneMap's 300 calls/min limit).

### 5. Launch the app

```bash
cd mobile
npx expo start
```

Scan the QR code with Expo Go (iOS/Android), or press `a` for Android emulator / `i` for iOS simulator.

---

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Mobile framework | React Native + Expo | Single codebase, both platforms |
| Backend | Supabase (Postgres + PostGIS) | Built-in PostGIS, auth for Phase 2, free tier sufficient |
| Map rendering | Mapbox (`@rnmapbox/maps`) | Best RN map lib, free tier 50K loads/mo |
| Directions | Deep-link to Google Maps | No API key, no routing logic to maintain |
| Geocoding | OneMap API (free, SG-specific) | Multi-pass: postal code → polygon join → fuzzy match → OneMap fallback |
| Auth (MVP) | None | Read-only app, no user accounts needed |

---

## Phase roadmap

| Phase | Scope | Status |
|---|---|---|
| **0** | Data ingestion pipeline | ✅ Script built |
| **1** | MVP app (browse map, see heights, get directions) | ✅ Core screens built |
| **2** | Crowdsourced verification & condition reports | ❓ Scoped, not built |
| **3** | Climb logging, amenities, advanced moderation | ❓ Unscoped |

---

## Contributing

Work happens on feature branches off `main`. Branch naming: `phase-N-description` or `fix/short-description`.

```bash
git checkout -b phase-1-pin-clustering
# ... make changes ...
git push -u origin phase-1-pin-clustering
```

---

## License

TBD
