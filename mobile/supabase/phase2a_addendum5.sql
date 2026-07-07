-- ============================================================================
-- Phase 2a Addendum 5 — security fixes
-- Run in Supabase SQL Editor. Requires schema + addendum 1-4 already applied.
--
-- Fixes two real RLS gaps found in a security review of this session's work:
-- both "report" UPDATE policies checked row ownership/report-count direction
-- but not which OTHER columns could change in the same call — letting any
-- authenticated user (anonymous sessions included — they carry a real
-- `authenticated` JWT) directly rewrite or hide someone ELSE's photo or
-- comment by calling the Supabase client directly instead of through the
-- app's UI. Both report flows already go through a `security definer` RPC
-- (increment_report_count / increment_comment_report_count), which bypasses
-- RLS internally — so the broad client-facing UPDATE policies were never
-- actually needed for reporting to work, and existed as pure attack surface.
-- ============================================================================

drop policy if exists "Users can report photos" on building_photos;
drop policy if exists "Users can report comments" on block_comments;

-- ============================================================================
-- Also closes a data-integrity gap (not unauthorized access, but still lets a
-- user fabricate their own leaderboard/badge standing): floors_climbed had no
-- relationship enforced to climb_qty/partial_floors/the block's real storeys.
-- Both the manual-entry and barometer-tracker paths already compute
-- floors_climbed = climb_qty * storeys + partial_floors client-side, so this
-- just makes that relationship a server-side guarantee instead of trusting
-- the client — mirrors the existing height-verification sanity-check pattern.
-- ============================================================================
create or replace function check_climb_floors_consistency()
returns trigger as $$
declare
  blk_storeys int;
begin
  select storeys into blk_storeys from blocks where block_id = new.block_id;
  if blk_storeys is not null and new.floors_climbed <> (new.climb_qty * blk_storeys + new.partial_floors) then
    raise exception 'floors_climbed (%) does not match climb_qty*storeys + partial_floors (%)',
      new.floors_climbed, (new.climb_qty * blk_storeys + new.partial_floors);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists climb_floors_consistency_check on climbs;
create trigger climb_floors_consistency_check
  before insert or update on climbs
  for each row execute function check_climb_floors_consistency();
