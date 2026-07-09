import { useEffect, useMemo, useRef, useState } from 'react'
import { matches } from './data'

const STORAGE_KEY = 'world-cup-recall-progress-v1'
const ADSENSE_CLIENT = import.meta.env.VITE_ADSENSE_CLIENT
const ADSENSE_SLOT = import.meta.env.VITE_ADSENSE_SLOT

const flagOverrides = {
  'GB-ENG': '🏴',
  'GB-SCT': '🏴',
}

const tiers = [
  { min: 93, title: 'World Cup Oracle', note: 'Deadly accurate. Your card looks like it came from the future.' },
  { min: 82, title: 'Knockout Lock', note: 'You are reading scorelines better than most of the field.' },
  { min: 68, title: 'Group Boss', note: 'Strong work. Plenty of sharp calls with only a few misses.' },
  { min: 50, title: 'Still Alive', note: 'You are landing some outcomes, but exact scores are slipping away.' },
  { min: 0, title: 'Chaos Agent', note: 'Spectacular confidence, mixed results.' },
]

function shuffleArray(items) {
  const copy = [...items]

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]]
  }

  return copy
}

function getFlagEmoji(code) {
  if (flagOverrides[code]) {
    return flagOverrides[code]
  }

  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
}

function getOutcome(home, away) {
  if (home === away) {
    return 'draw'
  }

  return home > away ? 'home' : 'away'
}

function scorePrediction(match, guess) {
  const home = Number.parseInt(guess.home, 10)
  const away = Number.parseInt(guess.away, 10)

  if (Number.isNaN(home) || Number.isNaN(away)) {
    return {
      complete: false,
      points: 0,
      exact: false,
      outcome: false,
      teamGoals: 0,
      difference: false,
    }
  }

  const exact = home === match.homeScore && away === match.awayScore
  const outcome = getOutcome(home, away) === getOutcome(match.homeScore, match.awayScore)
  const teamGoals = Number(home === match.homeScore) + Number(away === match.awayScore)
  const difference = home - away === match.homeScore - match.awayScore

  let points = teamGoals
  if (outcome) {
    points += 2
  }
  if (difference && !exact) {
    points += 1
  }
  if (exact) {
    points += 3
  }

  return {
    complete: true,
    points,
    exact,
    outcome,
    teamGoals,
    difference,
  }
}

function buildRating(percent) {
  return tiers.find((item) => percent >= item.min) ?? tiers[tiers.length - 1]
}

function computePercentile(score, maxScore) {
  if (maxScore === 0) {
    return 0
  }

  const ratio = score / maxScore
  const curved = Math.round(10 + ratio * 90 - (1 - ratio) * 8)
  return Math.max(1, Math.min(99, curved))
}

function formatElapsedTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatMatchStage(group) {
  return group.length === 1 ? `Group ${group}` : group
}

function getProgressTone(entry, index, activeIndex) {
  if (index === activeIndex) {
    return 'current'
  }
  if (!entry.locked) {
    return 'pending'
  }
  if (entry.result.exact) {
    return 'exact'
  }
  if (entry.result.outcome) {
    return 'good'
  }
  return 'miss'
}

function getRevealCopy(result) {
  if (result.exact) {
    return { title: 'Exact Score', tone: 'exact' }
  }
  if (result.outcome) {
    return { title: 'Correct Winner', tone: 'good' }
  }
  if (result.points > 0) {
    return { title: 'Close', tone: 'good' }
  }
  return { title: 'Missed', tone: 'miss' }
}

function summarizeGroups(results) {
  const groups = new Map()

  results.forEach(({ match, result, locked }) => {
    if (!locked) {
      return
    }

    const current = groups.get(match.group) ?? { group: match.group, points: 0, matches: 0 }
    current.points += result.points
    current.matches += 1
    groups.set(match.group, current)
  })

  const entries = [...groups.values()]
    .map((entry) => ({
      ...entry,
      average: entry.matches === 0 ? 0 : entry.points / entry.matches,
    }))
    .sort((left, right) => {
      if (right.average !== left.average) {
        return right.average - left.average
      }
      return left.group.localeCompare(right.group)
    })

  return {
    best: entries[0] ?? null,
    worst: entries.at(-1) ?? null,
  }
}

function createDefaultGameState() {
  return {
    fixtureOrder: shuffleArray(matches),
    guesses: Object.fromEntries(matches.map((match) => [match.id, { home: '', away: '' }])),
    lockedMatches: {},
    activeIndex: 0,
    elapsedSeconds: 0,
  }
}

function restoreGameState() {
  const fallback = createDefaultGameState()

  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return fallback
    }

    const saved = JSON.parse(raw)
    const matchesById = new Map(matches.map((match) => [match.id, match]))
    const orderedIds = Array.isArray(saved.fixtureOrderIds) ? saved.fixtureOrderIds : []

    if (orderedIds.length !== matches.length || new Set(orderedIds).size !== matches.length) {
      return fallback
    }

    const fixtureOrder = orderedIds
      .map((id) => matchesById.get(id))
      .filter(Boolean)

    if (fixtureOrder.length !== matches.length) {
      return fallback
    }

    const guesses = Object.fromEntries(matches.map((match) => {
      const savedGuess = saved.guesses?.[match.id] ?? {}
      return [
        match.id,
        {
          home: typeof savedGuess.home === 'string' ? savedGuess.home.replace(/\D/g, '').slice(0, 1) : '',
          away: typeof savedGuess.away === 'string' ? savedGuess.away.replace(/\D/g, '').slice(0, 1) : '',
        },
      ]
    }))

    const lockedMatches = Object.fromEntries(matches.map((match) => [
      match.id,
      Boolean(saved.lockedMatches?.[match.id]),
    ]))

    const maxIndex = matches.length - 1
    const activeIndex = Number.isInteger(saved.activeIndex)
      ? Math.max(0, Math.min(maxIndex, saved.activeIndex))
      : 0
    const elapsedSeconds = Number.isInteger(saved.elapsedSeconds) && saved.elapsedSeconds >= 0
      ? saved.elapsedSeconds
      : 0

    return {
      fixtureOrder,
      guesses,
      lockedMatches,
      activeIndex,
      elapsedSeconds,
    }
  } catch {
    return fallback
  }
}

function TeamInput({ team, code, value, onChange, onKeyDown, inputRef, disabled }) {
  return (
    <div className="team-block">
      <div className="team-nameplate">
        <span className="team-flag" aria-hidden="true">{getFlagEmoji(code)}</span>
        <h2>{team}</h2>
      </div>
      <input
        ref={inputRef}
        aria-label={`${team} score`}
        className="score-box"
        disabled={disabled}
        inputMode="numeric"
        pattern="[0-9]*"
        type="text"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

function AdSlot({ client, slot, className = '' }) {
  useEffect(() => {
    if (!client || !slot || typeof window === 'undefined') {
      return
    }

    const existingScript = document.querySelector('script[data-adsense-script="true"]')

    if (!existingScript) {
      const script = document.createElement('script')
      script.async = true
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`
      script.crossOrigin = 'anonymous'
      script.dataset.adsenseScript = 'true'
      document.head.appendChild(script)
    }
  }, [client, slot])

  useEffect(() => {
    if (!client || !slot || typeof window === 'undefined') {
      return
    }

    try {
      window.adsbygoogle = window.adsbygoogle || []
      window.adsbygoogle.push({})
    } catch {
      // AdSense can fail silently on localhost or unapproved domains.
    }
  }, [client, slot])

  if (!client || !slot) {
    return null
  }

  return (
    <div className={`ad-slot-shell ${className}`.trim()}>
      <p className="ad-label">Sponsored</p>
      <ins
        className="adsbygoogle ad-slot"
        style={{ display: 'block' }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}

function buildExportPayload({ fixtureOrder, guesses, metrics, elapsedSeconds }) {
  return {
    game: 'World Cup Recall',
    exportedAt: new Date().toISOString(),
    points: metrics.score,
    maxPoints: metrics.maxScore,
    percentile: metrics.percentile,
    rating: metrics.rating.title,
    exactScores: metrics.exact,
    correctWinners: metrics.calls,
    elapsedSeconds,
    matches: fixtureOrder.map((match) => {
      const guess = guesses[match.id]
      const result = metrics.results.find((entry) => entry.match.id === match.id)?.result

      return {
        matchNumber: fixtureOrder.findIndex((item) => item.id === match.id) + 1,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        guessedScore: `${guess.home}-${guess.away}`,
        actualScore: `${match.homeScore}-${match.awayScore}`,
        points: result?.points ?? 0,
        exact: result?.exact ?? false,
        correctOutcome: result?.outcome ?? false,
      }
    }),
  }
}

function CompletionScreen({ metrics, elapsedSeconds, onReset, onShare, onExport, shareState, exportState }) {
  return (
    <section className="completion-screen">
      <p className="screen-title">WORLD CUP RECALL</p>
      <h2 className="hero-title">WORLD CUP RECALL</h2>
      <p className="completion-points-label">Points</p>
      <h1>{metrics.score} / {metrics.maxScore}</h1>
      <p className="completion-rank">Top {100 - metrics.percentile}%</p>

      <div className="completion-grid">
        <div>
          <span>Exact Scores</span>
          <strong>{metrics.exact}</strong>
        </div>
        <div>
          <span>Correct Winners</span>
          <strong>{metrics.calls}</strong>
        </div>
        <div>
          <span>Best Group</span>
          <strong>{metrics.bestGroup ? `Group ${metrics.bestGroup.group}` : 'N/A'}</strong>
        </div>
        <div>
          <span>Toughest Group</span>
          <strong>{metrics.worstGroup ? `Group ${metrics.worstGroup.group}` : 'N/A'}</strong>
        </div>
        <div>
          <span>Time</span>
          <strong>{formatElapsedTime(elapsedSeconds)}</strong>
        </div>
        <div>
          <span>Rating</span>
          <strong>{metrics.rating.title}</strong>
        </div>
      </div>

      <p className="completion-note">{metrics.rating.note}</p>

      <div className="completion-actions">
        <button className="primary-button" onClick={onReset}>Play Again</button>
        <button className="secondary-button" onClick={onShare}>Share Results</button>
        <button className="secondary-button" onClick={onExport}>Export Results</button>
      </div>

      <p className="share-feedback">
        {shareState === 'shared' && 'Shared'}
        {shareState === 'copied' && 'Copied share text'}
        {shareState === 'error' && 'Share failed'}
        {exportState === 'saved' && 'Exported results file'}
        {exportState === 'error' && 'Export failed'}
      </p>
    </section>
  )
}

export default function App() {
  const [initialState] = useState(() => restoreGameState())
  const [fixtureOrder, setFixtureOrder] = useState(initialState.fixtureOrder)
  const [guesses, setGuesses] = useState(initialState.guesses)
  const [lockedMatches, setLockedMatches] = useState(initialState.lockedMatches)
  const [activeIndex, setActiveIndex] = useState(initialState.activeIndex)
  const [elapsedSeconds, setElapsedSeconds] = useState(initialState.elapsedSeconds)
  const [shareState, setShareState] = useState('idle')
  const [exportState, setExportState] = useState('idle')
  const [revealMatchId, setRevealMatchId] = useState(null)
  const homeInputRef = useRef(null)
  const awayInputRef = useRef(null)

  function handleChange(matchId, side, value) {
    if (lockedMatches[matchId]) {
      return
    }

    const trimmed = value.replace(/\D/g, '').slice(0, 1)
    setGuesses((current) => ({
      ...current,
      [matchId]: {
        ...current[matchId],
        [side]: trimmed,
      },
    }))
  }

  function resetGame() {
    const nextState = createDefaultGameState()
    setFixtureOrder(nextState.fixtureOrder)
    setGuesses(nextState.guesses)
    setLockedMatches(nextState.lockedMatches)
    setActiveIndex(nextState.activeIndex)
    setElapsedSeconds(nextState.elapsedSeconds)
    setShareState('idle')
    setExportState('idle')
    setRevealMatchId(null)
  }

  const metrics = useMemo(() => {
    const results = fixtureOrder.map((match) => ({
      match,
      result: scorePrediction(match, guesses[match.id]),
      locked: Boolean(lockedMatches[match.id]),
    }))

    const lockedResults = results.filter(({ locked }) => locked)
    const score = lockedResults.reduce((total, item) => total + item.result.points, 0)
    const maxScore = fixtureOrder.length * 7
    const exact = lockedResults.filter(({ result }) => result.exact).length
    const calls = lockedResults.filter(({ result }) => result.outcome).length
    const percentile = computePercentile(score, maxScore)
    const rating = buildRating(percentile)
    const groupSummary = summarizeGroups(results)

    return {
      results,
      lockedCount: lockedResults.length,
      score,
      maxScore,
      exact,
      calls,
      percentile,
      rating,
      bestGroup: groupSummary.best,
      worstGroup: groupSummary.worst,
    }
  }, [fixtureOrder, guesses, lockedMatches])

  const activeEntry = metrics.results[activeIndex]
  const activeMatch = activeEntry.match
  const activeGuess = guesses[activeMatch.id]
  const activeResult = activeEntry.result
  const activeLocked = activeEntry.locked
  const revealEntry = revealMatchId === null
    ? null
    : metrics.results.find((entry) => entry.match.id === revealMatchId) ?? null
  const allRevealed = metrics.lockedCount === fixtureOrder.length
  const showCompletion = allRevealed && revealEntry === null
  const progressPercent = (metrics.lockedCount / fixtureOrder.length) * 100

  async function handleShareScores() {
    setExportState('idle')
    const summary = `I scored ${metrics.score}/${metrics.maxScore} on World Cup Recall. Exact scores: ${metrics.exact}. Correct winners: ${metrics.calls}. Time: ${formatElapsedTime(elapsedSeconds)}.`
    const shareText = `${summary} #WorldCupRecall`

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'World Cup Recall',
          text: shareText,
        })
        setShareState('shared')
        return
      }

      await navigator.clipboard.writeText(shareText)
      setShareState('copied')
    } catch {
      setShareState('error')
    }
  }

  function handleExportResults() {
    setShareState('idle')

    try {
      const payload = buildExportPayload({
        fixtureOrder,
        guesses,
        metrics,
        elapsedSeconds,
      })
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'world-cup-recall-results.json'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setExportState('saved')
    } catch {
      setExportState('error')
    }
  }

  function handleSubmitCurrentFixture() {
    if (!activeResult.complete || activeLocked || revealMatchId !== null) {
      return
    }

    setLockedMatches((current) => ({
      ...current,
      [activeMatch.id]: true,
    }))
    setRevealMatchId(activeMatch.id)
  }

  useEffect(() => {
    if (allRevealed) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1)
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [allRevealed])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fixtureOrderIds: fixtureOrder.map((match) => match.id),
      guesses,
      lockedMatches,
      activeIndex,
      elapsedSeconds,
    }))
  }, [activeIndex, elapsedSeconds, fixtureOrder, guesses, lockedMatches])

  useEffect(() => {
    if (revealEntry === null) {
      return undefined
    }

    const revealIndex = metrics.results.findIndex((entry) => entry.match.id === revealEntry.match.id)
    const timeoutId = window.setTimeout(() => {
      setRevealMatchId(null)
      if (revealIndex < fixtureOrder.length - 1) {
        setActiveIndex(revealIndex + 1)
      }
    }, 1100)

    return () => window.clearTimeout(timeoutId)
  }, [fixtureOrder.length, metrics.results, revealEntry])

  useEffect(() => {
    if (revealEntry || activeLocked) {
      return
    }

    const target = activeGuess.home === '' ? homeInputRef.current : awayInputRef.current
    target?.focus()
    target?.select?.()
  }, [activeGuess.home, activeLocked, activeIndex, revealEntry])

  function handleHomeKeyDown(event) {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    awayInputRef.current?.focus()
    awayInputRef.current?.select?.()
  }

  function handleAwayKeyDown(event) {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    handleSubmitCurrentFixture()
  }

  if (showCompletion) {
    return (
      <main className="app-shell app-shell-complete">
        <div className="background-wash" />
        <CompletionScreen
          metrics={metrics}
          elapsedSeconds={elapsedSeconds}
          onReset={resetGame}
          onShare={handleShareScores}
          onExport={handleExportResults}
          shareState={shareState}
          exportState={exportState}
        />
      </main>
    )
  }

  const revealCopy = revealEntry ? getRevealCopy(revealEntry.result) : null

  return (
    <main className="app-shell">
      <div className="background-wash" />

      <header className="game-header">
        <div>
          <p className="screen-title">WORLD CUP RECALL</p>
          <h1 className="hero-title">WORLD CUP RECALL</h1>
        </div>
        <p className="match-counter">Match {activeIndex + 1} / {fixtureOrder.length}</p>
      </header>

      <AdSlot client={ADSENSE_CLIENT} slot={ADSENSE_SLOT} className="top-ad-slot" />

      <section className="game-layout">
        <aside className="progress-rail" aria-label="Match progress">
          <div className="progress-copy">
            <span>{metrics.lockedCount} complete</span>
            <strong>{fixtureOrder.length - metrics.lockedCount} left</strong>
          </div>

          <div className="progress-bar" aria-hidden="true">
            <span style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="fixture-grid" aria-hidden="true">
            {metrics.results.map((entry, index) => (
              <span
                key={entry.match.id}
                className={`fixture-cell ${getProgressTone(entry, index, activeIndex)}`}
              />
            ))}
          </div>
        </aside>

        <section className="match-stage">
          <article className={`match-card ${revealEntry ? 'is-revealing' : ''}`}>
            {revealEntry ? (
              <div className={`reveal-card ${revealCopy.tone}`}>
                <p>{revealCopy.title}</p>
                <h1>{revealEntry.match.homeTeam} {revealEntry.match.homeScore} - {revealEntry.match.awayScore} {revealEntry.match.awayTeam}</h1>
                <strong>+{revealEntry.result.points} points</strong>
              </div>
            ) : (
              <>
                <p className="match-stage-label">{formatMatchStage(activeMatch.group)}</p>
                <div className="score-row">
                  <TeamInput
                    team={activeMatch.homeTeam}
                    code={activeMatch.homeCode}
                    value={activeGuess.home}
                    onChange={(event) => handleChange(activeMatch.id, 'home', event.target.value)}
                    onKeyDown={handleHomeKeyDown}
                    inputRef={homeInputRef}
                    disabled={false}
                  />

                  <div className="match-divider">FT</div>

                  <TeamInput
                    team={activeMatch.awayTeam}
                    code={activeMatch.awayCode}
                    value={activeGuess.away}
                    onChange={(event) => handleChange(activeMatch.id, 'away', event.target.value)}
                    onKeyDown={handleAwayKeyDown}
                    inputRef={awayInputRef}
                    disabled={false}
                  />
                </div>

                <button
                  className="primary-button submit-button"
                  disabled={!activeResult.complete}
                  onClick={handleSubmitCurrentFixture}
                >
                  Submit
                </button>
              </>
            )}
          </article>
        </section>
      </section>
    </main>
  )
}
