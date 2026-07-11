# Vertical (formerly StairTrain)

**Mobile app that maps Singapore HDB blocks by height, so you can find tall blocks nearby to train stair-climbing on.**

Built with React Native + Expo, MapLibre (local Liberty style), and Supabase (PostGIS).

---

## Architecture

```
vertical/
├── docs/                       # Project documentation
│   └── vertical_mvp_plan.md    # Full MVP spec + current-state summary
├── supabase/migrations/        # Phase-0/1 map schema (blocks, bounds RPCs)
│   ├── 001_blocks_schema.sql
│   ├── 002_blocks_in_bounds.sql
│   └── 003_increase_limits.sql
├── scripts/                    # Data ingestion (one-off / annual)
│   ├── ingest.py               # Pull HDB data → geocode → upsert into Supabase
│   └── requirements.txt
├── mobile/                     # React Native + Expo app
│   ├── supabase/               # Phase-2 schema — run these AFTER the /supabase ones:
│   │   ├── phase2a_schema.sql  #   base auth/climbs/badges/verification/photos schema
│   │   └── phase2a_addendum*.sql  # incremental migrations 2 … 29 (run in numeric order)
│   ├── assets/
│   │   ├── map-style.json / map-style-dark.json   # MapLibre Liberty styles (light/dark)
│   │   ├── water-coolers.json / amenities.json    # bundled amenity datasets
│   │   ├── groups/             # bundled club/event/race venue photos (openly-licensed)
│   │   └── mock/               # local placeholder images for empty feeds
│   └── src/
│       ├── config/             # Supabase client init
│       ├── types/              # TypeScript types + BADGE_DEFS
│       ├── services/           # Supabase RPC calls (climbs, blocks, …)
│       ├── hooks/              # useLocation (GPS + Singapore fallback)
│       ├── contexts/           # AuthContext (anonymous-first auth)
│       ├── utils/              # storage, goals, medalColor, compressImage, wikimediaThumb, …
│       ├── screens/            # MapScreen, SocialScreen, GroupsScreen, HomeScreen, ProfileScreen, Onboarding
│       └── components/         # ClimbTrackerModal, BuildingDetailSheet, MedalBadge, PhotoGridPicker/Gallery,
│                               #   Club/Challenge/Badge/PublicProfile modals, SceneryBanner, …
├── .env.example                # Template — copy to .env.local
└── .gitignore
```

Built features include:
- **Bottom tab navigation** — 4 custom tabs (Social, Map, Groups, Home) implemented with touchable icons, edge-swipe gestures, and Animated transitions. No react-navigation required. Profile (badges, climb history, settings) is no longer its own tab — it opens as a slide-up overlay from tapping your own avatar in Social or Groups.
- **Home tab** — an analytics/goals dashboard: weekly and monthly floor-climbing goals (editable, persisted to Supabase), a progressive-overload projection for next month's goal (raises 10% if you met this month's goal, holds steady at 70–100%, eases off below that), and a 31-day calendar showing which days you actually climbed vs. suggested climb days (spaced by your onboarding-derived cadence) with tappable local reminders. Its header also has a gear (→ Settings) and a Help & Feedback entry.
- **Help & Feedback** — an in-app screen (from Home): an expandable FAQ plus a report form (Bug / Idea / Amenity / Other + message + optional screenshot) that writes to a Supabase `feedback` table you triage in the dashboard, plus a link to the community Telegram for richer media (videos/screen recordings).
- **Map screen** — MapLibre with local Liberty style JSONs (light + dark). Building pins colored by height tier (blue 1-10, orange 11-20, red 21-30, dark red 31-39, purple 40+). Strava-style top search bar, saved buildings, suggested-climbs banner, right-side icon stack (filter/layers/alert/location), a "My Challenges" banner that refreshes when you switch back to this tab.
- **Amenities, now real & shared** — water coolers/toilets/shops render from bundled data, plus user-submitted reports backed by Supabase (`amenity_reports`). Anyone can verify a report (auto-verifies at 3 confirmations), leave a comment (only the single most-liked comment is shown, with its like count), remove their own report, and is capped at 5 outstanding unverified reports at a time. The same verify/comment mechanism now also covers the static bundled water-cooler dataset's own unverified entries, not just user reports.
- **Climb tracking** — barometer/step-counter powered `ClimbTrackerModal` (ready → tracking → paused/resumed → save), with tracking-method transparency (barometer vs. pedometer vs. manual estimate) shown on posts. Barometer mode fuses in the accelerometer for intelligent segmentation — rhythmic stepping motion is what distinguishes a real ascent/descent from an elevator or escalator ride (barometer altitude alone can't tell them apart), shown live as a phase badge (Climbing / Descending / Elevator detected — not counted / Resting). Thresholds are reasonable starting points, not device-calibrated.
- **Social feed** — posts support up to 6 photos each (swipeable gallery with a page counter), kudos, comments (avatar + timestamp + "view all"), 3-dot post menu (follow/hide/report), mock preview data when your network is sparse. Tapping any avatar (including preview/mock climbers) opens that person's public profile.
- **Groups tab** — Challenges, Clubs, and Events in one place:
  - **Challenges**: official + user-created (public or peers-only), real start/end dates, a per-challenge in-app leaderboard, custom hand-drawn medal badges (not stock icons), monthly "Overwatch-style" resetting badges that expire if not re-completed, and dedicated full-width cards for the hardest challenges (Everest Gauntlet, Double Eight-Thousander).
  - **Clubs**: three official app-run clubs (Hiking, Trail Running, Climbing) with a shared weekly member leaderboard and an organizer/admin-only weekly channel (regular members react with emoji, can't post text) that rolls over every Monday, plus an Announcements club and user-submitted clubs.
  - **Events**: a curated set of real vertical-marathon/towerrunning races (Swissôtel, Empire State Building Run-Up, Taipei 101, Eiffel Tower, KL Tower, Sky Tower Auckland, …) and recurring local training sessions, each with an openly-licensed landscape venue/skyline photo, shown chronologically in swipeable rows with an in-app detail page. Not scraped live — hand-curated; see the note below on making these live-editable post-launch.
- **Profile** — a Strava/Coros-inspired dashboard (reached via avatar tap, not a tab): one accent color, flat number-forward stat rows, a real multi-week trend chart, personal records, avatar upload (photo or mascot skin), and an animated "legendary" badge frame for special achievements.
- **Onboarding → goals** — path, motivation, and fitness answers jointly compute your starting weekly goal (not just fitness level alone), and your path also sets a suggested weekly climb cadence used by the Home tab's calendar.
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

### 3. Supabase — run the migrations

Open your Supabase project dashboard → **SQL Editor**, and run these **in order**:

**a. Phase 0/1 — map data** (from `supabase/migrations/`):
   - `001_blocks_schema.sql` — tables, indexes, `nearby_blocks` RPC
   - `002_blocks_in_bounds.sql` — `blocks_in_bounds` RPC for map pan/zoom
   - `003_increase_limits.sql` — result caps for dense areas

**b. Phase 2 — auth, social, groups, amenities, goals** (from `mobile/supabase/`):
   - `phase2a_schema.sql` first — auth/profiles/climbs/badges/verification/photos/notifications.
   - then every `phase2a_addendum*.sql` **in numeric order** (2, 3, … 29). Each is an
     incremental migration (leaderboards, social feed, challenges, official clubs,
     amenity verification + comments, monthly-resetting badges, multi-photo posts,
     the Home-tab goal columns, etc.). Skipping any means the corresponding feature
     silently fails (RLS denies, columns missing).

> New addenda are added as features land — always run any you haven't yet, newest last.

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

This app uses native modules (MapLibre, Google/Apple sign-in, barometer/pedometer, and `expo-image-manipulator` for photo compression), so it requires a **custom development build** — plain Expo Go won't run it. Adding a new native module (as `expo-image-manipulator` was) means rebuilding the dev client via `npx eas-cli build --profile development` before it takes effect; code that calls such a module is written to degrade gracefully until then (e.g. photo compression falls back to uploading the original).

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
| Post photos | `climbs.photo_paths text[]` (up to 6), `photo_path` kept as `photo_paths[0]` mirror | New multi-photo galleries without breaking any older code path still reading the singular column |
| Photo compression | `expo-image-manipulator` (resize ≤1200px, JPEG q0.8) via `utils/compressImage.ts`, wired into every upload path | Turns multi-MB camera photos into ~150–400KB uploads. Native module → engages after a dev-client rebuild; falls back to the original photo until then |
| Collapsing tab bar (Groups) | Native-driven `Animated.diffClamp(scrollY)` transform, Strava-style | Bar position tracks scroll 1:1 on the UI thread — smooth and immune to the JS-thread jank / re-render interruptions that earlier height-animation attempts hit |
| Badge medals | One `MedalBadge` everywhere — hand-drawn emblem for challenge archetypes, the badge's own Ionicon on the disc otherwise | Every badge is a proper medal, uniquely identifiable, and identical in the shelf, the tap-in detail, and challenge cards |
| Goals | `profiles.weekly_goal_floors` + `climb_cadence_per_week`, monthly goal always derived client-side | One source of truth per user; monthly/next-month projection can never drift out of sync with the stored weekly value |
| Climb reminders | Local-only (AsyncStorage), no push notifications yet | Real push needs `expo-notifications` — a new native module that would likely force another EAS dev-client rebuild, so it's deliberately deferred rather than bundled in |
| In-app feedback | `feedback` table (RLS: insert/read your own only) + optional screenshot to Storage; community link to Telegram | Structured, account-attributable bug/idea reports you triage in the dashboard; video/rich media goes to the community channel, not an in-app upload pipeline |
| Curated events | Hardcoded arrays with bundled landscape venue photos | Immediate content with no runtime dependency; to update them post-launch without a rebuild, migrate to a `curated_events` Supabase table (images in Storage) — see the note in Setup |

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
| **2d** | Home tab (goals, progressive-overload projection, 31-day calendar), Profile moved to avatar-access (no longer a tab), multi-photo social posts (up to 6), onboarding → goal linkage, barometer+accelerometer climb segmentation | ✅ Built |
| **2e** | Photo compression, Strava collapsing tab bar, unified badge medals, expanded curated events (landscape venue photos), in-app Help & Feedback (FAQ + report form → `feedback` table) | ✅ Built |
| **3** | Avatar-frame challenge rewards, in-club threaded replies, live event/training scraping (or a `curated_events` table for live edits), push notification reminders, device-calibrated sensor-fusion thresholds | Not built |

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
