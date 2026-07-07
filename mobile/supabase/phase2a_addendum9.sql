-- ============================================================================
-- Phase 2a Addendum 9 — challenges
-- Run in Supabase SQL Editor. Requires addendum 6-8 already applied.
--
-- Challenges are evergreen (no start/end dates) and measured against the
-- same rolling 7-day floor count already used for "Your Week" everywhere
-- else in the app — so progress is just "your weekly floors vs. the
-- challenge's target," no separate date-window bookkeeping needed. Reward
-- is a visual flourish on the challenge card itself (icon + color), not
-- wired into the main badge system — keeps this self-contained rather than
-- needing dynamic entries in the client's static badge list.
-- ============================================================================

create table if not exists challenges (
  challenge_id uuid primary key default gen_random_uuid(),
  title text not null unique,
  description text not null,
  difficulty text not null, -- 'easy' | 'medium' | 'hard'
  target_floors int not null,
  reward_icon text not null, -- Ionicons name
  reward_label text not null, -- e.g. "Century Badge"
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table challenges enable row level security;

create policy "Anyone can read active challenges"
  on challenges for select
  using (is_active = true);

create table if not exists challenge_participants (
  challenge_id uuid references challenges(challenge_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  joined_at timestamptz default now(),
  completed_at timestamptz,
  primary key (challenge_id, user_id)
);

create index idx_challenge_participants_user on challenge_participants(user_id);

alter table challenge_participants enable row level security;

create policy "Anyone can read challenge participation"
  on challenge_participants for select
  using (true);

create policy "Users can join challenges"
  on challenge_participants for insert
  with check (auth.uid() = user_id);

-- Check challenge completion whenever a climb is logged — same trigger
-- pattern as badge awarding. Only touches rows the user has joined and not
-- yet completed; once completed, stays completed even if their rolling
-- weekly total later dips back below target.
create or replace function check_challenge_completion()
returns trigger as $$
declare
  weekly_floors int;
  participant record;
begin
  select coalesce(sum(floors_climbed), 0) into weekly_floors
  from climbs
  where user_id = new.user_id and created_at >= now() - interval '7 days';

  for participant in
    select cp.challenge_id, c.target_floors
    from challenge_participants cp
    join challenges c on c.challenge_id = cp.challenge_id
    where cp.user_id = new.user_id and cp.completed_at is null
  loop
    if weekly_floors >= participant.target_floors then
      update challenge_participants
      set completed_at = now()
      where challenge_id = participant.challenge_id and user_id = new.user_id;
    end if;
  end loop;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_climb_insert_check_challenges on climbs;
create trigger on_climb_insert_check_challenges
  after insert on climbs
  for each row execute function check_challenge_completion();

-- Seed the three suggested challenges
insert into challenges (title, description, difficulty, target_floors, reward_icon, reward_label)
values
  ('Century Sprint', 'Climb 100 floors this week to earn this one.', 'easy', 100, 'flash-outline', 'Century Badge'),
  ('Elevation Chaser', 'Rack up 500 floors this week — about 12 climbs of a 40-storey block.', 'medium', 500, 'trending-up-outline', 'Chaser Badge'),
  ('Iron Legs', '1000 floors in a week. Not for the faint of heart.', 'hard', 1000, 'flame-outline', 'Iron Legs Badge')
on conflict (title) do nothing;
