-- Chicken Horde: global leaderboard.
-- Safe to run more than once (SQL Editor or GitHub integration).
create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  name       text        not null check (char_length(name) between 1 and 12),
  score      integer     not null check (score >= 0),
  wave       integer     not null check (wave between 1 and 500),
  kills      integer     not null default 0 check (kills >= 0),
  players    integer     not null default 1 check (players between 1 and 32),
  version    text        not null default '7',
  created_at timestamptz not null default now(),
  -- Plausibility guard: rejects obviously fake scores for the wave reached.
  constraint scores_plausible check (score <= 400 * wave * wave + 5000 and kills <= 900 * wave)
);

create index if not exists scores_score_idx   on public.scores (score desc);
create index if not exists scores_created_idx on public.scores (created_at desc);

alter table public.scores enable row level security;

-- Anyone can read the leaderboard.
drop policy if exists "scores are public" on public.scores;
create policy "scores are public" on public.scores for select to anon, authenticated using (true);

-- Anyone can submit a score, but nobody can edit or delete (no update/delete policies).
drop policy if exists "anyone can submit" on public.scores;
create policy "anyone can submit" on public.scores for insert to anon, authenticated
  with check (created_at > now() - interval '1 minute' and created_at < now() + interval '1 minute');

grant select, insert on public.scores to anon, authenticated;
