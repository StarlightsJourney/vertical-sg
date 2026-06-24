# Vertical — MVP Build Plan

**Purpose of this doc:** handoff spec for an AI coding agent (DeepSeek) to implement. Each phase is scoped to be buildable independently. Locked decisions are marked ✅ — do not re-litigate these. Open questions for future phases are marked ❓.

**Product summary:** Mobile app (iOS + Android) that maps Singapore HDB (public housing) blocks, showing building height/storey count, so people can find tall blocks nearby to train stair-climbing on. MVP is read-only browsing. Crowdsourced condition reports (ventilation, dust, photos) and routing are explicitly out of scope for MVP.

**Current State (as of 2026-06-24):** Phase 1 (read-only browse map, filter/search, climb logging) and Phase 1.5 (bottom tab navigation, amenity markers, interactive placement, animated splash, performance fixes, dark mode) are shipped. The app features MapLibre rendering with local style JSONs, 131 water cooler + 120 toilet/shop markers rendered as Ionicons on Marker components, and a custom tab bar (Social/My Climbs/Map/Profile). Phase 2 (accounts, social, leaderboard) is under consideration.

---

## Locked Tech Stack ✅

| Layer | Choice | Notes |
|---|---|---|
| Mobile framework | React Native + Expo | Single codebase, both platforms |
| Backend / DB | Supabase (Postgres + PostGIS) | Also provides storage + auth for later phases — don't provision separate services |
| Map rendering | MapLibre | Use `@maplibre/maplibre-react-native` for React Native |
| Routing / directions | None built — deep link out to Google Maps / Citymapper | `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}` — no API key needed, this is just opening another app |
| Geocoding (one-time, ingestion only) | OneMap API | Free, Singapore-specific. See auth pattern below |
| Auth (MVP) | None | No user accounts in MVP. OneMap's API auth (machine-to-machine, for the ingestion script) is unrelated to user login — do not conflate these |

---

## Data Sources ✅

| Dataset | ID | Provides | Does NOT provide |
|---|---|---|---|
| HDB Property Information | `d_17f5382f26140b1fdae0ba2ef6239d2f` | `blk_no`, `street`, `max_floor_lvl`, `year_completed`, `residential` (Y/N), `commercial`, `market_hawker`, `multistorey_carpark`, `precinct_pavilion`, `bldg_contract_town`, `total_dwelling_units` | Coordinates |
| HDB Existing Building | `d_16b157c52ed637edd6ba1232e026258d` | ❌ **Inaccessible** — the data.gov.sg CKAN datastore API returns empty results for this resource (`resource_show` confirms the dataset exists but the datastore endpoint does not serve it). Intended to provide GeoJSON polygon centroids. | Storey/height data, any coordinates |
| OneMap Geocoder API | — | Primary geocoding source — resolves all addresses via Search API | No storey/height data |

**API access:** `GET https://data.gov.sg/api/action/datastore_search?resource_id={id}` — no auth required for basic read access. Confirmed working, 13.3K rows in Property Information dataset as of last check.

### OneMap API tiers ✅ (confirmed directly from OneMap's terms)

OneMap splits its APIs into two tiers — only the second one is relevant to this project:

| Tier | APIs | Auth | Rate limit | Used by Vertical? |
|---|---|---|---|---|
| No-auth tier | Basemaps, Mini Map, Advanced Mini Map, Static Map | None | None stated | **No** — MapLibre is the locked map-rendering choice; OneMap's basemap is not used |
| Token tier | Search, Coordinate Converters, **Reverse Geocode**, Themes, Routing, Planning Area, Population Query | Token required, renew every 3 days | **300 calls/min** | **Yes** — all geocoding in Phase 0 uses the Search API |

**Rate limit handling (Phase 0 ingestion script):** fire requests with a 250ms delay between calls (~240/min), well under the 300/min cap. With ~13.3K total blocks, the full run processes at this throttled rate in a few minutes. The HDB Existing Building polygon dataset (which would have eliminated the need for per-address geocoding) is inaccessible via the CKAN datastore API, so every residential block goes through OneMap Search.

**Token lifecycle:** tokens expire exactly 3 days (259,200s) after issuance — confirmed against a real OneMap JWT (`iat`/`exp` fields). Do not cache or persist tokens across runs; the ingestion script re-authenticates fresh on every execution (see Step 5 below). Never commit tokens or `.env` files to version control, and never paste live tokens into chat, docs, or issue trackers — treat any exposed token as compromised and regenerate it.

**Critical import filter:** only ingest rows where `residential = 'Y'`. The dataset includes commercial buildings, multistorey carparks, market/hawker buildings, and precinct pavilions as separate rows — these are not climbable residential blocks and will pollute height rankings if not excluded.

---

## Phase 0 — Data Ingestion Pipeline (build this first, standalone script, not part of the app)

This is a one-time/periodic script, not a backend service. Run locally, manually triggered — **no scheduler/cron infrastructure needed.** Output: populated Supabase `blocks` table.

**Re-run cadence ✅:** roughly once a year (HDB blocks don't get added often — new BTO completions are a handful of times annually at most, not worth daily/monthly polling). This means the script must be **idempotent / safe to re-run**, not a true one-off throwaway:
- Use `upsert` (insert-or-update on a unique key, e.g. `blk_no + street`) rather than plain `insert`, so re-running doesn't create duplicate rows for blocks that already exist.
- New rows in the source dataset since the last run (new BTOs) get inserted as new.
- Existing rows get updated in place if any field changed (e.g. `total_dwelling_units` corrections from HDB) — but `height_source` should only be touched if it's still `'estimated'`; never overwrite a `'verified'` block's data with a stale re-import once Phase 2 verification exists.
- No need to build a diffing/changelog system for v1 — a clean upsert on the natural key is sufficient at this cadence.

### Step 1: Pull & filter
- Pull all rows from HDB Property Information dataset.
- Filter `residential = 'Y'`.
- Compute `est_height_m = max_floor_lvl × 2.8`.

### Step 2: Address standardization (run before any geocoding/join attempt) ✅
Build a standardizer helper applied to every `blk_no` + `street` pair before matching:
- **Strip leading zeros**: `Blk 012` → `12`
- **Standardize suffix letters**: `1a` / `1 A` → `1A` (uppercase, no space)
- **Street abbreviation dictionary** (regex map), minimum coverage: `ST.` → `SAINT`, `BT` → `BUKIT`, `S'GOON` → `SERANGOON`, `JLN` → `JALAN`. Expand this list as join failures reveal more cases.

### Step 3: OneMap Geocoding (single pass) ✅
1.  **OneMap Search API** — send the standardized address (`blk_no + street`) to OneMap's elastic search endpoint. Rate-limited to ~240 calls/min to stay safely under the 300/min cap.

Note: The HDB Existing Building polygon dataset (`d_16b157c52ed637edd6ba1232e026258d`) was originally intended for a multi-pass join, but its data.gov.sg CKAN datastore endpoint returns empty results (resource_show confirms the dataset exists but the datastore API does not serve it). All geocoding now goes through OneMap as a single pass.

### Step 4: Handle unmatched records ✅
If the OneMap geocode returns no result:
- **Do not drop the record.** Insert it into `blocks` regardless — `max_floor_lvl`, `total_dwelling_units`, `year_completed` must be preserved even without coordinates.
- **Do not impute approximate coordinates** (e.g. street- or town-center fallback). A 40-storey block incorrectly placed at a town centroid can stack on top of an unrelated 4-storey block and corrupt any spatial query (nearby search, density maps).
- **Set `lat`/`lng` to NULL.**
- **Log it.** Write the unmatched record to a separate `unmatched_hdb_blocks` table or CSV for manual review later. This is expected to be a non-zero list — don't treat it as a bug to eliminate before shipping, treat it as an ongoing backlog.

### Step 5: OneMap auth pattern ✅
Keep this isolated to the ingestion script — it is unrelated to user-facing auth.
- Store the OneMap API token (or email/password) in a local `.env` file (never commit this).
- **Recommended:** set `ONEMAP_TOKEN` directly in `.env.local` — avoids storing credentials.
- **Alternative:** `ONEMAP_EMAIL` + `ONEMAP_PASSWORD` — the script POSTs to OneMap's auth endpoint on each run to fetch a temporary token (~3 day validity).
- Pass the token in headers for subsequent geocoding requests within that run.
- No token refresh/persistence logic needed — re-authenticate each time the script runs.

### Output: `blocks` table schema (Supabase / Postgres)

```sql
create table blocks (
  block_id uuid primary key default gen_random_uuid(),
  blk_no text not null,
  street text not null,
  town text,
  storeys int not null,
  est_height_m float not null,
  height_source text default 'estimated', -- 'estimated' | 'verified' (verified unused until Phase 2)
  year_completed int,
  total_dwelling_units int,
  lat float,  -- nullable, see Step 4
  lng float,  -- nullable, see Step 4
  geom geography(Point, 4326), -- PostGIS point, derived from lat/lng when present, null otherwise
  created_at timestamp default now(),
  updated_at timestamp default now(),
  unique (blk_no, street) -- natural key for upsert on annual re-run, see Re-run cadence above
);

create table unmatched_hdb_blocks (
  blk_no text,
  street text,
  max_floor_lvl int,
  year_completed int,
  total_dwelling_units int,
  reason text, -- why geocoding failed (e.g. "OneMap returned no result")
  logged_at timestamp default now()
);
```

Enable PostGIS extension in Supabase before creating `geom`. Index `geom` with a GiST index for nearby-search performance:
```sql
create index blocks_geom_idx on blocks using gist (geom);
```

---

## Phase 1 — MVP App (read-only browse)

**Scope: browse a map of HDB blocks, filter by storeys, search/star blocks, log climbs, see water coolers, report amenities. No accounts, no photo submissions, no routing logic — deep link out for directions.**

### Screens
1. **Map view** (default screen)
   - MapLibre map centered on user's current location (request location permission on launch, falls back to Singapore centre).
   - Blocks within visible map bounds are pulled from Supabase via the `blocks_in_bounds` RPC (200-row limit per request).
   - **Individual circle layer markers** (no clustering) — pins are coloured circles by storey count tier (blue 1-10, orange 11-20, red 21-30, dark red 31-39, purple 40+). Pin size scales with zoom level (4px at zoom &lt;12 up to 14px at zoom 15+).
   - Climbed blocks render with a gold stroke (`#F59E0B`, 3px) around the pin.
   - Map bounds restricted to Singapore via `maxBounds` — user cannot pan outside the island (`[103.5, 1.15, 104.1, 1.5]`). Min zoom 10.
   - Day/night auto-switching based on local time (7pm-6am = dark mode). Switches between `map-style.json` (light) and `map-style-dark.json`. Dark style UI needs visual fixes.
   - Tap pin → floating glass card (see below).
   - Tap water cooler marker → floating info card with name and status.

2. **Water cooler markers** (individual `<Marker>` components via MapLibre)
   - 131 water cooler locations from a bundled `water-coolers.json` file.
   - Each marker renders an Ionicons `water-outline` icon inside a white circle with elevation shadow.
   - Status color: verified = cyan (`#06B6D4`), unverified = pink (`#EC4899`), ticketed = amber (`#F59E0B`).
   - Uses `@expo/vector-icons/Ionicons` — no custom marker images needed.
   - Zoom-gated: 25 rendered at zoom < 13, all 80 at zoom >= 13.
   - Sorted by distance from map center, showing nearest markers first.

3. **Floating glass card** (replaces bottom sheet)
   - Translucent card (`rgba(255,255,255,0.92)`) with rounded corners and shadow, positioned near the tapped pin.
   - Shows: storey count (large number colored by tier + "floors" label), address (`Blk X {street}`), town, estimated height in metres, distance from user (km or m), directions arrow (deep-link to Google Maps).
   - Quantity selector (`-`/`+`, range 1+) for climb count.
   - **Log Climb** button (green) — logs `climbQty` climbs to local storage, increments the block's climb counter, refreshes climb history.
   - Tapping backdrop dismisses the card.

4. **Search screen** (full-height modal, 85% of screen, drag handle to dismiss)
   - Debounced address search (300ms delay) against Supabase `blocks` via `ilike` on `blk_no` and `street`, ordered by `storeys DESC`, 20-result limit.
   - Filter chips: 40+ / 31+ / 21+ / All — client-side filter on search results.
   - Three sections when idle (no search query):
     - **Starred** — blocks the user has saved (star icon toggles filled/unfilled, persisted in local storage).
     - **Recent** — last 10 viewed blocks, shows 3 with "See more (N more)" expandable link.
     - **My Climbs** — climb history with aggregate stats ("N climbs  N floors  ~Nm"), last 5 climb rows showing address, relative time, and floor count (tappable to navigate to block).
   - Tapping a row selects the block, closes search, flies camera to its location.

5. **Filter controls**
   - Single cycling filter toggle at top-left: tap cycles 21+ (red) → 31+ (dark red) → 40+ (purple) → All (gray).
   - Applied client-side to the map's GeoJSON source — only blocks at or above the threshold are rendered.
   - **Height legend** at top-right shows all 5 tier colors with labels.

6. **Report modal** (centered icon grid)
   - Triggered by an amber `+` button in the Map tab.
   - 3 amenity categories: Water Cooler, Toilet, Food/Shop — each with an Ionicons icon and category color.
   - Selecting a category enters the placement flow: crosshair overlay → pan to position → confirm location → optional description → submit.
   - Reports save to AsyncStorage as `{type, lat, lng, timestamp, status: 'pending'}` and appear immediately as unverified gray markers.

7. **Bottom bar** (persistent, translucent glass effect)
   - Search input (tappable, opens SearchScreen)
   - Alert/report button (amber `+` icon)
   - My Location button (blue `locate` icon, re-centers map on GPS position)

### Example queries (Supabase RPC or direct query)
```sql
-- Nearby + tallest first
select *, ST_Distance(geom, ST_MakePoint(:lng, :lat)::geography) as distance_m
from blocks
where geom is not null
  and ST_DWithin(geom, ST_MakePoint(:lng, :lat)::geography, :radius_m)
order by storeys desc
limit 50;
```

### Explicitly out of scope for Phase 1
- User accounts / login
- Condition reports with photos (current reporting is text-only, local-only)
- Server-synced climb history (currently in-memory only)
- In-app routing/pathfinding (always deep link out)
- Push notifications

### Definition of done for Phase 1 (✅ Shipped)
A person can open the app, see HDB block pins colored by height, filter by minimum storeys, tap to see details and log climbs, search by address, star blocks, view My Climbs history, see water coolers, and report amenities.

---

## Phase 1.5 — Current Enhancements (post-MVP, shipped)

Features added after the initial Phase 1 MVP shipped, during ongoing development:

1. **Interactive amenity placement flow**
   - Tap the amber `+` button in the bottom bar to open a category picker (Water Cooler, Toilet, Food/Shop).
   - Selecting a category enters placement mode: a crosshair overlay appears at map center, with Confirm Location / Cancel buttons.
   - On confirm, a description modal opens (optional text input, "Skip" or "Submit").
   - Submitted amenities save to AsyncStorage and appear immediately as pending/unverified markers.

2. **Animated splash screen**
   - `AnimatedSplash.tsx` — 5 vertical bars rise sequentially, colored by the height tiers (blue, orange, red, dark red, purple).
   - The "Vertical" title and "Find your next climb" subtitle fade in.
   - Uses `Animated` with `useNativeDriver: true` for 60fps performance.

3. **AsyncStorage persistence**
   - `storage.ts` switched from in-memory to `@react-native-async-storage/async-storage`.
   - Climb history, starred blocks, and pending reports all survive app restarts.

4. **Toilet + food/shop markers**
   - 120 bundled amenity locations (61 toilets, 59 food/shops) from `amenities.json`.
   - Rendered as individual `<Marker>` components with Ionicons: toilets use `male-female-outline` (purple), food/shops use `cafe-outline` (amber).
   - Zoom-gated: 15 rendered at zoom < 13, 60 at zoom >= 13.
   - Sorted by distance from map center, showing nearest markers first.

5. **Performance: fixed pin sizes & bounds caching**
   - Block pins use a constant 5px `circle-radius` (no zoom scaling) for smooth rendering.
   - Bounds-fetch debounce (600ms) with a 300m movement threshold avoids redundant API calls.

6. **Pending/unverified marker system**
   - User-submitted amenities render as gray dashed-border markers with semi-transparent background.
   - Tappable to view type, description, and get directions.
   - Only rendered at zoom >= 13.

---

## Phase 2 — Social & Community Layer (next, after Phase 1.5 ships)

❓ Not yet built — scoped from user vision. Requires Supabase Auth, new tables, and significant UI work.

**Required foundation: user accounts (Supabase Auth)**
- Anonymous accounts on first launch, upgradeable to email/OAuth.
- All Phase 2 features depend on identity: verification, social, leaderboard, photos.

**Features:**

1. **Community height verification**
   - Users submit storey-count corrections (simple number input, no photo required — storey count is countable by eye, low friction matters more than proof).
   - Require 3+ corroborating submissions before promoting a block from `height_source = 'estimated'` to `'verified'`.
   - The displayed value only changes after the 3-report threshold is met.
   - Known UX pitfall: HDB floor numbering often skips superstition numbers (4, 13, 14, 24), so lift-panel top label != true storey count. Submission UI should instruct "count physical floors, not the lift panel number."

2. **Bottom navigation tabs** (replacing the floating search bar)
   - Tabs: Social / My Climbs / Map / Profile
   - Map tab remains the default and main screen.
   - Each tab is a separate stack navigator.

3. **Social feed**
   - Scrollable feed of recent activity: "user123 climbed 88 floors at Blk 123 {street} 10 hours ago"
   - Comments on buildings — any user can comment on any block's wall.
   - Share climbs — post a climb to the feed with optional note.

4. **Building detail expansion**
   - Tapping a pin opens an enhanced detail view (not just the floating glass card):
     - Photos submitted by users (gallery view)
     - Comments / discussion thread
     - Climb history for that block (who climbed it, how many times)
     - Aggregate stats (total climbs this week/month/all-time)

5. **Leaderboard**
   - Most climbs (count)
   - Most floors (sum of storeys x climbs)
   - Time-window filters: today, this week, this month, all-time
   - Rolling feed of recent climbs at the top

6. **In-app routing**
   - Walking directions to blocks without relying on Google Maps.
   - OSRM or similar free routing engine (self-hosted or API).
   - Shows estimated walk time and path on the map.

7. **Photo submissions**
   - Users attach photos to climbs and building reports.
   - Stored in Supabase Storage (already part of the stack).

8. **Moderation (Phase 2)**
   - Start with simple threshold logic (3 agreeing reports = verified).
   - Not a scoring algorithm — add weighting later if abuse patterns actually emerge.

9. **Offline queueing**
   - Stairwells are often cellular dead zones.
   - Submissions made with no signal should queue locally and sync when back in range.
   - Local-first write + background sync pattern.

## Phase 3 — Gamification & Advanced Moderation (later, unscoped)

❓ Not yet scoped — ideas from user vision for future exploration:

1. **Climb logging gamification**
   - Badges (e.g. "Century Club" for 100 climbs, "Tall Towers" for 10 different 40+ blocks)
   - Streaks (consecutive days with at least one logged climb)
   - Challenges (community or self-set goals: "climb 500 floors this month")

2. **Amenity verification**
   - Community confirms amenity reports (similar to the height verification flow).
   - Pending markers graduate to verified after threshold is met.

3. **Advanced moderation**
   - Trust-weighted scoring replacing the simple 3-report threshold.
   - Users with a history of accurate reports get higher weight.
   - Low-trust users' reports require more corroboration.

4. **"Publicly accessible staircase" verification** (legal/safety)
   - Flagged as the highest-liability data point in the whole product.
   - Risk of routing someone into a badge-access or fire-alarmed door.
   - Needs explicit legal/safety thinking before building, not just a UI toggle.

---

## Tech Decisions Log (decisions made during development)

| Decision | Choice | Rationale / Context |
|---|---|---|
| Map rendering | OpenFreeMap (Liberty schema) tiles, NOT Mapbox | No API key required. Uses `https://tiles.openfreemap.org` — both light and dark styles. |
| Map style | Local JSON files (`map-style.json`, `map-style-dark.json`) | Bundled in `assets/`. Sprite and glyph URLs reference OpenFreeMap CDN. |
| Sprite source | OpenFreeMap CDN sprite (`https://tiles.openfreemap.org/sprites/ofm_f384/ofm`) | Referenced in both light and dark style JSONs. No local sprite sheet. |
| SVG assets | None shipped | The project does not ship any custom SVG files. All icons use `@expo/vector-icons/Ionicons`. |
| Marker icons | Ionicons from `@expo/vector-icons` | Used for water coolers (`water-outline`), amenities (`male-female-outline`, `cafe-outline`), and UI elements. |
| Water cooler data | Bundled `water-coolers.json` (~131 locations) | Static file, not fetched from API. |
| Amenity data | Bundled `amenities.json` (120 locations: 61 toilets, 59 food/shops) | Static file added after initial MVP. |
| Persistent storage | `@react-native-async-storage/async-storage` | Replaced in-memory storage. Used for climb history, starred blocks, pending amenity reports. |
| Performance: pin sizes | Fixed 5px `circle-radius` (no zoom scaling) | Simplified rendering, avoids re-paints on zoom changes. |
| Performance: bounds caching | 600ms debounce + 300m movement threshold | Avoids redundant `blocks_in_bounds` RPC calls during pan/zoom. |
| Performance: amenity rendering | Conditional rendering at zoom >= 13 | Water coolers, amenities, and pending markers only render when zoomed in enough to be useful. |
| Day/night switching | Local time check (7pm-6am = dark), 60s interval | Switches between `map-style.json` and `map-style-dark.json`. No API call needed. |
| App name | "Vertical" (formerly StairTrain) | Changed during development. `expo.name` in `app.json` is "Vertical". |
| Tab navigation | Custom touchable-based tabs (no react-navigation) | Avoids native module linking, works instantly with no Expo dev-build dependency |
| Marker components for amenities | Ionicons on MapLibre `<Marker>` components | Tradeoff: minor visual jitter during map interaction for proper icon rendering (no native SymbolLayer limitations) |
| Zoom-gated rendering | State-based visibility thresholds (zoom < 13 vs >= 13) | Reduces clutter at low zoom levels: 25 water + 15 non-water at zoom<13, 80 water + 60 non-water at zoom>=13 |
| Distance-sorted markers | Nearest N markers shown based on map center | Sorted by Haversine distance from camera center, ensuring nearby amenities are always prioritized |
