-- ============================================================================
-- Phase 2a Addendum 14 — post reporting + a "Pro" profile flag
-- Run in Supabase SQL Editor. Requires phase2a_schema.sql already applied.
--
-- Feed posts are climbs with a caption/photo attached. Reporting a post
-- should NOT delete the underlying climb (it's real exercise data that
-- counts toward stats/leaderboards) — it just clears the caption/photo
-- once 3 distinct people report it, same "3 distinct reporters" dedup
-- pattern as addendum12's photo/comment reports.
--
-- is_pro is a display-only flag for now — there is no billing/IAP
-- integration in this app yet, so nothing sets this automatically. It
-- exists so the feed can show a "PRO" chip once a real subscription flow
-- is wired up later; until then it has to be set manually.
-- ============================================================================

alter table climbs add column if not exists report_count int not null default 0;

alter table profiles add column if not exists is_pro boolean not null default false;

create table if not exists climb_post_reports (
  climb_id uuid references climbs(climb_id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (climb_id, reporter_id)
);

alter table climb_post_reports enable row level security;
-- No client-facing policies — only touched via the security-definer RPC below.

create or replace function report_climb_post(p_climb_id uuid)
returns void as $$
declare
  rows_affected int;
begin
  insert into climb_post_reports (climb_id, reporter_id)
  values (p_climb_id, auth.uid())
  on conflict (climb_id, reporter_id) do nothing;

  get diagnostics rows_affected = row_count;

  if rows_affected > 0 then
    update climbs set report_count = report_count + 1 where climb_id = p_climb_id;
  end if;
end;
$$ language plpgsql security definer;

grant execute on function report_climb_post(uuid) to authenticated;
revoke execute on function report_climb_post(uuid) from anon, public;

create or replace function auto_clear_reported_post()
returns trigger as $$
begin
  if new.report_count >= 3 and (old.caption is not null or old.photo_path is not null) then
    new.caption = null;
    new.photo_path = null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_climb_report_count_change on climbs;
create trigger on_climb_report_count_change
  before update on climbs
  for each row
  when (new.report_count is distinct from old.report_count)
  execute function auto_clear_reported_post();
