import { useEffect, useState } from 'react'
import { supabase } from './supabase'

function rankLeaderboard(entries) {
  return [...entries]
    .sort((left, right) => {
      if (right.points !== left.points) {
        return right.points - left.points
      }
      if (left.elapsedSeconds !== right.elapsedSeconds) {
        return left.elapsedSeconds - right.elapsedSeconds
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    })
    .slice(0, 25)
}

function mapLeaderboardRow(row) {
  return {
    name: row.name,
    email: row.email,
    points: row.points,
    elapsedSeconds: row.elapsed_seconds,
    exact: row.exact,
    calls: row.calls,
    rating: row.rating,
    createdAt: row.created_at,
  }
}

export function useLeaderboard() {
  const [leaderboard, setLeaderboard] = useState([])
  const [leaderboardForm, setLeaderboardForm] = useState({ name: '', email: '' })
  const [leaderboardState, setLeaderboardState] = useState('idle')

  async function loadLeaderboard() {
    const { data, error } = await supabase
      .from('leaderboard_entries')
      .select('name, email, points, elapsed_seconds, exact, calls, rating, created_at')
      .order('points', { ascending: false })
      .order('elapsed_seconds', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(25)

    if (error || !data) {
      throw error ?? new Error('Could not load leaderboard')
    }

    setLeaderboard(rankLeaderboard(data.map(mapLeaderboardRow)))
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
      const { error } = await supabase.from('leaderboard_entries').insert({
        ...entry,
        name,
        email,
      })

      if (error) {
        throw error
      }

      await loadLeaderboard()
      setLeaderboardForm({ name: '', email: '' })
      setLeaderboardState('saved')
      return true
    } catch {
      setLeaderboardState('error')
      return false
    }
  }

  function handleLeaderboardChange(event) {
    const { name, value } = event.target
    setLeaderboardState('idle')
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
    setLeaderboardState,
    handleLeaderboardChange,
    saveLeaderboardEntry,
    loadLeaderboard,
  }
}
