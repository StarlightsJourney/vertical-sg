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
- **Bottom tab navigation** — 4 custom tabs (Social, Groups, Map, Profile) implemented with touchable icons, edge-swipe gestures, and Animated transitions. No react-navigation required.
- **Map screen** — MapLibre with local Liberty style JSONs (light + dark). Building pins colored by height tier (blue 1-10, orange 11-20, red 21-30, dark red 31-39, purple 40+). Strava-style top search bar, saved buildings, suggested-climbs banner, right-side icon stack (filter/layers/alert/location), a "My Challenges" banner that refreshes when you switch back to this tab.
- **Amenities, now real & shared** — water coolers/toilets/shops render from bundled data, plus user-submitted reports backed by Supabase (`amenity_reports`). Anyone can verify a report (auto-verifies at 3 confirmations), leave a comment (only the single most-liked comment is shown, with its like count), remove their own report, and is capped at 5 outstanding unverified reports at a time. The same verify/comment mechanism now also covers the static bundled water-cooler dataset's own unverified entries, not just user reports.
- **Climb tracking** — barometer/step-counter powered `ClimbTrackerModal` (ready → tracking → paused/resumed → save), with tracking-method transparency (barometer vs. pedometer vs. manual estimate) shown on posts.
- **Social feed** — photo-required posts, kudos, comments (avatar + timestamp + "view all"), 3-dot post menu (follow/hide/report), mock preview data when your network is sparse.
- **Groups tab** — Challenges, Clubs, and Events in one place:
  - **Challenges**: official + user-created (public or peers-only), real start/end dates, a per-challenge in-app leaderboard, custom hand-drawn medal badges (not stock icons), monthly "Overwatch-style" resetting badges that expire if not re-completed, and dedicated full-width cards for the hardest challenges (Everest Gauntlet, Double Eight-Thousander).
  - **Clubs**: three official app-run clubs (Hiking, Trail Running, Climbing) with a shared weekly member leaderboard and an organizer/admin-only weekly channel (regular members react with emoji, can't post text) that rolls over every Monday, plus an Announcements club and user-submitted clubs.
  - **Events**: real vertical-marathon/towerrunning races and recurring local training sessions, each with a real photo of the actual venue (openly-licensed), shown chronologically.
- **Profile** — a Strava/Coros-inspired dashboard: one accent color, flat number-forward stat rows, a real multi-week trend chart, personal records, avatar upload (photo or mascot skin), and an animated "legendary" badge frame for special achievements.
- **Web preview** — `npx expo start --web` runs Social/Groups/Profile/Settings in a browser (Map and climb tracking need native modules and only run on a phone).
- **Dark mode** — full light/dark theming (`isDark` state from `App.tsx`) across every screen.
- **Performance** — fixed pin sizes, zoom-gated amenity density, bounds caching with debounce + movement threshold.
- **Singapore bounds restriction** — camera locked to Singapore via `maxBounds` and `minZoom`.

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

**Browser preview:** `npx expo start --web` runs Social, Groups, Profile, and Settings in a regular browser tab — useful for quickly checking UI changes without a device. Map and climb tracking depend on native modules (MapLibre, barometer/step counter) and show a "not available on web" placeholder there instead.

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
| Tab navigation | Custom touchable-based tabs (no react-navigation) | Avoids native module linking, works instantly with no Expo dev-build dependency |
| Amenity reporting | Supabase-backed (`amenity_reports`), community-verified | Shared across users — verify (3-confirmation threshold), comment, delete your own, anti-spam cap. Static bundled amenities use a parallel verification table since they aren't DB rows. |
| Challenge badges | Client-side `BADGE_DEFS` + `user_badges`/`challenge_participants` tables | Most badges are permanent once earned; a subset (`resets: 'monthly'`) re-lock each calendar month until re-completed, Overwatch-season-style |
| Auth | Anonymous-first (`signInAnonymously`), upgradeable to a real account | Lets people use the app immediately; RLS is the sole authorization layer everywhere |

---

## Phase roadmap

| Phase | Scope | Status |
|---|---|---|
| **0** | Data ingestion pipeline | ✅ Built |
| **1** | MVP app (browse map, filter/search, star blocks, climb logging, water cooler markers) | ✅ Complete |
| **1.5** | Bottom tab navigation, amenity markers (toilets, shops), interactive placement, animated splash, performance fixes, dark mode | ✅ Built |
| **2a** | Auth (anonymous-first), badges, height verification, building photos, notifications | ✅ Built |
| **2b** | Social feed, leaderboard (public/friends), public profiles, kudos/comments | ✅ Built |
| **2c** | Groups: challenges (official + user-created), official clubs with weekly channels, events, amenity verification/comments as a shared DB feature, Profile dashboard redesign | ✅ Built |
| **3** | Avatar-frame challenge rewards, in-club threaded replies, true live event/training scraping | Not built |

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
