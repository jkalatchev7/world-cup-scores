create extension if not exists pgcrypto;

create table if not exists public.player_profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  display_name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint player_profiles_email_normalized_key unique (email_normalized)
);

create table if not exists public.player_attempts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  game_slug text not null default 'world-cup-recall',
  points integer not null check (points >= 0),
  max_points integer not null check (max_points > 0),
  exact_scores integer not null default 0 check (exact_scores >= 0),
  correct_winners integer not null default 0 check (correct_winners >= 0),
  elapsed_seconds integer not null check (elapsed_seconds >= 0),
  attempt_index integer not null,
  score_ratio numeric(8, 6) generated always as (points::numeric / nullif(max_points, 0)) stored,
  percentile numeric(5, 2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint player_attempts_player_attempt_index_key unique (player_id, attempt_index)
);

create index if not exists player_attempts_game_slug_points_idx
  on public.player_attempts (game_slug, points desc, elapsed_seconds asc, created_at asc);

create index if not exists player_attempts_player_created_at_idx
  on public.player_attempts (player_id, created_at asc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_player_profiles_updated_at on public.player_profiles;
create trigger set_player_profiles_updated_at
before update on public.player_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_player_attempts_updated_at on public.player_attempts;
create trigger set_player_attempts_updated_at
before update on public.player_attempts
for each row
execute function public.set_updated_at();

create or replace function public.refresh_attempt_percentiles(target_game_slug text default 'world-cup-recall')
returns void
language sql
as $$
  with ranked as (
    select
      id,
      case
        when count(*) over () = 1 then 100::numeric
        else round((percent_rank() over (
          order by points asc, elapsed_seconds desc, created_at desc
        ) * 100)::numeric, 2)
      end as percentile_value
    from public.player_attempts
    where game_slug = target_game_slug
  )
  update public.player_attempts attempts
  set percentile = ranked.percentile_value
  from ranked
  where attempts.id = ranked.id;
$$;

create or replace function public.submit_player_attempt(
  p_name text,
  p_email text,
  p_points integer,
  p_max_points integer,
  p_exact_scores integer,
  p_correct_winners integer,
  p_elapsed_seconds integer,
  p_game_slug text default 'world-cup-recall',
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  attempt_id uuid,
  player_id uuid,
  attempt_index integer,
  percentile numeric(5, 2),
  best_points integer,
  total_attempts bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_attempt_id uuid;
  v_attempt_index integer;
begin
  insert into public.player_profiles (display_name, email)
  values (btrim(p_name), btrim(p_email))
  on conflict (email_normalized)
  do update
    set display_name = excluded.display_name
  returning id into v_player_id;

  select coalesce(max(attempt_index), 0) + 1
  into v_attempt_index
  from public.player_attempts
  where player_id = v_player_id
    and game_slug = p_game_slug;

  insert into public.player_attempts (
    player_id,
    game_slug,
    points,
    max_points,
    exact_scores,
    correct_winners,
    elapsed_seconds,
    attempt_index,
    metadata
  )
  values (
    v_player_id,
    p_game_slug,
    p_points,
    p_max_points,
    p_exact_scores,
    p_correct_winners,
    p_elapsed_seconds,
    v_attempt_index,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_attempt_id;

  perform public.refresh_attempt_percentiles(p_game_slug);

  return query
  select
    attempts.id,
    attempts.player_id,
    attempts.attempt_index,
    attempts.percentile,
    best.best_points,
    summary.total_attempts
  from public.player_attempts attempts
  cross join lateral (
    select max(points) as best_points
    from public.player_attempts
    where player_id = v_player_id
      and game_slug = p_game_slug
  ) best
  cross join lateral (
    select count(*) as total_attempts
    from public.player_attempts
    where player_id = v_player_id
      and game_slug = p_game_slug
  ) summary
  where attempts.id = v_attempt_id;
end;
$$;

create or replace view public.leaderboard_best_attempts as
with ranked as (
  select
    profiles.id as player_id,
    profiles.display_name as name,
    profiles.email,
    attempts.id as attempt_id,
    attempts.points,
    attempts.max_points,
    attempts.exact_scores,
    attempts.correct_winners,
    attempts.elapsed_seconds,
    attempts.percentile,
    attempts.attempt_index,
    attempts.created_at,
    row_number() over (
      partition by profiles.id, attempts.game_slug
      order by attempts.points desc, attempts.elapsed_seconds asc, attempts.created_at asc
    ) as best_rank,
    count(*) over (
      partition by profiles.id, attempts.game_slug
    ) as total_attempts
  from public.player_profiles profiles
  join public.player_attempts attempts
    on attempts.player_id = profiles.id
)
select
  player_id,
  name,
  email,
  attempt_id,
  points,
  max_points,
  exact_scores,
  correct_winners,
  elapsed_seconds,
  percentile,
  attempt_index,
  total_attempts,
  created_at
from ranked
where best_rank = 1;

create or replace view public.player_progress_summary as
with base as (
  select
    attempts.player_id,
    attempts.game_slug,
    min(attempts.created_at) as first_attempt_at,
    max(attempts.created_at) as last_attempt_at,
    count(*) as total_attempts,
    min(attempts.points) as worst_points,
    max(attempts.points) as best_points
  from public.player_attempts attempts
  group by attempts.player_id, attempts.game_slug
),
latest as (
  select distinct on (attempts.player_id, attempts.game_slug)
    attempts.player_id,
    attempts.game_slug,
    attempts.points as latest_points,
    attempts.percentile as latest_percentile,
    attempts.elapsed_seconds as latest_elapsed_seconds,
    attempts.created_at as latest_attempt_at
  from public.player_attempts attempts
  order by attempts.player_id, attempts.game_slug, attempts.created_at desc
)
select
  profiles.id as player_id,
  profiles.display_name as name,
  profiles.email,
  base.game_slug,
  base.first_attempt_at,
  base.last_attempt_at,
  base.total_attempts,
  base.worst_points,
  base.best_points,
  latest.latest_points,
  latest.latest_percentile,
  latest.latest_elapsed_seconds
from base
join latest
  on latest.player_id = base.player_id
 and latest.game_slug = base.game_slug
join public.player_profiles profiles
  on profiles.id = base.player_id;
