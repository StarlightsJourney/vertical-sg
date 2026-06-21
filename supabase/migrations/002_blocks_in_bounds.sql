-- =============================================================================
-- Migration 002: Blocks-in-Bounds RPC
-- Singapore HDB blocks mapping app — spatial RPCs for fetching blocks within
-- a map bounding box, plus a lightweight count companion.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. RPC function: blocks_in_bounds
--
-- Returns blocks whose geography falls within a bounding-box envelope
-- defined by four corner coordinates (min_lng, min_lat, max_lng, max_lat).
-- Designed for pan/zoom map views where the client needs only the visible
-- blocks up to a configurable limit.
--
-- Parameters:
--   min_lng      float — West longitude of the bounding box
--   min_lat      float — South latitude of the bounding box
--   max_lng      float — East longitude of the bounding box
--   max_lat      float — North latitude of the bounding box
--   sort_by      text  — Sort order: 'storeys' (default, tallest first) or
--                        'distance' (random-ish, defaults to tallest-first)
--   result_limit  int   — Max rows returned (default 200, clamped to ≤ 500)
--
-- Returns:
--   All visible block columns (no computed distance_m — caller already has
--   the bounding box context).
-- ---------------------------------------------------------------------------
create or replace function blocks_in_bounds(
  min_lng      float,
  min_lat      float,
  max_lng      float,
  max_lat      float,
  sort_by      text  default 'storeys',
  result_limit  int   default 200
)
returns table (
  block_id             uuid,
  blk_no               text,
  street               text,
  town                 text,
  storeys              int,
  est_height_m         float,
  height_source        text,
  year_completed       int,
  total_dwelling_units int,
  lat                  float,
  lng                  float
)
language plpgsql
stable
as $$
declare
  bbox geometry;
begin
  -- Prevent accidentally querying all 13K blocks at once
  result_limit := least(result_limit, 500);

  -- Build the bounding-box polygon (SRID 4326)
  bbox := st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326);

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
    b.lng
  from blocks b
  where b.geom is not null
    and st_intersects(b.geom::geometry, bbox)
  order by
    case when sort_by = 'storeys'  then b.storeys end desc nulls last,
    case when sort_by = 'distance' then b.storeys end desc nulls last
  limit result_limit;
end;
$$;

comment on function blocks_in_bounds(float, float, float, float, text, int) is
  'Returns up to result_limit (≤500) blocks within a bounding box, sorted by storeys desc (default) or tallest-first (distance fallback)';

-- ---------------------------------------------------------------------------
-- 2. RPC function: blocks_count_in_bounds
--
-- Lightweight count-only companion for showing "X blocks in this area" in
-- the map UI without fetching full row data. Returns the number of blocks
-- with non-null geom that intersect the given bounding box.
--
-- Parameters:
--   min_lng  float — West longitude
--   min_lat  float — South latitude
--   max_lng  float — East longitude
--   max_lat  float — North latitude
--
-- Returns:
--   int — Number of blocks intersecting the bounding box
-- ---------------------------------------------------------------------------
create or replace function blocks_count_in_bounds(
  min_lng float,
  min_lat float,
  max_lng float,
  max_lat float
)
returns int
language plpgsql
stable
as $$
declare
  bbox geometry;
  cnt   int;
begin
  bbox := st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326);

  select count(*) into cnt
  from blocks
  where geom is not null
    and st_intersects(geom::geometry, bbox);

  return cnt;
end;
$$;

comment on function blocks_count_in_bounds(float, float, float, float) is
  'Returns the count of blocks within a bounding box (lightweight, no row data)';
