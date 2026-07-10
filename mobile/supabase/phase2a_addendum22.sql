-- ============================================================================
-- Phase 2a Addendum 22 — shared, real amenity reports (water cooler / toilet /
-- food-shop) with community verification and comments.
-- Run in Supabase SQL Editor. Requires phase2a_schema.sql already applied.
--
-- Replaces the old MapScreen "Report nearby..." flow, which only ever wrote
-- to AsyncStorage on the reporting device — nobody else could ever see,
-- verify, or comment on a reported amenity. This makes the whole flow real:
--
--   1. amenity_reports        — the report itself (name/location/type/desc),
--                                starts 'unverified', flips to 'verified' once
--                                3 distinct users have corroborated it.
--   2. amenity_report_verifications — per-user dedup table so the same user
--                                can't inflate verified_count by tapping
--                                repeatedly; drives verify_amenity_report().
--   3. amenity_comments        — free-text notes on a report (e.g. "entrance
--                                is round the back, use the side door").
--   4. amenity_comment_likes   — per-user dedup table for comment likes;
--                                drives toggle_amenity_comment_like(). The
--                                client surfaces only the single highest-liked
--                                comment per report (ties broken by most
--                                recent — a plain `order by like_count desc,
--                                created_at desc limit 1` gives this for free).
-- ============================================================================

-- --- 1. Amenity reports ---
create table if not exists amenity_reports (
  report_id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete cascade,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  type text not null check (type in ('Water Cooler', 'Toilet', 'Food / Shop')),
  "desc" text,
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  verified_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table amenity_reports enable row level security;

drop policy if exists "Anyone can read amenity reports" on amenity_reports;
create policy "Anyone can read amenity reports"
  on amenity_reports for select
  using (true);

drop policy if exists "Users can report their own amenity sightings" on amenity_reports;
create policy "Users can report their own amenity sightings"
  on amenity_reports for insert
  with check (auth.uid() = reporter_id);

-- --- 2. Verifications — per-reporter dedup, same pattern as addendum16's
-- report_user_club/report_user_event (insert-on-conflict, only act on a
-- genuinely new row, auto-flip status once the threshold is hit). ---
create table if not exists amenity_report_verifications (
  report_id uuid references amenity_reports(report_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

alter table amenity_report_verifications enable row level security;

drop policy if exists "Anyone can read verifications" on amenity_report_verifications;
create policy "Anyone can read verifications"
  on amenity_report_verifications for select
  using (true);
-- No client-facing insert/delete policy — only ever written by the
-- security-definer verify_amenity_report() RPC below.

create or replace function verify_amenity_report(p_report_id uuid)
returns void as $$
declare
  rows_affected int;
begin
  if exists (
    select 1 from amenity_reports
    where report_id = p_report_id and reporter_id = auth.uid()
  ) then
    raise exception 'cannot verify your own report';
  end if;

  insert into amenity_report_verifications (report_id, user_id)
  values (p_report_id, auth.uid())
  on conflict do nothing;

  get diagnostics rows_affected = row_count;

  if rows_affected > 0 then
    update amenity_reports set verified_count = verified_count + 1 where report_id = p_report_id;
    update amenity_reports set status = 'verified' where report_id = p_report_id and verified_count >= 3;
  end if;
end;
$$ language plpgsql security definer;

grant execute on function verify_amenity_report(uuid) to authenticated;
revoke execute on function verify_amenity_report(uuid) from anon, public;

-- --- 3. Comments ---
create table if not exists amenity_comments (
  comment_id uuid primary key default gen_random_uuid(),
  report_id uuid references amenity_reports(report_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  body text not null,
  like_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_amenity_comments_report on amenity_comments(report_id);

alter table amenity_comments enable row level security;

drop policy if exists "Anyone can read amenity comments" on amenity_comments;
create policy "Anyone can read amenity comments"
  on amenity_comments for select
  using (true);

drop policy if exists "Users can post their own amenity comments" on amenity_comments;
create policy "Users can post their own amenity comments"
  on amenity_comments for insert
  with check (auth.uid() = user_id);

-- --- 4. Comment likes — same per-user dedup + counter pattern, toggled
-- (insert-or-delete depending on whether a like already exists) rather than
-- the report/verification flows' one-way insert-only dedup. ---
create table if not exists amenity_comment_likes (
  comment_id uuid references amenity_comments(comment_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table amenity_comment_likes enable row level security;

drop policy if exists "Anyone can read comment likes" on amenity_comment_likes;
create policy "Anyone can read comment likes"
  on amenity_comment_likes for select
  using (true);
-- No client-facing insert/delete policy — only ever written by the
-- security-definer toggle_amenity_comment_like() RPC below.

create or replace function toggle_amenity_comment_like(p_comment_id uuid)
returns boolean as $$
declare
  already_liked boolean;
begin
  select exists(
    select 1 from amenity_comment_likes
    where comment_id = p_comment_id and user_id = auth.uid()
  ) into already_liked;

  if already_liked then
    delete from amenity_comment_likes
    where comment_id = p_comment_id and user_id = auth.uid();
    update amenity_comments set like_count = greatest(like_count - 1, 0) where comment_id = p_comment_id;
    return false;
  else
    insert into amenity_comment_likes (comment_id, user_id) values (p_comment_id, auth.uid());
    update amenity_comments set like_count = like_count + 1 where comment_id = p_comment_id;
    return true;
  end if;
end;
$$ language plpgsql security definer;

grant execute on function toggle_amenity_comment_like(uuid) to authenticated;
revoke execute on function toggle_amenity_comment_like(uuid) from anon, public;
