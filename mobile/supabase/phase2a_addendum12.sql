-- ============================================================================
-- Phase 2a Addendum 12 — close two RPC authorization gaps found in security review
-- Run in Supabase SQL Editor. Requires phase2a_schema.sql, addendum2, addendum4,
-- addendum8 already applied.
--
-- 1. award_badge(p_user_id, p_badge_key) is `security definer` and had no
--    check that p_user_id = auth.uid(), and (like every function in this
--    project except delete_own_account) kept Postgres's default PUBLIC
--    execute grant — so any client could call
--    supabase.rpc('award_badge', { p_user_id: <anyone>, p_badge_key: <any> })
--    directly and forge badges for any account. It's only ever called
--    internally from other security-definer trigger functions, which stay
--    able to call it after the revoke below (they run as the function
--    owner, which isn't grant-restricted).
--
-- 2. increment_report_count / increment_comment_report_count /
--    increment_climb_comment_report_count let a single actor call the same
--    RPC three times in a row to auto-hide any other user's photo/comment —
--    there was no per-reporter dedup, just a bare counter. Adds a small
--    dedup table per content type and only increments report_count on a
--    genuinely new (target, reporter) pair, using auth.uid() (not a
--    client-supplied value) as the reporter.
-- ============================================================================

-- --- 1. award_badge: scope to the caller, lock down the grant ---

create or replace function award_badge(p_user_id uuid, p_badge_key text)
returns void as $$
declare
  rows_affected int;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not authorized';
  end if;

  insert into user_badges (user_id, badge_key)
  values (p_user_id, p_badge_key)
  on conflict (user_id, badge_key) do nothing;

  get diagnostics rows_affected = row_count;

  if rows_affected > 0 then
    insert into notifications (user_id, type, block_id, message)
    values (
      p_user_id,
      'badge_earned',
      null,
      'New badge earned: ' || badge_display_name(p_badge_key) || '!'
    );
  end if;
end;
$$ language plpgsql security definer;

revoke execute on function award_badge(uuid, text) from public, anon, authenticated;

-- --- 2. Report RPCs: per-reporter dedup instead of a bare counter ---

create table if not exists photo_reports (
  photo_id uuid references building_photos(photo_id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (photo_id, reporter_id)
);

create table if not exists block_comment_reports (
  comment_id uuid references block_comments(comment_id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (comment_id, reporter_id)
);

create table if not exists climb_comment_reports (
  comment_id uuid references climb_comments(comment_id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (comment_id, reporter_id)
);

alter table photo_reports enable row level security;
alter table block_comment_reports enable row level security;
alter table climb_comment_reports enable row level security;
-- No client-facing policies at all — these tables are only ever touched by
-- the security-definer functions below, never read/written directly.

create or replace function increment_report_count(p_photo_id uuid)
returns void as $$
declare
  rows_affected int;
begin
  insert into photo_reports (photo_id, reporter_id)
  values (p_photo_id, auth.uid())
  on conflict (photo_id, reporter_id) do nothing;

  get diagnostics rows_affected = row_count;

  if rows_affected > 0 then
    update building_photos set report_count = report_count + 1 where photo_id = p_photo_id;
  end if;
end;
$$ language plpgsql security definer;

create or replace function increment_comment_report_count(p_comment_id uuid)
returns void as $$
declare
  rows_affected int;
begin
  insert into block_comment_reports (comment_id, reporter_id)
  values (p_comment_id, auth.uid())
  on conflict (comment_id, reporter_id) do nothing;

  get diagnostics rows_affected = row_count;

  if rows_affected > 0 then
    update block_comments set report_count = report_count + 1 where comment_id = p_comment_id;
  end if;
end;
$$ language plpgsql security definer;

create or replace function increment_climb_comment_report_count(p_comment_id uuid)
returns void as $$
declare
  rows_affected int;
begin
  insert into climb_comment_reports (comment_id, reporter_id)
  values (p_comment_id, auth.uid())
  on conflict (comment_id, reporter_id) do nothing;

  get diagnostics rows_affected = row_count;

  if rows_affected > 0 then
    update climb_comments set report_count = report_count + 1 where comment_id = p_comment_id;
  end if;
end;
$$ language plpgsql security definer;

grant execute on function increment_report_count(uuid) to authenticated;
grant execute on function increment_comment_report_count(uuid) to authenticated;
grant execute on function increment_climb_comment_report_count(uuid) to authenticated;
revoke execute on function increment_report_count(uuid) from anon, public;
revoke execute on function increment_comment_report_count(uuid) from anon, public;
revoke execute on function increment_climb_comment_report_count(uuid) from anon, public;
