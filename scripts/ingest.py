#!/usr/bin/env python3
"""
Vertical — Phase 0: Data Ingestion Pipeline

Pulls HDB block data from data.gov.sg, geocodes via OneMap Search API (single pass),
then upserts into a Supabase Postgres/PostGIS database.

Usage:
    pip install -r scripts/requirements.txt
    python scripts/ingest.py

Environment variables (from ../.env.local):
    SUPABASE_URL              (required)
    SUPABASE_SERVICE_ROLE_KEY (required)
    ONEMAP_EMAIL              (required if ONEMAP_TOKEN not set)
    ONEMAP_PASSWORD           (required if ONEMAP_TOKEN not set)
    ONEMAP_TOKEN              (alternative to email/password auth)
"""

from __future__ import annotations

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
ENV_PATH = os.path.join(SCRIPT_DIR, "..", ".env.local")
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
DATA_GOV_URL = "https://data.gov.sg/api/action/datastore_search"
ONEMAP_AUTH_URL = "https://www.onemap.gov.sg/api/auth/post/getToken"
ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"

FLOOR_HEIGHT_M = 2.8
ONEMAP_DELAY_S = 0.25  # 250 ms between OneMap calls (well under 300/min limit)
BATCH_SIZE = 500  # upsert batch size

# Street abbreviation map (applied BEFORE geocoding/joining).
# OneMap uses full spellings — we expand SG abbreviations to full names.
# Order matters: longer patterns first to avoid partial matches (e.g. C'WEALTH
# before STH, ST. before ST).
STREET_ABBREVIATIONS: dict[str, str] = {
    # Contractions
    r"\bS'GOON\b":     "SERANGOON",
    r"\bC'WEALTH\b":   "COMMONWEALTH",
    r"\bT'PANGS\b":    "TAMPINES",
    r"\bBT\s+?MERAH\b": "BUKIT MERAH",  # "BT MERAH" is common
    r"\bBT\s+?BATOK\b": "BUKIT BATOK",
    r"\bBT\s+?PANJANG\b": "BUKIT PANJANG",
    r"\bBT\s+?TIMAH\b": "BUKIT TIMAH",
    # Cardinals / prefixes
    r"\bSTH\b":         "SOUTH",
    r"\bNTH\b":         "NORTH",
    r"\bUPP\b":         "UPPER",
    r"\bLOW\b":         "LOWER",
    r"\bCTRL\b":        "CENTRAL",
    # SAINT (must be before ST→STREET — SG uses "ST." for Saint streets)
    r"\bST\.\s?":       "SAINT ",
    # Street type suffixes
    r"\bST\b":          "STREET",
    r"\bAVE\b":         "AVENUE",
    r"\bRD\b":          "ROAD",
    r"\bDR\b":          "DRIVE",
    r"\bCRES\b":        "CRESCENT",
    r"\bLN\b":          "LANE",
    r"\bCL\b":          "CLOSE",
    r"\bPL\b":          "PLACE",
    r"\bGDNS\b":        "GARDENS",
    r"\bHTS\b":         "HEIGHTS",
    r"\bPK\b":          "PARK",
    r"\bTER\b":         "TERRACE",
    r"\bWK\b":          "WALK",
    # Other common abbreviations
    r"\bJLN\b":         "JALAN",
    r"\bKG\b":          "KAMPONG",
    r"\bTG\b":          "TANJONG",
    r"\bBT\b":          "BUKIT",
    r"\bCTR\b":         "CENTRE",
    r"\bTWN\b":         "TOWN",
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


# ---------------------------------------------------------------------------
# Step 1 — Data Pull
# ---------------------------------------------------------------------------


def pull_dataset(resource_id: str, page_size: int = 500) -> list[dict]:
    """Fetch all records from a data.gov.sg CKAN resource using pagination.

    Respects rate limits: 1-second delay between pages, retries on 429/5xx.
    """
    all_records: list[dict] = []
    offset = 0
    max_retries = 3

    print(f"  Fetching (page size={page_size})...")

    while True:
        url = f"{DATA_GOV_URL}?resource_id={resource_id}&limit={page_size}&offset={offset}"

        for attempt in range(max_retries):
            try:
                resp = requests.get(url, timeout=30)

                if resp.status_code == 429:
                    wait = 5 * (attempt + 1)
                    print(f"  Rate limited — waiting {wait}s...")
                    time.sleep(wait)
                    continue

                resp.raise_for_status()
                break
            except requests.exceptions.RequestException as e:
                if attempt < max_retries - 1:
                    wait = 2 * (attempt + 1)
                    print(f"  Request failed ({e}) — retrying in {wait}s...")
                    time.sleep(wait)
                else:
                    raise

        result = resp.json()["result"]
        records = result["records"]
        total = result.get("total", 0)

        if not records:
            break

        all_records.extend(records)
        offset += page_size
        print(f"  ... {len(all_records):,} / {total:,} records")

        if offset >= total:
            break

        # Be polite to the API
        time.sleep(1)

    return all_records


# ---------------------------------------------------------------------------
# OneMap Authentication & Geocoding
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
# Supabase Upsert
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
# Log Unmatched
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
            "reason": "OneMap geocoding returned no result",
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
    print("Vertical — Phase 0 Data Ingestion")
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

    # Compute derived fields and standardize addresses
    print("\n--- Step 2: Address Standardization ---")

    for r in residential:
        storeys = _safe_int(r.get("max_floor_lvl"))
        r["_storeys"] = storeys
        r["_est_height"] = round(storeys * FLOOR_HEIGHT_M, 1) if storeys else None

        blk = (r.get("blk_no") or "").strip()
        st = (r.get("street") or "").strip()
        r["_std_blk"], r["_std_street"] = standardize_address(blk, st)

        r["_geocoded"] = False

    print(f"  Standardized {len(residential)} addresses")

    # ── Step 3: OneMap Geocoding ─────────────────────────────────────────
    print("\n--- Step 3: OneMap Geocoding ---")

    token = get_onemap_token()

    total = len(residential)
    matched = 0

    for idx, r in enumerate(residential):
        address = f"{r['_std_blk']} {r['_std_street']}"
        result = geocode_onemap_search(address, token)
        if result:
            r["_lat"], r["_lng"] = result
            r["_geocoded"] = True
            matched += 1

        # Progress every 100 records or at the end
        if (idx + 1) % 100 == 0 or idx == total - 1:
            print(f"  ... {idx + 1:,} / {total:,}  ({matched} matched)")

        time.sleep(ONEMAP_DELAY_S)

    counts["OneMap_matched"] = matched
    print(f"  OneMap matched: {matched} / {total}")

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
    print(f"  Geocoded — OneMap:              {counts.get('OneMap_matched', 0)}")
    print(f"  Total geocoded:                 {counts['geocoded']}")
    print(f"  Unmatched (lat/lng = NULL):     {counts['unmatched']}")
    print(f"Finished at: {datetime.now().isoformat()}")
    print("=" * 60)


if __name__ == "__main__":
    main()
