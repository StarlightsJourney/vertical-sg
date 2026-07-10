# Vertical — MVP Build Plan

**Purpose of this doc:** handoff spec for an AI coding agent (DeepSeek) to implement. Each phase is scoped to be buildable independently. Locked decisions are marked ✅ — do not re-litigate these. Open questions for future phases are marked ❓.

**Product summary:** Mobile app (iOS + Android) that maps Singapore HDB (public housing) blocks, showing building height/storey count, so people can find tall blocks nearby to train stair-climbing on. MVP is read-only browsing. Crowdsourced condition reports (ventilation, dust, photos) and routing are explicitly out of scope for MVP.

**Current State (as of 2026-07-10):** Phases 1, 1.5, 2a (auth, badge/verification system, building photos, notifications), 2b (social feed, leaderboard, public profiles, kudos/comments), and most of what was informally tracked as "2c" are shipped. Beyond the original MVP scope, the app now has: a Groups tab (challenges — official and user-created, public or peers-only, with per-challenge leaderboards and custom medal badges; official app-run clubs with weekly organizer-only channels; events with real venue photos); a shared, community-verified amenity-reporting system (Supabase-backed, 3-confirmation verification, comments, anti-spam caps) covering both user-submitted reports and the originally-static water-cooler dataset; a redesigned Profile dashboard; and a browser-preview build (`expo start --web`) for the non-native-dependent screens. Auth is anonymous-first (`signInAnonymously`, upgradeable), not "none" as originally locked below — see the Locked Tech Stack table for the MVP-era decision this superseded. Not yet built: avatar-frame challenge rewards, in-club threaded replies, and true live scraping for event/training listings (currently curated + researched, refreshed manually).

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

## Phase 2a — Auth, Verification & Photos (next build target)

**North star:** Data quality — move blocks from `height_source = 'estimated'` to `'verified'` through community corroboration. Every feature in 2a either serves this goal or lays required foundation for 2b.

**Duration target:** ~3-4 weeks of solo dev time. Ships before Phase 2b.

### Decision Register (locked — do not re-litigate)

These were resolved through a structured UI/UX design session on 2026-06-24:

| # | Decision | Choice |
|---|---|---|
| 1 | Auth surface | Google + Apple Sign-In (no email/password) |
| 2 | Auth SDK path | Supabase `linkIdentity` (BETA — see risks below) |
| 3 | Climb migration on first sign-in | Silent sync with "Syncing your climbs..." spinner |
| 4 | Climb storage model | Supabase primary, AsyncStorage fallback, background sync |
| 5 | North star metric | Data quality — # of blocks promoted from estimated → verified |
| 6 | Routing | Keep Google Maps deep link (Mapbox Directions free tier as future escape hatch) |
| 7 | Auth prompt timing | Contextual only — map is always open to unauthenticated users |
| 8 | Verification input | Meters (elevation gain) + watch photo (live or pick from library) |
| 9 | Verification entry point | Separate "Verify Height" button on the floating pin card |
| 10 | Corroboration threshold | 3 independent verifiers to promote block to verified |
| 11 | Duplicate verification | One submission per user per building, removable by the submitter |
| 12 | Sanity check | Auto-reject submissions deviating >20% from HDB dataset value |
| 13 | Pending visual indicator (map) | Dashed ring on the pin border (composes with climbed gold stroke) |
| 14 | Verified visual indicator (map) | None — pin unchanged. Verified status shown on detail card only |
| 15 | Building detail navigation | Two-step: floating card (read-only info) → "View details" → detail sheet (actions) |
| 16 | Detail sheet content | Photo gallery + verification section + recent climbs at this block |
| 17 | Photo gallery model | One gallery per building, photos tagged by type (Condition / Verification / General) |
| 18 | Photo upload entry | Action sheet: Take Photo / Choose from Library / Cancel |
| 19 | Photo moderation | Post-moderation — everyone sees everything immediately, report-based takedown |
| 20 | Photo report flow | Long-press photo → "Report" → reason picker → 3 reports auto-hides |
| 21 | Camera permission | Request at moment of "Take Photo"; if denied, inline message with Settings deep link |
| 22 | Image resize before upload | `@bam.tech/react-native-image-resizer` — 1200px max, JPEG 80 quality |
| 23 | Verified height display | Updates to first verifier's submitted value on the detail card with green "Verified ✓" badge |
| 24 | Pending detail card state | Shows HDB estimate + progress bar ("2 of 3 verifications") + short verifier names |
| 25 | Verified → Dispute transition | "Verify Height" button becomes "Dispute" when verified |
| 26 | Dispute model | Parallel track — original verifiers keep badges, 3 dispute corroborations to change value |
| 27 | Tab bar (Phase 2a) | 3 tabs: Social / Map / Profile (My Climbs merges into Profile) |
| 28 | Swipe navigation | Edge swipe for tab switching + dead zones near edges. Map is center anchor (carousel model) |
| 29 | "Social" tab (2a placeholder) | Name stays. Personal stats at top + "Coming soon" teaser banner for Phase 2b features |
| 30 | "Profile" tab content | Single scrollable page: display name (editable), profile photo, stats card, badges, full climb history, sign out |
| 31 | Display names | Random pseudonym on sign-up (e.g. "Climber4721"), editable in Profile |
| 32 | Notification system | In-app bell icon with red dot on Map + Profile tabs, notifications list |
| 33 | Badges shipped in 2a | Climb badges (First Climb, 10/50 Climbs, Tall Tower, Century, 5-day Streak) + Verification badges (1/5/10 Verified) + Location badges (5 blocks in a town, 10 different towns) |
| 34 | Empty states | Placeholder visual + descriptive text for every empty surface (photo gallery, badges, verifications, notifications) |
| 35 | Auth edge case: linkIdentity conflict | Sign user into the existing account. Orphaned climbs stay on device behind the old anonymous ID |
| 36 | Auth edge case: migration failure | Retry button shown. Partial sync preserved |
| 37 | Auth edge case: session expiry | Only interrupts authenticated features — map browsing unaffected |
| 38 | Pending sync indicator | Subtle cloud icon on unsynced climb rows in history |
| 39 | Moderation: new-user probation | None for Phase 2a — true post-moderation for all users |

### linkIdentity Risks & Mitigations ✅

`linkIdentity` is Supabase's BETA API for attaching a Google/Apple identity to an existing anonymous account. Without it, signing in with Google creates a *new* user — anonymous climbs are stranded on the old ID.

**Known bugs (as of June 2026):**

| Bug | Impact | Mitigation |
|---|---|---|
| Ghost passwords (Discussion #37737) | OAuth-upgraded user can't set a password later | Not relevant — no email/password auth in 2a |
| Missing OAuth metadata (auth#1708) | `avatar_url` / `full_name` from Google not populated until next full sign-out/sign-in | After linkIdentity, call `signOut()` + `signInWithIdToken()` to force metadata refresh |
| Hermes crypto hang | `linkIdentity` silently hangs on React Native Hermes because `crypto.subtle` is not polyfilled | Install `expo-crypto-as-shim` in the entry file before supabase import |
| `is_anonymous` JWT claim may not flip | Token still says `is_anonymous: true` after upgrade until next token refresh | Call `supabase.auth.refreshSession()` after successful linkIdentity, and avoid RLS policies that gate on `is_anonymous` |

**Dashboard setup required:**
- Toggle **Manual Linking** ON: Supabase Dashboard → Authentication → Settings → Manual Linking
- Enable **"Allow users without email"** for Apple Sign-In provider
- Configure Google OAuth credentials (web client ID + iOS client ID)
- Configure Apple Sign-In credentials (App ID with capability enabled, .p8 key for web fallback)

**Auth flow:**
1. Anonymous sign-in on first launch → `signInAnonymously()`
2. User browses map freely. Auth prompt appears only when they tap an authenticated action (Log Climb, Verify Height, Add Photo, Social tab, Profile tab)
3. On upgrade: `linkIdentity({ provider: 'google' | 'apple', token: idToken })`
4. On success: metadata refresh → session refresh → silent climb migration
5. On conflict (identity already linked to another account): sign into existing account, orphaned climbs stay device-local

---

### Feature Specifications

#### 1. Supabase Auth Integration

**Providers:** Google Sign-In (native SDK via `@react-native-google-signin/google-signin`) + Apple Sign-In (native SDK via `expo-apple-authentication`).

**Session persistence:** AsyncStorage via `@react-native-async-storage/async-storage`. Supabase client config:
```javascript
createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,   // REQUIRED on React Native
  }
});
```
- Gate `startAutoRefresh()` with `NetInfo` — starting auto-refresh while offline wipes valid sessions.
- Use PKCE flow with `skipBrowserRedirect: true` for any OAuth fallback paths.
- Polyfill `crypto.subtle` via `expo-crypto-as-shim` before supabase import (Hermes compatibility).
- Import `react-native-url-polyfill` as the **very first import** in the entry file.

**Auth prompt surfaces:** Contextual only. "Sign in" prompt appears when user taps:
- "Log Climb" on the floating card
- "Verify Height" on the detail sheet
- "Add Photo" in the detail sheet
- The Social tab (shows "Sign in to see social features")
- The Profile tab (shows "Sign in to see your profile")

Tapping any of these opens a bottom sheet with Google + Apple sign-in buttons. After auth completes, the original action proceeds.

**Apple Sign-In compliance:** Required by App Store Review Guideline 4.8 because Google Sign-In is offered. Must use native `ASWebAuthenticationSession` (not `WKWebView`). Apple only returns full name on first sign-in — capture immediately.

#### 2. Silent Climb Migration

On first successful auth, all local climbs from AsyncStorage are migrated to Supabase:
1. Show "Syncing your climbs..." spinner (1-2 seconds)
2. Insert all local climbs into `climbs` table with the authenticated user's ID
3. On success: checkmark "Done" → profile shows merged history
4. On failure: partial sync preserved, "Retry" button shown
5. After migration, AsyncStorage climb cache is cleared

New climbs post-auth go Supabase-first with AsyncStorage fallback (see Offline Queueing).

#### 3. Building Detail Navigation

**Floating glass card** (existing, read-only): storey count, address, town, estimated height, distance, directions arrow, "Log Climb" button, **"Verify Height" button** (new).

**"View Details" button** (new) at bottom of card → opens detail sheet (85% screen height, drag handle).

**Detail sheet** sections:
- **Photo gallery** (top): horizontal scrollable carousel. Photos tagged: Condition / Verification / General. Placeholder image + "No photos yet — be the first to add one" when empty. "Add Photo" button.
- **Verification** (middle): height display with state-dependent UI (see Verification UX below). "Verify Height" or "Dispute" button.
- **Recent climbs** (bottom): last 10 climbs at this block, showing climber name, floors, relative time.

#### 4. Height Verification UX

**Three card states on the detail sheet:**

| State | Height display | Progress | Button | Verifier list |
|---|---|---|---|---|
| **Estimated** (0 verifications) | "~112m (estimated)" | — | "Verify Height" | — |
| **Pending** (1-2 verifications) | "~112m (estimated)" | Progress bar + "2 of 3 verifications" | "Verify Height" | Short verifier names shown |
| **Verified** (3/3) | "112m ✓ Verified" (green badge) | — | **"Dispute"** | 3 verifier names with checkmark badge |

**Verification submission flow:**
1. Tap "Verify Height" → bottom sheet with meters input (number pad) + photo section
2. Photo: action sheet → "Take Photo" (camera permission at this moment) or "Choose from Library"
3. Watch photo required — the submitter must photograph their fitness watch showing elevation gain
4. Sanity check: submission must be within ±20% of HDB dataset value. Outside range → "This seems off — please check your watch reading" error
5. On submit → "Thanks for verifying!" toast → pin border becomes dashed immediately → detail sheet shows pending state with updated progress bar
6. One submission per user per building. Tapping "Verify Height" on a building you've already submitted shows your existing submission with a "Remove Submission" option

**Dispute flow:**
- When a block is verified, the "Verify Height" button becomes "Dispute"
- Tapping Dispute opens the same meters + photo flow
- Disputes run on a parallel track — the block stays verified at the current value
- Original verifiers keep their badges regardless of dispute outcome
- 3 corroborating disputes with the same value → verified height updates to the new value
- Dispute progress shown as "2 users have disputed (submitted 105m vs. verified 112m)"

**Map-level indicators:**
- Estimated: default pin (colored circle by height tier)
- Pending (1-2 verifications): **dashed ring** around the pin border. Composes with climbed gold stroke — a block can be both climbed (solid gold stroke) and pending (dashed ring)
- Verified (3/3): **no pin change**. Verified status is only visible on the detail card

**Verification data model:**
```sql
create table height_verifications (
  verification_id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(block_id),
  user_id uuid references auth.users(id),
  submitted_height_m float not null,
  watch_photo_url text, -- Supabase Storage URL, nullable if photo upload failed
  status text default 'active', -- 'active' | 'removed' | 'disputed'
  created_at timestamp default now(),
  unique (block_id, user_id) -- one submission per user per building
);

-- Disputes tracked separately so original verifiers aren't overwritten
create table height_disputes (
  dispute_id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(block_id),
  user_id uuid references auth.users(id),
  submitted_height_m float not null,
  watch_photo_url text,
  status text default 'active', -- 'active' | 'resolved' | 'removed'
  created_at timestamp default now(),
  unique (block_id, user_id)
);

-- View for verification progress
create view block_verification_status as
select
  b.block_id,
  b.storeys,
  b.est_height_m,
  b.height_source,
  count(hv.verification_id) as verification_count,
  case when count(hv.verification_id) >= 3 then 'verified'
       when count(hv.verification_id) > 0 then 'pending'
       else 'estimated'
  end as verification_state,
  count(hd.dispute_id) as dispute_count
from blocks b
left join height_verifications hv on hv.block_id = b.block_id and hv.status = 'active'
left join height_disputes hd on hd.block_id = b.block_id and hd.status = 'active'
group by b.block_id;
```

**Verifier credit & badges:**
- When a block reaches 3/3 verified, all 3 active verifiers get the block credited to their profile
- Badges: Verified 1 building / Verified 5 buildings / Verified 10 buildings
- Verified users get a checkmark badge (✓) next to their display name on verification lists
- Verifiers lose credit only if their submission is explicitly removed or a dispute replaces the verified value

#### 5. Photo Upload & Gallery

**Upload flow:**
1. "Add Photo" button in detail sheet → action sheet: "Take Photo" / "Choose from Library" / "Cancel"
2. After selecting/capturing → tag picker: Condition / Verification / General
3. Optional caption (text input, "Skip" allowed)
4. Image resized client-side: `@bam.tech/react-native-image-resizer` → 1200px max dimension, JPEG 80 quality (reduces 4-12MB camera photos to ~150-400KB)
5. Uploaded to Supabase Storage bucket `building-photos/`
6. Photo appears immediately in gallery for all users (post-moderation)

**Photo data model:**
```sql
create table building_photos (
  photo_id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(block_id),
  user_id uuid references auth.users(id),
  storage_path text not null,
  photo_type text not null, -- 'condition' | 'verification' | 'general'
  caption text,
  status text default 'active', -- 'active' | 'reported' | 'hidden'
  report_count int default 0,
  created_at timestamp default now()
);

-- RLS: anyone can read active photos, authenticated users can insert, users can report
```

**Moderation model:**
- Post-moderation: all photos visible immediately to all users
- Report flow: long-press photo → "Report" → reason picker (Inappropriate / Not this building / Spam / Other)
- 3 reports on a photo → auto-hidden (`status = 'hidden'`). Admin can review and restore or permanently remove
- No new-user probation for Phase 2a — all users get instant posting (revisit if abuse emerges)

**Photo storage:** Supabase Storage bucket `building-photos`. Storage path: `{block_id}/{photo_id}.jpg`. RLS policies: SELECT open to all, INSERT requires `auth.uid()`, DELETE restricted to photo owner or admin.

#### 6. Offline Climb Queueing

**Storage model:** Supabase-primary, AsyncStorage-fallback.

**Climb logging flow:**
1. User taps "Log Climb"
2. App attempts Supabase insert
3. On success: climb saved, appears in history
4. On network failure: climb saved to AsyncStorage queue, appears in history with **cloud-off icon** (pending sync indicator)
5. Background sync: when `NetInfo` detects connectivity, drain the AsyncStorage queue to Supabase, remove cloud icons
6. Migration on first auth also drains any pre-auth queued climbs

```sql
create table climbs (
  climb_id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  block_id uuid references blocks(block_id),
  climb_qty int not null default 1,
  floors_climbed int not null, -- storeys × climb_qty
  synced boolean default true, -- false if queued offline
  created_at timestamp default now()
);
```

#### 7. Profile Tab (Absorbs My Climbs)

**Tab bar becomes 3 tabs:** Social / Map / Profile (My Climbs removed, content merged into Profile).

**Swipe navigation:** Edge swipe between tabs. Left edge → Social, right edge → Profile. Center 80% of screen pans the map. Dead zones at edges prevent accidental tab switches during map panning. Carousel model — Map is the center anchor.

**Profile tab — single scrollable page:**
1. **Header:** Profile photo (from Google/Apple, or default avatar) + display name (tappable to edit) + email
2. **Stats card:** Total climbs / Total floors / Current streak / Tallest climb / Favorite building / Buildings verified
3. **Badges section:** Horizontal scrollable carousel. Earned badges in full color, locked badges greyed out with progress indicator. Placeholder badge icons + text when none earned.
4. **Climb history:** Full scrollable list (the old My Climbs content). Each row: address, floors climbed, relative timestamp, cloud-off icon if unsynced
5. **Sign out** button at bottom

**Display names:** Random pseudonym assigned on first sign-up (e.g. "Climber4721"). Editable in Profile. Displayed on verifications, climb feed, and leaderboard. Never show real names or email publicly.

#### 8. Social Tab (Phase 2a Placeholder)

The tab name stays "Social" for consistency. Content in Phase 2a is a placeholder that provides value while setting expectations:

1. **Personal weekly summary** (top): "You climbed X floors this week across Y blocks. You're on a Z-day streak."
2. **"Coming Soon" teaser** (middle): blurred/greyed-out feed preview mockup with text: "Connect with other climbers — launching soon. Verify buildings and log climbs to build your profile first."
3. **"Get Started" section** (bottom): quick actions — "Verify a building near you" (centers map on nearest unverified block), "Earn your first badge" (shows badge progress)

This keeps the tab non-empty and funnels users toward the verification flow (Phase 2a's north star).

#### 9. In-App Notification System

**Bell icon** with red dot on Map and Profile tabs when unread notifications exist.

**Notifications table:**
```sql
create table notifications (
  notification_id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  type text not null, -- 'verification_corroborated' | 'block_verified' | 'block_disputed' | 'photo_reported'
  block_id uuid references blocks(block_id),
  message text not null,
  read boolean default false,
  created_at timestamp default now()
);
```

**Triggered notifications:**
- Someone else verifies a building you verified → "Climber4721 also verified Blk 123. 2 of 3 needed."
- A building you verified reaches 3/3 → "Blk 123 is now verified! You earned credit."
- Someone disputes a building you verified → "Climber1234 disputed Blk 123's verified height."
- Your photo gets reported → "Your photo at Blk 123 was reported. (1 of 3 reports)" (shown only if 1-2 reports — hidden if 3/3 and auto-removed)

**Delivery:** App polls notifications on tab switch to Map or Profile. No push notifications in Phase 2a (that's Phase 3).

#### 10. Badge System

Shipped in Phase 2a to drive retention and incentivize verification (the north star).

**Badge categories:**

| Category | Badges |
|---|---|
| **Climb** | First Climb, 10 Climbs, 50 Climbs, Tall Tower (40+ storeys), Century (100 floors in a day), 5-Day Streak, 30-Day Streak |
| **Verification** | Verified 1 Building, Verified 5 Buildings, Verified 10 Buildings |
| **Location** | Town Explorer (5 blocks in one town), Town Collector (10 different towns) |

**Badge display:** Earned badges in full color. Locked badges greyed out with progress ("3/5 buildings in Tampines"). Badges appear in Profile carousel. Newly earned badge triggers an in-app notification with a celebratory animation.

---

### Phase 2a Schema Summary (new tables)

```sql
-- Existing: blocks, unmatched_hdb_blocks (from Phase 0)

-- New tables for Phase 2a:
-- climbs (see Offline Climb Queueing above)
-- height_verifications (see Height Verification above)
-- height_disputes (see Height Verification above)
-- building_photos (see Photo Upload above)
-- notifications (see Notification System above)
-- user_badges (badge assignments)
-- block_verification_status (view — see above)

create table user_badges (
  user_id uuid references auth.users(id),
  badge_key text not null, -- 'first_climb' | 'verified_1' | 'town_explorer_tampines' | etc.
  earned_at timestamp default now(),
  primary key (user_id, badge_key)
);
```

### Phase 2a Scope Boundaries

**In scope:** Auth (Google + Apple), silent climb migration, two-step building detail, height verification with watch photos, photo gallery with post-moderation, 3-tab bar with swipe, Profile absorbing My Climbs, Social placeholder with personal stats, in-app notifications, badge system, offline climb queueing.

**Explicitly out of scope for 2a:** Social feed, friend graph, kudos, comments, share climbs, leaderboards, push notifications, amenity verification, in-app routing (keep Google Maps deep link), advanced moderation (trust weighting), streak challenges. These move to Phase 2b or Phase 3.

---

## Phase 2b — Social & Community (after 2a ships)

**Prerequisite:** Phase 2a must be shipped and stable. Social features need a foundation of authenticated users with climb history, verified buildings, and photos — launching social into an empty app is the primary failure mode.

**Duration target:** ~3-4 weeks.

1. **Friend graph**
   - Follow/unfollow other users. Feed populated from followed users' activity.
   - Friend discovery: "Who verified the same building as you" and "Who climbed in your town this week."

2. **Social feed**
   - Scrollable feed: "Climber4721 climbed 88 floors at Blk 123 Tampines — 10 hours ago"
   - Share climbs to feed with optional note
   - Kudos (one-tap approval, lower friction than comments)

3. **Comments on buildings**
   - Any authenticated user can comment on any block's wall
   - Moderation: flag threshold auto-hide (3 flags), new-user probation (first 3 comments held for review)

4. **Leaderboards**
   - Most climbs, most floors, most verifications
   - Weekly/monthly resets (prevents power-user ossification)
   - Tiered: Casual (0-50 floors/week), Regular (50-200), Hardcore (200+)
   - Users only see their tier by default

5. **Share climbs**
   - Post a climb to the feed with optional note and photo
   - Activity feed shows friend activity

---

## Phase 3 — Gamification & Advanced Moderation (later, unscoped)

❓ Not yet scoped — deferred until Phase 2b is complete and user base justifies investment.

1. **Climb challenges** — community or self-set goals: "climb 500 floors this month"
2. **Streaks with rewards** — consecutive day bonuses, streak freezes
3. **Amenity verification** — community confirms amenity reports, pending markers graduate to verified
4. **Advanced moderation** — trust-weighted scoring replacing the simple 3-report threshold
5. **Push notifications** — for verification progress, friend activity, challenges
6. **"Publicly accessible staircase" verification** — legal/safety review required before building

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
| Auth provider | Supabase Auth (Google + Apple Sign-In) | Native SDKs (`@react-native-google-signin/google-signin` + `expo-apple-authentication`). No email/password auth. `linkIdentity` for anonymous upgrade (BETA — see Phase 2a risk table) |
| Climb storage | Supabase-primary, AsyncStorage-fallback | Two-layer storage: tries Supabase insert first, falls back to AsyncStorage queue when offline. Background sync when connectivity returns via NetInfo |
| Image resizing | `@bam.tech/react-native-image-resizer` | 1200px max, JPEG 80 quality. Reduces 4-12MB camera photos to ~150-400KB before Supabase Storage upload |
| Photo moderation | Post-moderation, report-based takedown | 3 reports auto-hides a photo. No pre-moderation or new-user probation in Phase 2a |
| Tab navigation (Phase 2a) | 3-tab custom touchable bar + edge swipe | Social / Map / Profile. My Climbs merged into Profile. Edge swipe + dead zones for tab switching, carousel model with Map as center anchor |
| Height verification | 3-corroboration threshold with watch photo | Users submit elevation gain in meters + fitness watch photo. ±20% sanity check vs HDB dataset. Disputes run on parallel track |
| Pending indicator | Dashed ring on pin border | Composes with climbed gold stroke. Verified status shown only on detail card (no pin change) |
| Routing | Google Maps deep link (keep from Phase 1) | Mapbox Directions API free tier (100K req/month) as future escape hatch. Self-hosted OSRM rejected — pedestrian routing worse than Google for HDB void decks |
| Display names | Random pseudonyms | Assigned on sign-up (e.g. "Climber4721"), editable in Profile. No real names shown publicly |
| Empty states | Placeholder visual + descriptive text | Consistent pattern across photo galleries, badges, verifications, and notifications |
