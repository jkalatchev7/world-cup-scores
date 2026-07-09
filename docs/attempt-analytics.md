# Attempt Analytics Backend

The current app stores every leaderboard submission as a raw row in `leaderboard_entries`, computes percentile with a frontend curve in [src/App.jsx](/home/jordan/world-cup-scores/src/App.jsx:96), and only keeps in-progress play/practice state in browser storage in [src/App.jsx](/home/jordan/world-cup-scores/src/App.jsx:204) and [src/App.jsx](/home/jordan/world-cup-scores/src/App.jsx:219).

That means:

- "Top X%" is not a true percentile because the client has no population distribution.
- A user's cross-attempt history is not modeled explicitly.
- Practice progress survives only on one browser.

## Recommended model

Use two backend tables:

- `player_profiles`: one row per user identity, keyed by normalized email.
- `player_attempts`: one row per completed attempt.

This repo now includes a Supabase migration at [supabase/migrations/20260709_add_attempt_analytics.sql](/home/jordan/world-cup-scores/supabase/migrations/20260709_add_attempt_analytics.sql:1) that adds:

- `player_profiles`
- `player_attempts`
- `submit_player_attempt(...)` RPC
- `refresh_attempt_percentiles(...)` helper
- `leaderboard_best_attempts` view
- `player_progress_summary` view

## How percentile should work

True percentile has to be calculated against all attempts for the same game.

The migration uses:

- ordering by `points asc, elapsed_seconds desc, created_at desc`
- `percent_rank()` to place each attempt within the observed distribution

Because higher scores are better, the window order is inverted so stronger attempts land at higher percentile values after ranking. Ties are broken consistently with the same leaderboard rules.

## How progress across attempts should work

Persist every finished run as an attempt, then derive progress from attempt history:

- `total_attempts`
- `best_points`
- `latest_points`
- `latest_percentile`
- first and last attempt timestamps

This supports UI such as:

- "Best score improved by 14 points over 5 attempts"
- "Latest attempt was your 82nd percentile result"
- "You have played 7 times"

## Frontend changes to make next

1. Replace direct inserts into `leaderboard_entries` in [src/useLeaderboard.js](/home/jordan/world-cup-scores/src/useLeaderboard.js:89) with an RPC call to `submit_player_attempt(...)`.
2. Stop using `computePercentile(...)` in [src/App.jsx](/home/jordan/world-cup-scores/src/App.jsx:96) for completed runs. Read the saved attempt percentile from the backend instead.
3. Load leaderboard rows from `leaderboard_best_attempts` instead of deduping client-side in [src/useLeaderboard.js](/home/jordan/world-cup-scores/src/useLeaderboard.js:32).
4. Add a profile/progress panel backed by `player_progress_summary` and the player's attempt list.
5. If you want cross-device practice memory too, move `practiceCards` out of local storage into a `player_practice_progress` table keyed by `player_id`.

## Important tradeoff

The current `submit_player_attempt(...)` function recomputes percentiles for the whole game after each insert. That is correct and simple, but it is `O(n)` across attempts. For this project size that is fine. If volume grows, switch to:

- a materialized stats table
- scheduled recomputation
- or percentile buckets instead of exact reranking
