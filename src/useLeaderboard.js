import { useEffect, useState } from 'react'
import { supabase } from './supabase'

function compareLeaderboardEntries(left, right) {
  if (right.points !== left.points) {
    return right.points - left.points
  }
  if (left.elapsedSeconds !== right.elapsedSeconds) {
    return left.elapsedSeconds - right.elapsedSeconds
  }
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
}

function mapLeaderboardRow(row) {
  return {
    name: row.name,
    email: row.email,
    points: row.points,
    elapsedSeconds: row.elapsed_seconds,
    exact: row.exact_scores,
    calls: row.correct_winners,
    percentile: row.percentile,
    attemptIndex: row.attempt_index,
    attempts: row.total_attempts,
    createdAt: row.created_at,
  }
}

export function useLeaderboard() {
  const [leaderboard, setLeaderboard] = useState([])
  const [leaderboardForm, setLeaderboardForm] = useState({ name: '', email: '' })
  const [leaderboardState, setLeaderboardState] = useState('idle')
  const [savedAttempt, setSavedAttempt] = useState(null)

  async function loadLeaderboard() {
    const { data, error } = await supabase
      .from('leaderboard_best_attempts')
      .select('name, email, points, elapsed_seconds, exact_scores, correct_winners, percentile, attempt_index, total_attempts, created_at')
      .order('points', { ascending: false })
      .order('elapsed_seconds', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(25)

    if (error || !data) {
      throw error ?? new Error('Could not load leaderboard')
    }

    setLeaderboard(data.map(mapLeaderboardRow).sort(compareLeaderboardEntries))
  }

  async function saveLeaderboardEntry(entry) {
    const name = entry.name.trim()
    const email = entry.email.trim().toLowerCase()
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

    if (!name || !isValidEmail) {
      setLeaderboardState('invalid')
      return false
    }

    try {
      const { data, error } = await supabase.rpc('submit_player_attempt', {
        p_name: name,
        p_email: email,
        p_points: entry.points,
        p_max_points: entry.maxPoints,
        p_exact_scores: entry.exactScores,
        p_correct_winners: entry.correctWinners,
        p_elapsed_seconds: entry.elapsedSeconds,
        p_game_slug: entry.gameSlug ?? 'world-cup-recall',
        p_metadata: entry.metadata ?? {},
      })

      if (error) {
        throw error
      }

      const attempt = data?.[0] ?? null
      setSavedAttempt(attempt)
      await loadLeaderboard()
      setLeaderboardForm({ name: '', email: '' })
      setLeaderboardState('saved')
      return attempt
    } catch {
      setLeaderboardState('error')
      return null
    }
  }

  function handleLeaderboardChange(event) {
    const { name, value } = event.target
    setLeaderboardState('idle')
    setSavedAttempt(null)
    setLeaderboardForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  useEffect(() => {
    loadLeaderboard().catch(() => {
      setLeaderboardState('error')
    })
  }, [])

  return {
    leaderboard,
    leaderboardForm,
    leaderboardState,
    savedAttempt,
    setLeaderboardState,
    handleLeaderboardChange,
    saveLeaderboardEntry,
    loadLeaderboard,
  }
}
