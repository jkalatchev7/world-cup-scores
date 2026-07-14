create or replace function public.preview_attempt_rank(
  p_points integer,
  p_max_points integer,
  p_exact_scores integer,
  p_correct_winners integer,
  p_elapsed_seconds integer,
  p_game_slug text default 'world-cup-recall'
)
returns table (
  rank bigint,
  total_entries bigint,
  percentile numeric(5, 2)
)
language sql
security definer
set search_path = public
as $$
  with hypothetical as (
    select
      'preview-attempt'::text as row_id,
      p_points as points,
      p_elapsed_seconds as elapsed_seconds,
      timezone('utc', now()) as created_at
    union all
    select
      attempts.id::text as row_id,
      attempts.points,
      attempts.elapsed_seconds,
      attempts.created_at
    from public.player_attempts attempts
    where attempts.game_slug = p_game_slug
  ),
  ranked as (
    select
      row_id,
      row_number() over (
        order by points desc, elapsed_seconds asc, created_at asc
      ) as rank,
      count(*) over () as total_entries,
      case
        when count(*) over () = 1 then 100.00::numeric(5, 2)
        else round((
          percent_rank() over (
            order by points asc, elapsed_seconds desc, created_at desc
          ) * 100
        )::numeric, 2)
      end as percentile
    from hypothetical
  )
  select
    ranked.rank,
    ranked.total_entries,
    ranked.percentile
  from ranked
  where ranked.row_id = 'preview-attempt';
$$;
