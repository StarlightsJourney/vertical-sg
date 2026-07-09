-- ============================================================================
-- Phase 2a Addendum 16 — tracking transparency, duration, user-created
-- challenges/clubs/events.
-- Run in Supabase SQL Editor. Requires addendum 9, 12, 15 already applied.
-- ============================================================================

-- --- 1. Tracking method + duration on climbs ---
-- tracking_method tells other users whether floors_climbed is a real
-- barometer measurement, a step-count estimate, or a manual/no-sensor entry
-- — so they know how much to trust the number instead of assuming every
-- climb is precisely measured.
alter table climbs add column if not exists tracking_method text not null default 'manual';
alter table climbs drop constraint if exists climbs_tracking_method_check;
alter table climbs add constraint climbs_tracking_method_check check (tracking_method in ('barometer', 'pedometer', 'manual'));

alter table climbs add column if not exists duration_seconds int;

-- --- 2. Challenges: allow user-created challenges alongside official ones ---
alter table challenges add column if not exists creator_id uuid references auth.users(id) on delete set null;

drop policy if exists "Users can create their own challenges" on challenges;
create policy "Users can create their own challenges"
  on challenges for insert
  with check (auth.uid() = creator_id);

-- --- 3. User-created clubs ---
create table if not exists user_clubs (
  club_id uuid primary key default gen_random_uuid(),
  creator_id uuid references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in ('Trail Running', 'Hiking', 'Climbing', 'Other')),
  description text not null,
  url text,
  status text not null default 'active' check (status in ('active', 'hidden')),
  report_count int not null default 0,
  created_at timestamptz default now()
);

alter table user_clubs enable row level security;

create policy "Anyone can read active user clubs"
  on user_clubs for select
  using (status = 'active');

create policy "Users can create clubs"
  on user_clubs for insert
  with check (auth.uid() = creator_id);

create policy "Creators can delete their own clubs"
  on user_clubs for delete
  using (auth.uid() = creator_id);

-- --- 4. User-created events ---
create table if not exists user_events (
  event_id uuid primary key default gen_random_uuid(),
  creator_id uuid references auth.users(id) on delete cascade,
  name text not null,
  location text not null,
  blurb text not null,
  scope text not null default 'Local' check (scope in ('Local', 'Worldwide')),
  event_date date,
  url text,
  status text not null default 'active' check (status in ('active', 'hidden')),
  report_count int not null default 0,
  created_at timestamptz default now()
);

alter table user_events enable row level security;

create policy "Anyone can read active user events"
  on user_events for select
  using (status = 'active');

create policy "Users can create events"
  on user_events for insert
  with check (auth.uid() = creator_id);

create policy "Creators can delete their own events"
  on user_events for delete
  using (auth.uid() = creator_id);

-- --- 5. Report RPCs for user_clubs/user_events — same per-reporter dedup
-- pattern as addendum12's photo/comment reports, auto-hides at 3 reports. ---
create table if not exists user_club_reports (
  club_id uuid references user_clubs(club_id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (club_id, reporter_id)
);
create table if not exists user_event_reports (
  event_id uuid references user_events(event_id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (event_id, reporter_id)
);
alter table user_club_reports enable row level security;
alter table user_event_reports enable row level security;

create or replace function report_user_club(p_club_id uuid)
returns void as $$
declare
  rows_affected int;
begin
  insert into user_club_reports (club_id, reporter_id) values (p_club_id, auth.uid()) on conflict do nothing;
  get diagnostics rows_affected = row_count;
  if rows_affected > 0 then
    update user_clubs set report_count = report_count + 1 where club_id = p_club_id;
    update user_clubs set status = 'hidden' where club_id = p_club_id and report_count >= 3;
  end if;
end;
$$ language plpgsql security definer;

create or replace function report_user_event(p_event_id uuid)
returns void as $$
declare
  rows_affected int;
begin
  insert into user_event_reports (event_id, reporter_id) values (p_event_id, auth.uid()) on conflict do nothing;
  get diagnostics rows_affected = row_count;
  if rows_affected > 0 then
    update user_events set report_count = report_count + 1 where event_id = p_event_id;
    update user_events set status = 'hidden' where event_id = p_event_id and report_count >= 3;
  end if;
end;
$$ language plpgsql security definer;

grant execute on function report_user_club(uuid) to authenticated;
grant execute on function report_user_event(uuid) to authenticated;
revoke execute on function report_user_club(uuid) from anon, public;
revoke execute on function report_user_event(uuid) from anon, public;
