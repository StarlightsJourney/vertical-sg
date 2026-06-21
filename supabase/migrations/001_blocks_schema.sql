-- =============================================================================
-- Migration 001: Blocks Schema for StairTrain
-- Singapore HDB blocks mapping app — stores residential block data with
-- PostGIS geography for spatial queries (nearby search by height/distance).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enable PostGIS extension
-- ---------------------------------------------------------------------------
create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- 2. Create blocks table
--
-- Stores HDB residential block data with coordinates and a PostGIS geography
-- column derived from lat/lng. The unique (blk_no, street) constraint serves
-- as the natural key for idempotent upserts during annual data re-imports.
-- ---------------------------------------------------------------------------
create table if not exists blocks (
  block_id            uuid primary key default gen_random_uuid(),
  blk_no              text not null,
  street              text not null,
  town                text,
  storeys             int not null,
  est_height_m        float not null,
  height_source       text default 'estimated',
  year_completed      int,
  total_dwelling_units int,
  lat                 float,       -- nullable — blocks that fail geocoding get null
  lng                 float,       -- nullable — blocks that fail geocoding get null
  geom                geography(Point, 4326),  -- derived from lat/lng via trigger
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),

  -- Natural key for idempotent upsert on annual re-runs (see re-run cadence spec)
  unique (blk_no, street)
);

-- Ensure height_source only accepts the two valid states
alter table blocks
  add constraint blocks_height_source_check
  check (height_source in ('estimated', 'verified'));

comment on table blocks is 'HDB residential blocks with location, height, and spatial geography for nearby-search queries';
comment on column blocks.block_id is 'Unique identifier, auto-generated UUID';
comment on column blocks.blk_no is 'Block number (e.g. "123")';
comment on column blocks.street is 'Street name (e.g. "Ang Mo Kio Ave 4")';
comment on column blocks.town is 'HDB town / planning area name';
comment on column blocks.storeys is 'Number of storeys (max floor level from source data)';
comment on column blocks.est_height_m is 'Estimated height in metres (storeys * 2.8)';
comment on column blocks.height_source is 'Source of height data: "estimated" (calculated from storeys) or "verified" (crowdsourced, Phase 2)';
comment on column blocks.year_completed is 'Year the block was completed / topped out';
comment on column blocks.total_dwelling_units is 'Total residential dwelling units in this block';
comment on column blocks.lat is 'Latitude (nullable — some blocks cannot be geocoded)';
comment on column blocks.lng is 'Longitude (nullable — some blocks cannot be geocoded)';
comment on column blocks.geom is 'PostGIS geography point derived from lat/lng; null when coordinates are missing';

-- Enable Row Level Security on blocks table.
-- The mobile app uses the Supabase anon key and only needs SELECT access.
-- The ingestion script uses the service_role key which bypasses RLS entirely.
alter table blocks enable row level security;

-- Allow public read access (anon + authenticated) — the app is read-only in MVP
create policy "Public read access"
  on blocks
  for select
  using (true);

-- ---------------------------------------------------------------------------
-- 3. Create unmatched_hdb_blocks table
--
-- Logs records from the HDB Property Information dataset that could not be
-- geocoded after all passes (postal-code match, strict match, fuzzy match).
-- These are written to blocks with NULL lat/lng AND logged here for manual
-- review, so no data is silently dropped.
-- ---------------------------------------------------------------------------
create table if not exists unmatched_hdb_blocks (
  blk_no              text,
  street              text,
  max_floor_lvl       int,
  year_completed      int,
  total_dwelling_units int,
  reason              text,        -- description of which pass failed / why
  logged_at           timestamptz default now()
);

comment on table unmatched_hdb_blocks is 'HDB records that failed all geocoding passes — logged for manual review';
comment on column unmatched_hdb_blocks.reason is 'Description of which geocoding pass failed and why';

-- Enable RLS on unmatched_hdb_blocks.
-- Only the service_role (ingestion script) should access this table.
-- Anon/authenticated users have no access.
alter table unmatched_hdb_blocks enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Trigger function: auto-populate geom from lat/lng
--
-- On INSERT or UPDATE, if both lat and lng are not null, set geom to a
-- PostGIS geography point (SRID 4326). If either is null, set geom to null.
-- This keeps the spatial column in sync with the raw coordinate columns
-- without requiring callers to manage it manually.
-- ---------------------------------------------------------------------------
create or replace function blocks_set_geom()
returns trigger
language plpgsql
as $$
begin
  if new.lat is not null and new.lng is not null then
    new.geom := st_setsrid(st_makepoint(new.lng, new.lat), 4326)::geography;
  else
    new.geom := null;
  end if;
  return new;
end;
$$;

comment on function blocks_set_geom() is 'Trigger function: derives blocks.geom from lat/lng on insert or update';

-- ---------------------------------------------------------------------------
-- 5. GiST index on blocks(geom)
--
-- Enables efficient spatial queries (ST_DWithin, ST_Distance) used by the
-- nearby_blocks RPC and direct SQL queries for the map view.
-- ---------------------------------------------------------------------------
create index if not exists blocks_geom_idx on blocks using gist (geom);

-- ---------------------------------------------------------------------------
-- 6. RPC function: nearby_blocks
--
-- Returns blocks within a given radius of a point, sorted either by storey
-- count (tallest first — "Tallest near me") or by distance (closest first —
-- "Nearest to me"). Only returns blocks with non-null geom.
--
-- Parameters:
--   lat       float  — Latitude of the query point
--   lng       float  — Longitude of the query point
--   radius_m  float  — Search radius in metres (default 5000)
--   sort_by   text   — Sort order: 'storeys' (default) or 'distance'
--
-- Returns:
--   All visible block columns plus computed distance_m.
-- ---------------------------------------------------------------------------
create or replace function nearby_blocks(
  lat      float,
  lng      float,
  radius_m float default 5000,
  sort_by  text  default 'storeys'
)
returns table (
  block_id            uuid,
  blk_no              text,
  street              text,
  town                text,
  storeys             int,
  est_height_m        float,
  height_source       text,
  year_completed      int,
  total_dwelling_units int,
  lat                 float,
  lng                 float,
  distance_m          float
)
language plpgsql
stable
as $$
declare
  query_point geography;
begin
  -- Build the query point as a geography
  query_point := st_setsrid(st_makepoint(lng, lat), 4326)::geography;

  return query
  select
    b.block_id,
    b.blk_no,
    b.street,
    b.town,
    b.storeys,
    b.est_height_m,
    b.height_source,
    b.year_completed,
    b.total_dwelling_units,
    b.lat,
    b.lng,
    st_distance(b.geom, query_point) as distance_m
  from blocks b
  where b.geom is not null
    and st_dwithin(b.geom, query_point, radius_m)
  order by
    case when sort_by = 'distance' then st_distance(b.geom, query_point) end asc nulls last,
    case when sort_by = 'storeys'  then b.storeys end desc nulls last
  limit 100;
end;
$$;

comment on function nearby_blocks(float, float, float, text) is
  'Returns up to 100 blocks within radius_m of (lat, lng), sorted by storey count (desc) or distance (asc)';

-- ---------------------------------------------------------------------------
-- 7. Trigger: auto-update updated_at on row changes
--
-- Sets updated_at to the current timestamp whenever a block row is modified,
-- so callers can track freshness without manual column management.
-- ---------------------------------------------------------------------------
create or replace function blocks_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function blocks_set_updated_at() is 'Trigger function: sets updated_at to now() on row modification';

-- Attach both triggers to the blocks table

-- The following DROP + CREATE trigger pairs are intentionally idempotent
-- (safe to run multiple times). Supabase may flag DROP as "destructive"
-- but DROP IF EXISTS on a trigger is non-destructive -- it only removes
-- the trigger if it already exists so the CREATE below can re-add it.
drop trigger if exists trg_blocks_set_geom on blocks;
create trigger trg_blocks_set_geom
  before insert or update of lat, lng
  on blocks
  for each row
  execute function blocks_set_geom();

drop trigger if exists trg_blocks_set_updated_at on blocks;
create trigger trg_blocks_set_updated_at
  before update
  on blocks
  for each row
  execute function blocks_set_updated_at();

comment on trigger trg_blocks_set_geom on blocks is 'Auto-derives geom from lat/lng on insert or when lat/lng change';
comment on trigger trg_blocks_set_updated_at on blocks is 'Auto-sets updated_at on any row modification';
