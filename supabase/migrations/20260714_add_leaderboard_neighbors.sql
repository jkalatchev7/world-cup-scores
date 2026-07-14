create or replace function public.get_leaderboard_neighbors(
  p_attempt_id uuid,
  p_radius integer default 3
)
returns table (
  attempt_id uuid,
  player_id uuid,
  name text,
  email text,
  points integer,
  max_points integer,
  exact_scores integer,
  correct_winners integer,
  elapsed_seconds integer,
  percentile numeric(5, 2),
  attempt_index integer,
  created_at timestamptz,
  rank bigint,
  total_entries bigint,
  is_current boolean
)
language sql
security definer
set search_path = public
as $$
  with target as (
    select id, game_slug
    from public.player_attempts
    where id = p_attempt_id
  ),
  ranked as (
    select
      attempts.id as attempt_id,
      attempts.player_id,
      profiles.display_name as name,
      profiles.email,
      attempts.points,
      attempts.max_points,
      attempts.exact_scores,
      attempts.correct_winners,
      attempts.elapsed_seconds,
      attempts.percentile,
      attempts.attempt_index,
      attempts.created_at,
      row_number() over (
        order by attempts.points desc, attempts.elapsed_seconds asc, attempts.created_at asc
      ) as rank,
      count(*) over () as total_entries
    from public.player_attempts attempts
    join public.player_profiles profiles
      on profiles.id = attempts.player_id
    join target
      on target.game_slug = attempts.game_slug
  ),
  current_attempt as (
    select rank
    from ranked
    join target
      on target.id = ranked.attempt_id
  )
  select
    ranked.attempt_id,
    ranked.player_id,
    ranked.name,
    ranked.email,
    ranked.points,
    ranked.max_points,
    ranked.exact_scores,
    ranked.correct_winners,
    ranked.elapsed_seconds,
    ranked.percentile,
    ranked.attempt_index,
    ranked.created_at,
    ranked.rank,
    ranked.total_entries,
    ranked.attempt_id = p_attempt_id as is_current
  from ranked
  cross join current_attempt
  where ranked.rank between greatest(current_attempt.rank - greatest(p_radius, 0), 1)
    and current_attempt.rank + greatest(p_radius, 0)
  order by ranked.rank asc;
$$;
