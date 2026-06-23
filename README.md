# Vertical (formerly StairTrain)

**Mobile app that maps Singapore HDB blocks by height, so you can find tall blocks nearby to train stair-climbing on.**

Built with React Native + Expo, MapLibre (local Liberty style), and Supabase (PostGIS).

---

## Architecture

```
vertical/
├── docs/                    # Project documentation
│   └── vertical_mvp_plan.md # Full MVP spec (read this first)
├── supabase/
│   └── migrations/          # SQL migrations (run in Supabase SQL editor)
│       ├── 001_blocks_schema.sql
│       ├── 002_blocks_in_bounds.sql
│       └── 003_increase_limits.sql
├── scripts/                 # Data ingestion (one-off / annual)
│   ├── ingest.py            # Pull HDB data → geocode → upsert into Supabase
│   └── requirements.txt
├── mobile/                  # React Native + Expo app
│   ├── assets/
│   │   ├── map-style.json        # Light OpenFreeMap style (Liberty schema, no 3D buildings)
│   │   ├── map-style-dark.json   # Dark variant for night mode
│   │   ├── water-coolers.json    # ~131 water cooler locations across SG
│   │   └── amenities.json        # 120 toilets/food/shop locations across SG
│   └── src/
│       ├── config/               # Supabase client init
│       ├── types/                # TypeScript types (Block, ClimbLog, BoundsRect, SortMode)
│       ├── services/             # Supabase RPC calls (nearby_blocks, blocks_in_bounds)
│       ├── hooks/                # useLocation hook (GPS permission + Singapore fallback)
│       ├── utils/
│       │   └── storage.ts        # AsyncStorage-backed (persistent: climb history, stars, reports)
│       ├── screens/
│       │   └── MapScreen.tsx     # Main map: pins, water cooler/amenity markers, filter, placement, splash
│       └── components/
│           ├── AnimatedSplash.tsx # Animated loading screen (5 rising bars + "Vertical" logo)
│           ├── BlockDetailSheet.tsx  # Floating glass card for block details + climb logging
│           └── SearchScreen.tsx      # Search with filter chips, starred, recent, My Climbs
├── .env.example             # Template — copy to .env.local
├── .env.local               # Your real credentials (git-ignored)
└── .gitignore
```

Built features include:
- **Map pins** colored by height tier (blue 1-10, orange 11-20, red 21-30, dark red 31-39, purple 40+) with fixed 5px radius and gold stroke for climbed blocks.
- **Cycling filter toggle** — tap to cycle 21+ → 31+ → 40+ → All, pins re-filter instantly.
- **Water cooler markers** — ~131 individual `<Marker>` components using Ionicons (`water-outline`) with verified/unverified/ticketed status colors. Tap shows a floating info card.
- **Amenity markers** — 120 toilet and food/shop markers (purple/orange Ionicons) rendered at zoom >= 13 for performance.
- **Interactive amenity placement** — tap amber `+` button, pick category (Water Cooler/Toilet/Food & Shop), crosshair overlay to position on map, add optional description, submit. Saved to AsyncStorage, appears immediately as unverified marker.
- **Pending/unverified markers** — gray dashed-border markers with semi-transparent background, tappable to view status and get directions. Only rendered at zoom >= 13.
- **Search screen** — full-height modal with debounced address search, filter chips (40+/31+/21+/All), starred blocks, recent blocks (3 with "See more"), and My Climbs history with stats.
- **Floating glass card** — translucent card positioned near the tapped pin showing storeys, height, distance, address, quantity selector for climbs, and a directions link.
- **Climb logging** — `+`/`-` quantity selector with AsyncStorage persistence. My Climbs section shows total climbs/floors/meters.
- **Animated splash screen** — 5 height-tier colored bars rise sequentially on launch, then the "Vertical" logo fades in with subtitle. Uses native driver for 60fps.
- **Day/night auto-switching** — switches between light and dark map styles based on local time (7pm-6am).
- **Singapore bounds restriction** — camera locked to Singapore island via `maxBounds` and `minZoom`.
- **My Location button** — re-centers map on user's current GPS position.
- **Height legend** — colored dots at top-right showing the 5 tier colors.
- **Fixed pin sizes** — constant 5px radius (no zoom scaling) for smooth performance.

---

## Setup

### Prerequisites

- **Node.js** 18+
- **Python** 3.9+ (for ingestion script only)
- **Supabase** project (free tier works)
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

# Recommended: direct API token (see .env.example for how to generate one)
ONEMAP_TOKEN=your_jwt_token_here

# Alternative: email + password (script auto-fetches a JWT each run)
# ONEMAP_EMAIL=your_email@example.com
# ONEMAP_PASSWORD=your_password
```

**Mobile `.env.local`** (for the Expo app):
```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...     # anon public key — safe for client
```

### 3. Supabase — run the migration

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Run the migrations in order from `supabase/migrations/`:
   - `001_blocks_schema.sql` — creates tables, indexes, and `nearby_blocks` RPC
   - `002_blocks_in_bounds.sql` — creates `blocks_in_bounds` RPC for map pan/zoom
   - `003_increase_limits.sql` — increases result caps for dense areas

### 4. Run data ingestion

```bash
cd scripts
pip install -r requirements.txt
python ingest.py
```

The script will:
- Pull ~13K HDB residential blocks from data.gov.sg
- Standardize addresses and geocode via OneMap Search API
- Upsert into your Supabase `blocks` table

Expected runtime: a few minutes (rate-limited to respect OneMap's 300 calls/min limit).

### 5. Launch the app

This app uses MapLibre native rendering, which requires a **development build** (Expo Go does not support native modules).

```bash
cd mobile
npx expo start
```

Then press `a` for Android emulator / `i` for iOS simulator, or run a development build on your device:

```bash
# Build + install on connected device/emulator
npx expo run:android   # or npx expo run:ios
```

See [Expo Development Builds](https://docs.expo.dev/develop/development-builds/introduction/) for more details.

---

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Mobile framework | React Native + Expo | Single codebase, both platforms |
| Backend | Supabase (Postgres + PostGIS) | Built-in PostGIS, auth for Phase 2, free tier sufficient |
| Map rendering | MapLibre (`@maplibre/maplibre-react-native`) | Local Liberty style (no fonts needed, 3D buildings stripped) — no API key required |
| Directions | Deep-link to Google Maps | No API key, no routing logic to maintain |
| Geocoding | OneMap API (free, SG-specific) | Single-pass OneMap Search API — all geocoding goes through OneMap |
| Auth (MVP) | None | Read-only app, no user accounts needed |
| Amenity reporting | Local AsyncStorage, unverified markers | Reports saved to device, appear as pending gray markers immediately |

---

## Phase roadmap

| Phase | Scope | Status |
|---|---|---|
| **0** | Data ingestion pipeline | ✅ Built |
| **1** | MVP app (browse map, filter/search, star blocks, climb logging, water cooler markers, report/alert system) | ✅ Built |
| **2** | Social & community features (accounts, social feed, leaderboard, in-app routing, photo submissions, building detail expansion, tab navigation) | ❓ Scoped, not built |
| **3** | Gamification & advanced moderation (badges, streaks, amenity verification, trust-weighted scoring) | ❓ Unscoped |

---

## Contributing

Work happens on feature branches off `main`. Branch naming: `fix/short-description` or `feature/short-description`.

```bash
git checkout -b fix/descriptive-name
# ... make changes ...
git push -u origin fix/descriptive-name
```

---

## License

TBD
