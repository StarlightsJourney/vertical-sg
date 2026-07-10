-- ============================================================================
-- Phase 2a Addendum 25 — extend community verification (3-confirmation
-- threshold, from phase2a_addendum22.sql) to the *static*, bundled amenity
-- datasets (assets/water-coolers.json etc.), not just user-submitted
-- amenity_reports rows.
-- Run in Supabase SQL Editor. Requires phase2a_addendum22.sql already applied.
--
-- Tester feedback this addresses:
--   The static water-cooler JSON ships its own baked-in `status:
--   'verified' | 'unverified'` per entry. Unlike amenity_reports, these
--   aren't rows in our DB — they're bundled with the app, so there's no
--   table row to attach a verified_count to, and an unverified entry could
--   never be confirmed. This adds a DB-backed verification layer keyed by a
--   stable synthetic identifier the client derives deterministically from
--   each static entry's own data (type + name + rounded lat/lng — see
--   `staticAmenityKey()` in MapScreen.tsx), so the exact same
--   3-verification mechanism used for amenity_reports now applies here too.
--
--   1. static_amenity_status         — one row per static entry that has
--                                       received at least one verification
--                                       (rows are created lazily, on first
--                                       verification, not pre-seeded for
--                                       every bundled entry). Mirrors
--                                       amenity_reports' status/verified_count
--                                       columns.
--   2. static_amenity_verifications  — per-user dedup table, same shape and
--                                       purpose as amenity_report_verifications.
--                                       Drives verify_static_amenity().
--
-- Client behaviour (see MapScreen.tsx): an entry's *effective* status is the
-- live static_amenity_status row if one exists for its key, else the JSON's
-- own baked-in status. Static entries have no reporter/submitter, so there's
-- no self-verification restriction (unlike verify_amenity_report(), this RPC
-- doesn't check/reject the caller being "the reporter" — there isn't one).
-- ============================================================================

-- --- 1. Status table — lazily created per amenity_key on first verification. ---
create table if not exists static_amenity_status (
  amenity_key text primary key,
  verified_count int not null default 0,
  status text not null default 'unverified' check (status in ('unverified', 'verified'))
);

alter table static_amenity_status enable row level security;

drop policy if exists "Anyone can read static amenity status" on static_amenity_status;
create policy "Anyone can read static amenity status"
  on static_amenity_status for select
  using (true);
-- No client-facing insert/update policy — only ever written by the
-- security-definer verify_static_amenity() RPC below.

-- --- 2. Verifications — per-user dedup, same pattern as
-- amenity_report_verifications (insert-on-conflict, only act on a genuinely
-- new row, auto-flip status once the threshold is hit). ---
create table if not exists static_amenity_verifications (
  amenity_key text not null,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (amenity_key, user_id)
);

alter table static_amenity_verifications enable row level security;

drop policy if exists "Anyone can read static amenity verifications" on static_amenity_verifications;
create policy "Anyone can read static amenity verifications"
  on static_amenity_verifications for select
  using (true);
-- No client-facing insert/delete policy — only ever written by the
-- security-definer verify_static_amenity() RPC below.

create or replace function verify_static_amenity(p_amenity_key text)
returns void as $$
declare
  rows_affected int;
begin
  insert into static_amenity_verifications (amenity_key, user_id)
  values (p_amenity_key, auth.uid())
  on conflict do nothing;

  get diagnostics rows_affected = row_count;

  -- Only act on a genuinely new verification (not a repeat tap by the same
  -- user) — same guard as verify_amenity_report(). Auto-creates the
  -- static_amenity_status row on first verification if it doesn't exist yet.
  if rows_affected > 0 then
    insert into static_amenity_status (amenity_key, verified_count, status)
    values (p_amenity_key, 1, 'unverified')
    on conflict (amenity_key) do update
      set verified_count = static_amenity_status.verified_count + 1,
          status = case
            when static_amenity_status.verified_count + 1 >= 3 then 'verified'
            else static_amenity_status.status
          end;
  end if;
end;
$$ language plpgsql security definer;

grant execute on function verify_static_amenity(text) to authenticated;
revoke execute on function verify_static_amenity(text) from anon, public;
