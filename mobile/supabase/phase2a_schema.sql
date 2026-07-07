-- ============================================================================
-- Phase 2a Database Schema
-- Run this in Supabase SQL Editor against the project database.
-- Requires: blocks table (from Phase 0), PostGIS extension
-- ============================================================================

-- ============================================================================
-- 1. Climbs — climb logging with offline sync support
-- ============================================================================
create table if not exists climbs (
  climb_id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  block_id uuid references blocks(block_id) on delete cascade,
  climb_qty int not null default 1,
  floors_climbed int not null, -- storeys × climb_qty
  synced boolean default true, -- false if queued from offline
  created_at timestamp with time zone default now()
);

create index idx_climbs_user_id on climbs(user_id);
create index idx_climbs_block_id on climbs(block_id);
create index idx_climbs_created_at on climbs(created_at desc);
create index idx_climbs_user_created on climbs(user_id, created_at desc);

-- RLS: users can read their own climbs; authenticated can insert
alter table climbs enable row level security;

create policy "Users can read own climbs"
  on climbs for select
  using (auth.uid() = user_id);

create policy "Users can insert own climbs"
  on climbs for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own climbs"
  on climbs for delete
  using (auth.uid() = user_id);

-- ============================================================================
-- 2. Height Verifications — user-submitted elevation gain
-- ============================================================================
create table if not exists height_verifications (
  verification_id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(block_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  submitted_height_m float not null,  -- elevation gain in meters
  watch_photo_url text,               -- Supabase Storage URL
  status text default 'active',       -- 'active' | 'removed'
  created_at timestamp with time zone default now(),
  unique (block_id, user_id)          -- one submission per user per building
);

create index idx_height_verifications_block on height_verifications(block_id);
create index idx_height_verifications_user on height_verifications(user_id);
create index idx_height_verifications_status on height_verifications(block_id, status);

-- RLS: anyone can read active verifications, authenticated can insert/update own
alter table height_verifications enable row level security;

create policy "Anyone can read active verifications"
  on height_verifications for select
  using (status = 'active');

create policy "Users can insert own verifications"
  on height_verifications for insert
  with check (auth.uid() = user_id);

create policy "Users can update own verifications"
  on height_verifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Sanity check: submitted height must be within ±20% of HDB estimate
-- (enforced in app code; this is a fallback)
create or replace function check_height_sanity()
returns trigger as $$
declare
  hdb_est float;
begin
  select est_height_m into hdb_est from blocks where block_id = new.block_id;
  if hdb_est is not null then
    if new.submitted_height_m < hdb_est * 0.8 or new.submitted_height_m > hdb_est * 1.2 then
      raise exception 'Submitted height %m deviates >20%% from HDB estimate %m',
        new.submitted_height_m, hdb_est;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger height_sanity_check
  before insert or update on height_verifications
  for each row execute function check_height_sanity();

-- ============================================================================
-- 3. Height Disputes — parallel track for disputing verified values
-- ============================================================================
create table if not exists height_disputes (
  dispute_id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(block_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  submitted_height_m float not null,
  watch_photo_url text,
  status text default 'active',        -- 'active' | 'resolved' | 'removed'
  created_at timestamp with time zone default now(),
  unique (block_id, user_id)
);

create index idx_height_disputes_block on height_disputes(block_id);
create index idx_height_disputes_user on height_disputes(user_id);
create index idx_height_disputes_status on height_disputes(block_id, status);

alter table height_disputes enable row level security;

create policy "Anyone can read active disputes"
  on height_disputes for select
  using (status = 'active');

create policy "Users can insert own disputes"
  on height_disputes for insert
  with check (auth.uid() = user_id);

create policy "Users can update own disputes"
  on height_disputes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- Helper: increment report count on a photo
-- ============================================================================
create or replace function increment_report_count(p_photo_id uuid)
returns void as $$
begin
  update building_photos
  set report_count = report_count + 1
  where photo_id = p_photo_id;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- 4. Building Photos — user-submitted photos with moderation
-- ============================================================================
create table if not exists building_photos (
  photo_id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(block_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  storage_path text not null,           -- Supabase Storage path
  photo_type text not null,             -- 'condition' | 'verification' | 'general'
  caption text,
  status text default 'active',         -- 'active' | 'reported' | 'hidden'
  report_count int default 0,
  created_at timestamp with time zone default now()
);

create index idx_building_photos_block on building_photos(block_id);
create index idx_building_photos_user on building_photos(user_id);
create index idx_building_photos_status on building_photos(status);
create index idx_building_photos_block_status on building_photos(block_id, status);

alter table building_photos enable row level security;

-- Anyone can read active photos (post-moderation model)
create policy "Anyone can read active photos"
  on building_photos for select
  using (status = 'active');

create policy "Users can insert photos"
  on building_photos for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own photos"
  on building_photos for delete
  using (auth.uid() = user_id);

-- Allow authenticated users to increment report_count
create policy "Users can report photos"
  on building_photos for update
  using (auth.uid() is not null)
  with check (
    auth.uid() is not null
    and (select report_count from building_photos bp where bp.photo_id = building_photos.photo_id) < report_count
  );

-- Auto-hide photo when report_count reaches 3
create or replace function auto_hide_reported_photo()
returns trigger as $$
begin
  if new.report_count >= 3 and old.status = 'active' then
    new.status = 'hidden';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger photo_report_trigger
  before update of report_count on building_photos
  for each row execute function auto_hide_reported_photo();

-- ============================================================================
-- 5. Notifications — in-app notification system
-- ============================================================================
create table if not exists notifications (
  notification_id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  type text not null,                   -- 'verification_corroborated' | 'block_verified'
                                        -- 'block_disputed' | 'photo_reported'
  block_id uuid references blocks(block_id) on delete cascade,
  message text not null,
  read boolean default false,
  created_at timestamp with time zone default now()
);

create index idx_notifications_user on notifications(user_id, created_at desc);
create index idx_notifications_unread on notifications(user_id, created_at desc)
  where read = false;

alter table notifications enable row level security;

create policy "Users can read own notifications"
  on notifications for select
  using (auth.uid() = user_id);

create policy "Users can update own notifications"
  on notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- 6. User Badges — earned badges
-- ============================================================================
create table if not exists user_badges (
  user_id uuid references auth.users(id) on delete cascade,
  badge_key text not null,
  earned_at timestamp with time zone default now(),
  primary key (user_id, badge_key)
);

create index idx_user_badges_user on user_badges(user_id);

alter table user_badges enable row level security;

create policy "Anyone can read user badges"
  on user_badges for select
  using (true);

-- Badges are awarded server-side via triggers/RPC; no direct insert by users

-- ============================================================================
-- 7. Block Verification Status — computed view
-- ============================================================================
create or replace view block_verification_status as
select
  b.block_id,
  b.storeys,
  b.est_height_m,
  b.height_source,
  coalesce(v.verification_count, 0) as verification_count,
  coalesce(d.dispute_count, 0) as dispute_count,
  case
    when coalesce(d.dispute_count, 0) >= 3 then 'disputed'
    when coalesce(v.verification_count, 0) >= 3 then 'verified'
    when coalesce(v.verification_count, 0) > 0 then 'pending'
    else 'estimated'
  end as verification_state
from blocks b
left join (
  select block_id, count(*) as verification_count
  from height_verifications
  where status = 'active'
  group by block_id
) v on v.block_id = b.block_id
left join (
  select block_id, count(*) as dispute_count
  from height_disputes
  where status = 'active'
  group by block_id
) d on d.block_id = b.block_id;

-- ============================================================================
-- 8. Storage bucket for building photos
-- ============================================================================
-- Run via Supabase dashboard or SQL:
-- insert into storage.buckets (id, name, public) values ('building-photos', 'building-photos', true);

-- Storage RLS policies (apply after bucket creation):
-- create policy "Anyone can view photos"
--   on storage.objects for select
--   using (bucket_id = 'building-photos');
--
-- create policy "Authenticated users can upload photos"
--   on storage.objects for insert
--   with check (bucket_id = 'building-photos' and auth.role() = 'authenticated');
--
-- create policy "Users can delete own photos"
--   on storage.objects for delete
--   using (bucket_id = 'building-photos' and auth.uid() = owner);

-- ============================================================================
-- 9. RPC: award a badge to a user (idempotent)
-- ============================================================================
create or replace function award_badge(p_user_id uuid, p_badge_key text)
returns void as $$
begin
  insert into user_badges (user_id, badge_key)
  values (p_user_id, p_badge_key)
  on conflict (user_id, badge_key) do nothing;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- 10. Trigger: create notification on verification
-- ============================================================================
create or replace function notify_verification_corroborated()
returns trigger as $$
declare
  existing_count int;
  existing_verifier_id uuid;
  block_address text;
begin
  -- Count other active verifications for this block (excluding this new one)
  select count(*) into existing_count
  from height_verifications
  where block_id = new.block_id
    and status = 'active'
    and user_id != new.user_id;

  -- Build block address string
  select ('Blk ' || blk_no || ' ' || street) into block_address
  from blocks where block_id = new.block_id;

  -- Notify existing verifiers that someone else also verified
  for existing_verifier_id in
    select user_id from height_verifications
    where block_id = new.block_id and status = 'active' and user_id != new.user_id
  loop
    insert into notifications (user_id, type, block_id, message)
    values (
      existing_verifier_id,
      'verification_corroborated',
      new.block_id,
      'Someone else verified ' || block_address || '. ' || (existing_count + 1) || ' of 3 needed.'
    );
  end loop;

  -- If this is the 3rd verification, mark block as verified and credit all verifiers
  if existing_count + 1 >= 3 then
    -- Update block to verified
    update blocks
    set height_source = 'verified',
        est_height_m = (
          select submitted_height_m
          from height_verifications
          where block_id = new.block_id and status = 'active'
          order by created_at asc
          limit 1
        ),
        updated_at = now()
    where block_id = new.block_id;

    -- Notify all verifiers and award badges
    for existing_verifier_id in
      select user_id from height_verifications
      where block_id = new.block_id and status = 'active'
    loop
      insert into notifications (user_id, type, block_id, message)
      values (
        existing_verifier_id,
        'block_verified',
        new.block_id,
        block_address || ' is now verified! You earned verification credit.'
      );

      -- Award verification badges (1, 5, 10)
      perform award_badge(existing_verifier_id, 'verified_1');

      if (select count(*) from height_verifications where user_id = existing_verifier_id and status = 'active') >= 5 then
        perform award_badge(existing_verifier_id, 'verified_5');
      end if;

      if (select count(*) from height_verifications where user_id = existing_verifier_id and status = 'active') >= 10 then
        perform award_badge(existing_verifier_id, 'verified_10');
      end if;
    end loop;
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger on_verification_insert
  after insert on height_verifications
  for each row execute function notify_verification_corroborated();
