-- ============================================================================
-- Phase 2a Addendum 11 — self-serve account deletion
-- Run in Supabase SQL Editor. No dependency on other addenda.
--
-- Every user-owned table (profiles, climbs, user_badges, follows,
-- challenge_participants, notifications, height_verifications,
-- height_disputes, building_photos, block_ratings, block_comments,
-- building_pioneers) already references auth.users(id) with
-- `on delete cascade`, so deleting the auth.users row cascades through all
-- of it in one statement — no need to touch each table individually.
--
-- This function is security definer, owned by `postgres` (the role that
-- owns functions created via the SQL Editor), which has sufficient grants
-- on the auth schema in Supabase's managed setup — this is the standard
-- documented pattern for self-serve account deletion.
-- ============================================================================

create or replace function delete_own_account()
returns void as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$ language plpgsql security definer;

grant execute on function delete_own_account() to authenticated;
