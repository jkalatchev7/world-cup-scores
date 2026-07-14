import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

const LEADERBOARD_NAME_COOKIE = 'world_cup_recall_name'
const LEADERBOARD_EMAIL_COOKIE = 'world_cup_recall_email'
const SAVED_ATTEMPT_STORAGE_KEY = 'world_cup_recall_saved_attempt_v1'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

function readCookie(name) {
  if (typeof document === 'undefined') {
    return ''
  }

  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))

  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : ''
}

function writeCookie(name, value) {
  if (typeof document === 'undefined') {
    return
  }

  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${COOKIE_MAX_AGE}; path=/; samesite=lax`
}

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
    attemptId: row.attempt_id,
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
    rank: row.rank ?? null,
    isCurrent: Boolean(row.is_current),
  }
}

function mapSavedAttemptRow(row) {
  if (!row) {
    return null
  }

  return {
    attempt_id: row.attempt_id,
    player_id: row.player_id,
    attempt_index: row.attempt_index,
    percentile: row.percentile,
    best_points: row.best_points,
    total_attempts: row.total_attempts,
    share_token: row.share_token,
  }
}

function mapSharedAttemptRow(row) {
  if (!row) {
    return null
  }

  return {
    shareToken: row.share_token,
    name: row.name,
    points: row.points,
    maxPoints: row.max_points,
    exactScores: row.exact_scores,
    correctWinners: row.correct_winners,
    elapsedSeconds: row.elapsed_seconds,
    percentile: row.percentile,
    attemptIndex: row.attempt_index,
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  }
}

function restoreSavedAttempt() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(SAVED_ATTEMPT_STORAGE_KEY)
    if (!raw) {
      return null
    }

    return mapSavedAttemptRow(JSON.parse(raw))
  } catch {
    return null
  }
}

function persistSavedAttempt(attempt) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (attempt) {
      window.localStorage.setItem(SAVED_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt))
    } else {
      window.localStorage.removeItem(SAVED_ATTEMPT_STORAGE_KEY)
    }
  } catch {
    // Ignore storage failures and keep the in-memory state.
  }
}

export function useLeaderboard() {
  const [leaderboard, setLeaderboard] = useState([])
  const [leaderboardForm, setLeaderboardForm] = useState(() => ({
    name: readCookie(LEADERBOARD_NAME_COOKIE),
    email: readCookie(LEADERBOARD_EMAIL_COOKIE),
  }))
  const [leaderboardState, setLeaderboardState] = useState('idle')
  const [savedAttempt, setSavedAttempt] = useState(() => restoreSavedAttempt())
  const [attemptPreview, setAttemptPreview] = useState(null)
  const [attemptPreviewState, setAttemptPreviewState] = useState('idle')
  const [leaderboardError, setLeaderboardError] = useState('')

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

  async function loadLeaderboardNeighbors(attemptId, radius = 5) {
    const { data, error } = await supabase.rpc('get_leaderboard_neighbors', {
      p_attempt_id: attemptId,
      p_radius: radius,
    })

    if (error || !data) {
      throw error ?? new Error('Could not load nearby leaderboard entries')
    }

    setLeaderboard(data.map(mapLeaderboardRow))
  }

  async function saveLeaderboardEntry(entry) {
    const name = entry.name.trim()
    const email = entry.email.trim().toLowerCase()
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

    if (!name || !isValidEmail) {
      setLeaderboardError('')
      setLeaderboardState('invalid')
      return false
    }

    try {
      setLeaderboardError('')
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

      const attempt = mapSavedAttemptRow(data?.[0] ?? null)
      writeCookie(LEADERBOARD_NAME_COOKIE, name)
      writeCookie(LEADERBOARD_EMAIL_COOKIE, email)
      setSavedAttempt(attempt)
      persistSavedAttempt(attempt)
      setAttemptPreview(null)
      setAttemptPreviewState('idle')
      if (attempt?.attempt_id) {
        await loadLeaderboardNeighbors(attempt.attempt_id)
      } else {
        await loadLeaderboard()
      }
      setLeaderboardState('saved')
      return attempt
    } catch (error) {
      const message = typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'Could not save leaderboard entry'
      setLeaderboardError(message)
      setLeaderboardState('error')
      return null
    }
  }

  async function loadAttemptPreview(entry) {
    setAttemptPreviewState('loading')

    const { data, error } = await supabase.rpc('preview_attempt_rank', {
      p_points: entry.points,
      p_max_points: entry.maxPoints,
      p_exact_scores: entry.exactScores,
      p_correct_winners: entry.correctWinners,
      p_elapsed_seconds: entry.elapsedSeconds,
      p_game_slug: entry.gameSlug ?? 'world-cup-recall',
    })

    if (error || !data?.[0]) {
      setAttemptPreviewState('error')
      throw error ?? new Error('Could not preview leaderboard rank')
    }

    setAttemptPreview(data[0])
    setAttemptPreviewState('ready')
    return data[0]
  }

  function resetAttemptPreview() {
    setAttemptPreview(null)
    setAttemptPreviewState('idle')
  }

  function handleLeaderboardChange(event) {
    const { name, value } = event.target
    setLeaderboardState('idle')
    setLeaderboardError('')
    setSavedAttempt(null)
    persistSavedAttempt(null)
    setLeaderboardForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const loadSharedAttempt = useCallback(async (shareToken) => {
    const { data, error } = await supabase.rpc('get_shared_attempt', {
      p_share_token: shareToken,
    })

    if (error) {
      throw error
    }

    return mapSharedAttemptRow(data?.[0] ?? null)
  }, [])

  useEffect(() => {
    loadLeaderboard().catch(() => {
      setLeaderboardState('error')
    })
  }, [])

  useEffect(() => {
    if (savedAttempt) {
      setLeaderboardState('saved')
    }
  }, [savedAttempt])

  return {
    leaderboard,
    leaderboardForm,
    leaderboardState,
    leaderboardError,
    savedAttempt,
    attemptPreview,
    attemptPreviewState,
    setLeaderboardState,
    handleLeaderboardChange,
    saveLeaderboardEntry,
    loadLeaderboard,
    loadLeaderboardNeighbors,
    loadAttemptPreview,
    resetAttemptPreview,
    loadSharedAttempt,
  }
}
