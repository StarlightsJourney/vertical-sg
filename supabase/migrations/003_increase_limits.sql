-- =============================================================================
-- Migration 003: Increase result limits for Singapore-scale queries
-- Singapore HDB blocks mapping app — raise nearby_blocks and blocks_in_bounds
-- caps so that dense areas (e.g. Singapore) return more than the tallest 100.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. RPC function: nearby_blocks
--
-- Returns blocks within a given radius of a point, sorted either by storey
-- count (tallest first — "Tallest near me") or by distance (closest first —
-- "Nearest to me"). Only returns blocks with non-null geom.
--
-- Parameters:
--   query_lat float  — Latitude of the query point
--   query_lng float  — Longitude of the query point
--   radius_m  float  — Search radius in metres (default 5000)
--   sort_by   text   — Sort order: 'storeys' (default) or 'distance'
--
-- Returns:
--   All visible block columns plus computed distance_m.
-- ---------------------------------------------------------------------------
create or replace function nearby_blocks(
  query_lat float,
  query_lng float,
  radius_m  float default 5000,
  sort_by   text  default 'storeys'
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
  query_point := st_setsrid(st_makepoint(query_lng, query_lat), 4326)::geography;

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
  limit 500;
end;
$$;

comment on function nearby_blocks(float, float, float, text) is
  'Returns up to 500 blocks within radius_m of (query_lat, query_lng), sorted by storey count (desc) or distance (asc)';

-- ---------------------------------------------------------------------------
-- 2. RPC function: blocks_in_bounds
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
--                        'distance' (no reference point; falls back to tallest-first)
--   result_limit  int   — Max rows returned (default 500, clamped to ≤ 1000)
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
  result_limit  int   default 500
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
  capped_limit int;
begin
  -- Prevent accidentally querying all 13K blocks at once
  capped_limit := least(result_limit, 1000);

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
    and st_intersects(b.geom, bbox::geography)
  order by
    case when sort_by = 'storeys'  then b.storeys end desc nulls last,
    case when sort_by = 'distance' then b.storeys end desc nulls last
  limit capped_limit;
end;
$$;

comment on function blocks_in_bounds(float, float, float, float, text, int) is
  'Returns up to result_limit (≤1000) blocks within a bounding box, sorted by storeys desc (default) or tallest-first (distance fallback)';
