#!/usr/bin/env python3
"""
StairTrain — Phase 0: Data Ingestion Pipeline

Pulls HDB block data from data.gov.sg, geocodes it via cascading passes
(postal code -> HDB Existing Building polygon dataset -> fuzzy match ->
OneMap fallback), then upserts into a Supabase Postgres/PostGIS database.

Usage:
    pip install -r scripts/requirements.txt
    python scripts/ingest.py

Environment variables (from ../../.env.local):
    SUPABASE_URL              (required)
    SUPABASE_SERVICE_ROLE_KEY (required)
    ONEMAP_EMAIL              (required if ONEMAP_TOKEN not set)
    ONEMAP_PASSWORD           (required if ONEMAP_TOKEN not set)
    ONEMAP_TOKEN              (alternative to email/password auth)
"""

from __future__ import annotations

import difflib
import json
import os
import re
import sys
import time
from datetime import datetime

import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(SCRIPT_DIR, "..", "..", ".env.local")
load_dotenv(ENV_PATH)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
ONEMAP_EMAIL = os.environ.get("ONEMAP_EMAIL")
ONEMAP_PASSWORD = os.environ.get("ONEMAP_PASSWORD")
ONEMAP_TOKEN = os.environ.get("ONEMAP_TOKEN")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HDB_PROPERTY_RESOURCE_ID = "d_17f5382f26140b1fdae0ba2ef6239d2f"
HDB_BUILDING_RESOURCE_ID = "d_16b157c52ed637edd6ba1232e026258d"
DATA_GOV_URL = "https://data.gov.sg/api/action/datastore_search"
ONEMAP_AUTH_URL = "https://www.onemap.gov.sg/api/auth/post/getToken"
ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"

FLOOR_HEIGHT_M = 2.8
ONEMAP_DELAY_S = 0.25  # 250 ms between OneMap calls (well under 300/min limit)
BATCH_SIZE = 500  # upsert batch size

# Street abbreviation map (applied BEFORE geocoding/joining)
STREET_ABBREVIATIONS: dict[str, str] = {
    r"\bST\.\b": "SAINT",
    r"\bBT\b": "BUKIT",
    r"\bS'GOON\b": "SERANGOON",
    r"\bJLN\b": "JALAN",
    # Extend this list as join failures reveal more patterns
}

# ---------------------------------------------------------------------------
# Step 2 — Address Standardization
# ---------------------------------------------------------------------------


def standardize_blk_no(blk_no: str) -> str:
    """Normalize a block number.

    - Strip leading zeros: ``Blk 012`` -> ``12``
    - Standardise suffix letters: ``1a`` / ``1 A`` -> ``1A``
    - Remove any ``Blk`` / ``BLK`` prefix
    """
    blk = blk_no.strip()

    # Strip optional "Blk" prefix (case-insensitive)
    if blk.upper().startswith("BLK "):
        blk = blk[4:].strip()
    elif blk.upper().startswith("BLK"):
        blk = blk[3:].strip()

    # Split into numeric part and optional letter suffix
    m = re.match(r"^(\d+)([A-Za-z]?)$", blk)
    if m:
        digits = m.group(1).lstrip("0") or "0"
        suffix = m.group(2).upper()
        return digits + suffix

    return blk


def standardize_blk_suffix(blk_no: str) -> str:
    """Normalise whitespace/case in suffix letters: ``1 A`` -> ``1A``, ``1a`` -> ``1A``."""
    result = re.sub(r"(\d+)\s+([A-Za-z])$", r"\1\2", blk_no)
    result = re.sub(r"(\d+)([a-z])$", lambda m: m.group(1) + m.group(2).upper(), result)
    return result


def standardize_street(street: str) -> str:
    """Expand common street abbreviations via regex substitution."""
    result = street.strip()
    for pattern, replacement in STREET_ABBREVIATIONS.items():
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result


def standardize_address(blk_no: str, street: str) -> tuple[str, str]:
    """Full address standardisation (both blk_no and street)."""
    blk = standardize_blk_no(blk_no)
    blk = standardize_blk_suffix(blk)
    street = standardize_street(street)
    return blk, street


def address_key(blk_no: str, street: str) -> str:
    """Build a normalised, lowercased lookup key for matching.

    Separator ``||`` (unlikely to appear in real data) avoids ambiguity
    when reconstructing blk vs street parts.
    """
    b, s = standardize_address(blk_no, street)
    return f"{b}||{s.lower()}"


# ---------------------------------------------------------------------------
# Step 1 — Data Pull
# ---------------------------------------------------------------------------


def pull_dataset(resource_id: str, max_rows: int = 20000) -> list[dict]:
    """Fetch *all* records from a data.gov.sg CKAN resource (single page)."""
    url = f"{DATA_GOV_URL}?resource_id={resource_id}&limit={max_rows}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()["result"]["records"]


# ---------------------------------------------------------------------------
# Step 4 / 5 — OneMap Authentication & Geocoding
# ---------------------------------------------------------------------------


def get_onemap_token() -> str:
    """Obtain a OneMap API access token.

    Uses ``ONEMAP_TOKEN`` directly if set in the environment, otherwise
    authenticates via ``ONEMAP_EMAIL`` + ``ONEMAP_PASSWORD``.
    """
    if ONEMAP_TOKEN:
        print("  Using ONEMAP_TOKEN from environment")
        return ONEMAP_TOKEN

    if not ONEMAP_EMAIL or not ONEMAP_PASSWORD:
        print(
            "FATAL: Either ONEMAP_TOKEN or both ONEMAP_EMAIL and "
            "ONEMAP_PASSWORD must be set in .env.local"
        )
        sys.exit(1)

    print("  Authenticating with OneMap ...")
    resp = requests.post(
        ONEMAP_AUTH_URL,
        json={"email": ONEMAP_EMAIL, "password": ONEMAP_PASSWORD},
        timeout=10,
    )
    resp.raise_for_status()
    body = resp.json()
    token = body.get("access_token")
    if not token:
        print(f"FATAL: OneMap auth response missing access_token: {resp.text}")
        sys.exit(1)
    print("  OneMap authentication successful")
    return token


def geocode_onemap_search(query: str, token: str) -> tuple[float, float] | None:
    """Resolve an address string to (lat, lng) via OneMap Search API."""
    headers = {"Authorization": f"Bearer {token}"}
    params = {"searchVal": query, "returnGeom": "Y", "getAddrDetails": "Y"}
    try:
        resp = requests.get(ONEMAP_SEARCH_URL, headers=headers, params=params, timeout=10)
        resp.raise_for_status()
        results = resp.json().get("results", [])
        if results:
            r = results[0]
            return float(r["LATITUDE"]), float(r["LONGITUDE"])
    except (requests.RequestException, KeyError, ValueError, TypeError):
        pass
    return None


# ---------------------------------------------------------------------------
# Step 3 — HDB Existing Building Dataset Index
# ---------------------------------------------------------------------------


def _centroid_from_geojson(geom) -> tuple[float, float] | None:
    """Compute the centroid of a GeoJSON Polygon or MultiPolygon geometry."""
    try:
        if isinstance(geom, str):
            geom = json.loads(geom)
        coords = geom.get("coordinates", [])
        if geom["type"] == "Polygon":
            ring = coords[0]
            lat = sum(p[1] for p in ring) / len(ring)
            lng = sum(p[0] for p in ring) / len(ring)
            return lat, lng
        if geom["type"] == "MultiPolygon":
            pts: list[tuple[float, float]] = []
            for poly in coords:
                for ring in poly:
                    pts.extend((p[1], p[0]) for p in ring)
            if pts:
                lat = sum(p[0] for p in pts) / len(pts)
                lng = sum(p[1] for p in pts) / len(pts)
                return lat, lng
    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
        pass
    return None


def build_building_index(records: list[dict]) -> dict[str, tuple[float, float]]:
    """Build ``address_key -> (lat, lng)`` from the HDB Existing Building dataset.

    Priority: GeoJSON geometry centroid > explicit lat/lng fields.
    """
    index: dict[str, tuple[float, float]] = {}
    for rec in records:
        blk = rec.get("blk_no", "") or ""
        street = rec.get("street", "") or ""
        key = address_key(blk, street)
        if key in index:
            continue  # first-encountered wins

        # Try geometry (GeoJSON polygon)
        centroid = _centroid_from_geojson(rec.get("geometry"))
        if centroid:
            index[key] = centroid
            continue

        # Fallback to flat lat/lng columns
        try:
            if rec.get("lat") and rec.get("lng"):
                index[key] = (float(rec["lat"]), float(rec["lng"]))
        except (ValueError, TypeError):
            continue

    return index


def get_known_streets(index: dict[str, tuple[float, float]]) -> set[str]:
    """Extract the set of normalised street names from a building index."""
    streets: set[str] = set()
    for key in index:
        parts = key.split("||", 1)
        if len(parts) > 1 and parts[1]:
            streets.add(parts[1])
    return streets


# ---------------------------------------------------------------------------
# Step 3 — Fuzzy Matching
# ---------------------------------------------------------------------------


def fuzzy_match_street(
    street: str, known_streets: set[str], cutoff: float = 0.8
) -> str | None:
    """Return the closest known street name (or None) using difflib."""
    matches = difflib.get_close_matches(street.lower(), known_streets, n=1, cutoff=cutoff)
    return matches[0] if matches else None


# ---------------------------------------------------------------------------
# Step 6 — Supabase Upsert
# ---------------------------------------------------------------------------


def get_verified_pairs(supabase) -> set[tuple[str, str]]:
    """Return {(blk_no, street)} of rows that already have height_source='verified'.

    These rows will NOT have their height_source touched during upsert.
    """
    try:
        result = supabase.table("blocks") \
            .select("blk_no,street") \
            .eq("height_source", "verified") \
            .execute()
        return {(row["blk_no"], row["street"]) for row in (result.data or [])}
    except Exception as exc:
        print(f"  Warning: could not query verified blocks: {exc}")
        return set()


def upsert_blocks(supabase, records: list[dict], verified_pairs: set[tuple[str, str]]) -> int:
    """Upsert residential records into the ``blocks`` table in batches.

    Only sets ``height_source = 'estimated'`` for rows whose natural key
    is NOT in *verified_pairs*.
    """
    upsert_data: list[dict] = []
    for r in records:
        row = {
            "blk_no": r["_std_blk"],
            "street": r["_std_street"],
            "town": r.get("bldg_contract_town"),
            "storeys": r["_storeys"],
            "est_height_m": r["_est_height"],
            "year_completed": _safe_int(r.get("year_completed")),
            "total_dwelling_units": _safe_int(r.get("total_dwelling_units")),
            "updated_at": datetime.now().isoformat(),
        }
        if r.get("_geocoded"):
            row["lat"] = r["_lat"]
            row["lng"] = r["_lng"]

        # Only insert / overwrite height_source if the row is NOT verified
        pair = (row["blk_no"], row["street"])
        if pair not in verified_pairs:
            row["height_source"] = "estimated"

        upsert_data.append(row)

    total = 0
    for i in range(0, len(upsert_data), BATCH_SIZE):
        batch = upsert_data[i : i + BATCH_SIZE]
        try:
            supabase.table("blocks") \
                .upsert(batch, on_conflict="blk_no,street") \
                .execute()
            total += len(batch)
            print(f"  Upserted {total}/{len(upsert_data)} rows")
        except Exception as exc:
            print(f"  Error upserting batch {i // BATCH_SIZE}: {exc}")
    return total


# ---------------------------------------------------------------------------
# Step 7 — Log Unmatched
# ---------------------------------------------------------------------------


def log_unmatched(supabase, records: list[dict]) -> int:
    """Insert unmatched records into the ``unmatched_hdb_blocks`` table."""
    rows: list[dict] = []
    for r in records:
        rows.append({
            "blk_no": r["_std_blk"],
            "street": r["_std_street"],
            "max_floor_lvl": r.get("_storeys"),
            "year_completed": _safe_int(r.get("year_completed")),
            "total_dwelling_units": _safe_int(r.get("total_dwelling_units")),
            "reason": "All geocoding passes failed: postal -> building dataset -> fuzzy -> OneMap",
        })

    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        try:
            supabase.table("unmatched_hdb_blocks") \
                .insert(batch) \
                .execute()
            total += len(batch)
        except Exception as exc:
            print(f"  Error logging unmatched batch: {exc}")
    return total


# ---------------------------------------------------------------------------
# Misc Helpers
# ---------------------------------------------------------------------------


def _safe_int(val) -> int | None:
    """Convert *val* to int, returning None on failure."""
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Main Orchestration
# ---------------------------------------------------------------------------


def main() -> None:
    print("=" * 60)
    print("StairTrain — Phase 0 Data Ingestion")
    print(f"Started at: {datetime.now().isoformat()}")
    print("=" * 60)

    counts: dict[str, int] = {}

    # ── Step 1: Pull & Filter ──────────────────────────────────────────────
    print("\n--- Step 1: Pull & Filter ---")

    records = pull_dataset(HDB_PROPERTY_RESOURCE_ID)
    counts["total"] = len(records)

    residential = [
        r for r in records
        if r.get("residential", "").strip().upper() == "Y"
    ]
    counts["residential"] = len(residential)
    print(f"  Pulled {counts['total']} rows, "
          f"{counts['residential']} residential")

    # Compute est_height_m = max_floor_lvl * 2.8
    for r in residential:
        storeys = _safe_int(r.get("max_floor_lvl"))
        r["_storeys"] = storeys
        r["_est_height"] = round(storeys * FLOOR_HEIGHT_M, 1) if storeys else None

    # ── Step 2: Address Standardization ────────────────────────────────────
    print("\n--- Step 2: Address Standardization ---")

    for r in residential:
        blk = (r.get("blk_no") or "").strip()
        st = (r.get("street") or "").strip()
        r["_std_blk"], r["_std_street"] = standardize_address(blk, st)
        r["_addr_key"] = address_key(blk, st)
    print(f"  Standardized {len(residential)} addresses")

    # Mark every record as not-yet-geocoded
    for r in residential:
        r["_geocoded"] = False

    # ── Step 3: Cascading Geocode / Join ───────────────────────────────────
    print("\n--- Step 3: Cascading Geocode/Join ---")

    # Obtain OneMap token once (needed in Pass 1 and OneMap fallback)
    token = get_onemap_token()

    # -- Pass 1: match by postal code via OneMap ----------------------------
    print("\n  Pass 1: Matching by postal code ...")
    pass1 = 0
    for r in residential:
        if r["_geocoded"]:
            continue
        postal = (
            r.get("postal")
            or r.get("postal_code")
            or r.get("postcode")
            or ""
        )
        postal = str(postal).strip()
        if postal and postal not in ("None", ""):
            result = geocode_onemap_search(f"Singapore {postal}", token)
            if result:
                r["_lat"], r["_lng"] = result
                r["_geocoded"] = True
                pass1 += 1
            time.sleep(ONEMAP_DELAY_S)
    counts["pass1"] = pass1
    print(f"  Pass 1 matched: {pass1}")

    # -- Pass 2: strict match against HDB Existing Building dataset ---------
    print("\n  Pass 2: Matching against HDB Existing Building dataset ...")
    try:
        building_records = pull_dataset(HDB_BUILDING_RESOURCE_ID)
        building_index = build_building_index(building_records)
        print(f"  Building dataset: {len(building_records)} records, "
              f"{len(building_index)} indexed")
    except Exception as exc:
        print(f"  WARNING: could not fetch or index building dataset: {exc}")
        building_index = {}

    pass2 = 0
    for r in residential:
        if r["_geocoded"]:
            continue
        coord = building_index.get(r["_addr_key"])
        if coord:
            r["_lat"], r["_lng"] = coord
            r["_geocoded"] = True
            pass2 += 1
    counts["pass2"] = pass2
    print(f"  Pass 2 matched: {pass2}")

    # -- Pass 3: fuzzy match on street name ---------------------------------
    print("\n  Pass 3: Fuzzy matching on street name ...")
    known_streets = get_known_streets(building_index)
    pass3 = 0
    for r in residential:
        if r["_geocoded"]:
            continue
        fuzzy = fuzzy_match_street(r["_std_street"], known_streets)
        if fuzzy:
            # Try to find a building index entry for (blk_no, fuzzy_matched_street)
            candidate_key = f"{r['_std_blk'].lower()}||{fuzzy}"
            coord = building_index.get(candidate_key)
            if coord:
                r["_lat"], r["_lng"] = coord
                r["_geocoded"] = True
                pass3 += 1
    counts["pass3"] = pass3
    print(f"  Pass 3 matched: {pass3}")

    # -- OneMap fallback ----------------------------------------------------
    fallback_candidates = [r for r in residential if not r["_geocoded"]]
    print(f"\n  OneMap fallback: {len(fallback_candidates)} records to geocode")

    pass_fb = 0
    for idx, r in enumerate(fallback_candidates):
        address = f"{r['_std_blk']} {r['_std_street']}, Singapore"
        result = geocode_onemap_search(address, token)
        if result:
            r["_lat"], r["_lng"] = result
            r["_geocoded"] = True
            pass_fb += 1
        time.sleep(ONEMAP_DELAY_S)
    counts["fallback"] = pass_fb
    print(f"  OneMap fallback matched: {pass_fb}")

    # Final tally
    geocoded = [r for r in residential if r["_geocoded"]]
    unmatched = [r for r in residential if not r["_geocoded"]]
    counts["geocoded"] = len(geocoded)
    counts["unmatched"] = len(unmatched)

    # ── Step 6: Upsert into Supabase ───────────────────────────────────────
    print("\n--- Step 6: Upsert into Supabase ---")

    try:
        from supabase import create_client

        supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        print("  Connected to Supabase")

        verified = get_verified_pairs(supabase)
        print(f"  Existing verified blocks: {len(verified)}")

        total_upserted = upsert_blocks(supabase, residential, verified)
        print(f"  Upsert complete: {total_upserted} rows")

    except ImportError:
        print(
            "  WARNING: supabase-py not installed. Skipping DB upsert.\n"
            "  Install with: pip install supabase"
        )
    except Exception as exc:
        print(f"  ERROR during Supabase operations: {exc}")

    # ── Step 7: Log Unmatched ─────────────────────────────────────────────
    if unmatched:
        print(f"\n--- Step 7: Logging {len(unmatched)} unmatched records ---")
        try:
            logged = log_unmatched(supabase, unmatched)
            print(f"  Logged {logged} records to unmatched_hdb_blocks")
        except NameError:
            # supabase was never initialised (import failed above)
            print("  Could not log (supabase not available)")
        except Exception as exc:
            print(f"  Error logging unmatched: {exc}")

    # ── Summary ────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Total records pulled:           {counts['total']}")
    print(f"  Residential (filtered):         {counts['residential']}")
    print(f"  Geocoded — Pass 1 (postal):     {counts.get('pass1', 0)}")
    print(f"  Geocoded — Pass 2 (building):   {counts.get('pass2', 0)}")
    print(f"  Geocoded — Pass 3 (fuzzy):      {counts.get('pass3', 0)}")
    print(f"  Geocoded — OneMap fallback:     {counts.get('fallback', 0)}")
    print(f"  Total geocoded:                 {counts['geocoded']}")
    print(f"  Unmatched (lat/lng = NULL):     {counts['unmatched']}")
    print(f"Finished at: {datetime.now().isoformat()}")
    print("=" * 60)


if __name__ == "__main__":
    main()
