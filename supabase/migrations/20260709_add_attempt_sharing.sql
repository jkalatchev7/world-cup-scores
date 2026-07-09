alter table public.player_attempts
add column if not exists share_token uuid not null default gen_random_uuid();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'player_attempts_share_token_key'
  ) then
    alter table public.player_attempts
    add constraint player_attempts_share_token_key unique (share_token);
  end if;
end
$$;

create index if not exists player_attempts_share_token_idx
  on public.player_attempts (share_token);

drop function if exists public.submit_player_attempt(
  text,
  text,
  integer,
  integer,
  integer,
  integer,
  integer,
  text,
  jsonb
);

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
  total_attempts bigint,
  share_token uuid
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

  select coalesce(max(existing_attempts.attempt_index), 0) + 1
  into v_attempt_index
  from public.player_attempts existing_attempts
  where existing_attempts.player_id = v_player_id
    and existing_attempts.game_slug = p_game_slug;

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
    summary.total_attempts,
    attempts.share_token
  from public.player_attempts attempts
  cross join lateral (
    select max(best_attempts.points) as best_points
    from public.player_attempts best_attempts
    where best_attempts.player_id = v_player_id
      and best_attempts.game_slug = p_game_slug
  ) best
  cross join lateral (
    select count(*) as total_attempts
    from public.player_attempts player_attempt_counts
    where player_attempt_counts.player_id = v_player_id
      and player_attempt_counts.game_slug = p_game_slug
  ) summary
  where attempts.id = v_attempt_id;
end;
$$;

drop function if exists public.get_shared_attempt(uuid);

create or replace function public.get_shared_attempt(p_share_token uuid)
returns table (
  share_token uuid,
  name text,
  points integer,
  max_points integer,
  exact_scores integer,
  correct_winners integer,
  elapsed_seconds integer,
  percentile numeric(5, 2),
  attempt_index integer,
  created_at timestamptz,
  metadata jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    attempts.share_token,
    profiles.display_name as name,
    attempts.points,
    attempts.max_points,
    attempts.exact_scores,
    attempts.correct_winners,
    attempts.elapsed_seconds,
    attempts.percentile,
    attempts.attempt_index,
    attempts.created_at,
    attempts.metadata
  from public.player_attempts attempts
  join public.player_profiles profiles
    on profiles.id = attempts.player_id
  where attempts.share_token = p_share_token;
$$;
