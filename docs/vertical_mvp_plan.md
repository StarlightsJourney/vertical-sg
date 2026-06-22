# Vertical — MVP Build Plan

**Purpose of this doc:** handoff spec for an AI coding agent (DeepSeek) to implement. Each phase is scoped to be buildable independently. Locked decisions are marked ✅ — do not re-litigate these. Open questions for future phases are marked ❓.

**Product summary:** Mobile app (iOS + Android) that maps Singapore HDB (public housing) blocks, showing building height/storey count, so people can find tall blocks nearby to train stair-climbing on. MVP is read-only browsing. Crowdsourced condition reports (ventilation, dust, photos) and routing are explicitly out of scope for MVP.

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

**Scope: browse a map of HDB blocks, see height, filter by tallest/nearest. No accounts, no submissions, no routing logic — deep link out for directions.**

### Screens
1. **Map view** (default screen)
   - MapLibre map centered on user's current location (request location permission on launch).
   - Blocks within visible map bounds are pulled from Supabase via the `blocks_in_bounds` RPC.
   - **Individual markers** (no clustering) — pins are coloured circles, sized by storey count tier (blue 1-10, orange 11-20, red 21-30, dark red 31+).
   - Map bounds are restricted to Singapore — user cannot pan outside the island.
   - Tap pin → bottom sheet/modal with block detail.
2. **Block detail (modal/sheet)**
   - Address (`blk_no` + `street`), town, storey count, estimated height in metres, "estimated" badge (height_source field — always "estimated" in MVP since verification is Phase 2).
   - Button: "Directions" → deep link to Google Maps using block's lat/lng. If lat/lng is NULL (unmatched block), hide this button or show "Location unavailable."
3. **Filter / sort controls**
   - Toggle or sort: "Tallest" vs "Nearest."
   - "Tallest": query blocks within the visible map bounds, order by `storeys DESC` (or tallest-first if distance is not available).
   - "Nearest": query blocks within a radius (adjustable: 1km / 3km / 5km), order by distance ascending.
   - Use PostGIS `blocks_in_bounds` RPC (for pan/zoom) and `nearby_blocks` RPC (for radius-based sort).
   - **Height legend** displayed on the map showing the colour tier mapping.
   - **My Location button** re-centres the camera on the user's current position.
4. **21+ filter toggle** — optional filter to show only blocks with 21+ storeys (hides shorter blocks).

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
- Condition reports (ventilation, dust, photos)
- Amenity layer (water points, nearby floors/seating)
- Climb session logging
- In-app routing/pathfinding (always deep link out)
- Push notifications

### Definition of done for Phase 1
A person can open the app, see their location, see HDB block pins around them sized/colored by height, tap one to see exact storey count and estimated height, and tap "Directions" to open Google Maps to walk there. That's it — ship at that point.

---

## Phase 2 — Crowdsourced Layer (next, after Phase 1 ships)

❓ Not yet fully scoped — revisit once Phase 1 has real usage data. Known requirements from earlier discussion, for context only:

- **User accounts**: needed starting this phase (Supabase Auth — already part of the stack, no new service).
- **Height verification flow**: users submit storey-count corrections (simple number input, no photo required — storey count is countable by eye, low friction matters more than proof). Require 3+ corroborating submissions before promoting a block from `height_source = 'estimated'` to `'verified'`. No single submission overwrites the displayed value.
- **Condition reports** (ventilation, dust): rating + optional photo. Photo encouraged (not required) since "dusty" is subjective and a photo resolves disputes better than a number alone.
- **Known UX pitfall to design around**: HDB floor numbering often skips superstition numbers (4, 13, 14, 24), so lift-panel top label ≠ true storey count. Submission UI should instruct "count physical floors, not the lift panel number."
- **Moderation**: start with simple threshold logic (3 agreeing reports = verified), not a scoring algorithm — add weighting later if abuse patterns actually emerge, don't pre-build for hypothetical abuse.
- **Offline queueing**: stairwells are often cellular dead zones. Submissions made with no signal should queue locally and sync when back in range, not fail silently. Local-first write + background sync pattern.

## Phase 3 — Engagement / Scale (later, unscoped)

❓ Ideas raised in earlier discussion, not yet spec'd:
- Climb session logging (Strava-style: flights climbed, duration, history)
- Amenity layer (water points, seating) — fully crowdsourced, no government data source exists for this
- Trust-weighted moderation (replacing the simple 3-report threshold)
- "Publicly accessible staircase" verification — flagged earlier as the highest-liability data point in the whole product (risk of routing someone into a badge-access or fire-alarmed door). Needs explicit legal/safety thinking before building, not just a UI toggle.

---

## Open Questions Log (unresolved, revisit before relevant phase starts)

- Exact radius defaults for "nearby" search (5km was used as an example above, not a confirmed product decision).
- Whether `bldg_contract_town` from the source data is sufficient for a "browse by town" feature, or whether a separate towns/regions table is needed.
- ~~Pin clustering strategy at low zoom levels (13K+ blocks will need clustering — MapLibre supports this natively, but cluster radius/behavior isn't decided).~~ ✅ **Resolved** — removed clustering in favor of individual markers. Pins are fetched per-bounds via `blocks_in_bounds` RPC with a 500/1000-row cap, so only visible blocks render at any zoom level.
- Legal review of the "publicly accessible staircase" framing before Phase 3 — flagged, not resolved.
