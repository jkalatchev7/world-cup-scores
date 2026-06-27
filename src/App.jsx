import { useEffect, useMemo, useRef, useState } from 'react'
import { matches } from './data'

const flagOverrides = {
  'GB-ENG': '🏴',
  'GB-SCT': '🏴',
}

const tiers = [
  { min: 93, title: 'World Cup Oracle', note: 'Deadly accurate. Your card looks like it came from the future.' },
  { min: 82, title: 'Knockout Lock', note: 'You are reading scorelines better than most of the field.' },
  { min: 68, title: 'Group Boss', note: 'Strong work. Plenty of sharp calls with only a few misses.' },
  { min: 50, title: 'Still Alive', note: 'You are landing some outcomes, but exact scores are slipping away.' },
  { min: 0, title: 'Chaos Agent', note: 'Unpredictable card. Spectacular confidence, mixed results.' },
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

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
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

function getStatusLabel(result) {
  if (!result.complete) {
    return 'Waiting for score'
  }
  if (result.exact) {
    return 'Exact hit'
  }
  if (result.outcome) {
    return 'Outcome right'
  }
  return 'Missed'
}

function getStatusTone(result) {
  if (!result.complete) {
    return 'idle'
  }
  if (result.exact) {
    return 'excellent'
  }
  if (result.outcome) {
    return 'good'
  }
  return 'bad'
}

function getChartTone(result) {
  if (!result.complete) {
    return 'idle'
  }
  if (result.exact) {
    return 'green'
  }
  if (result.outcome) {
    return 'yellow'
  }
  return 'red'
}

function TeamPanel({ side, team, code, value, onChange, onKeyDown, inputRef }) {
  return (
    <div className={`team-panel ${side}`}>
      <div className="crest-glow" />
      <div className="team-header">
        <span className="flag-badge" aria-hidden="true">{getFlagEmoji(code)}</span>
        <span className="team-label">{team}</span>
      </div>
      <input
        ref={inputRef}
        aria-label={`${team} score`}
        className="score-input"
        inputMode="numeric"
        min="0"
        max="9"
        type="number"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

function ResultPanel({ match, result, locked }) {
  if (!locked) {
    return (
      <div className="result-panel pending">
        <p>Call the scoreline, then reveal the full-time result for this fixture.</p>
      </div>
    )
  }

  return (
    <div className="result-panel">
      <div className={`status-chip ${getStatusTone(result)}`}>{getStatusLabel(result)}</div>
      <div className="fact-row">
        <span>Actual score</span>
        <strong>{match.homeScore} - {match.awayScore}</strong>
      </div>
      <div className="pill-row">
        <span className={`pill ${result.exact ? 'good' : 'bad'}`}>
          {result.exact ? 'Exact score' : 'Exact score missed'}
        </span>
        <span className={`pill ${result.outcome ? 'good' : 'bad'}`}>
          {result.outcome ? 'Winner or draw right' : 'Winner or draw wrong'}
        </span>
        <span className={`pill ${result.teamGoals > 0 ? 'good' : 'bad'}`}>
          {result.teamGoals === 2 ? 'Both team totals right' : result.teamGoals === 1 ? 'One team total right' : 'Team totals wrong'}
        </span>
      </div>
      <div className="points-panel">
        <span>Points from this match</span>
        <strong>{result.points}</strong>
      </div>
    </div>
  )
}

export default function App() {
  const [fixtureOrder, setFixtureOrder] = useState(() => shuffleArray(matches))
  const [guesses, setGuesses] = useState(() =>
    Object.fromEntries(matches.map((match) => [match.id, { home: '', away: '' }])),
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const homeInputRef = useRef(null)
  const awayInputRef = useRef(null)

  function handleChange(matchId, side, value) {
    const trimmed = value.slice(0, 1)
    setGuesses((current) => ({
      ...current,
      [matchId]: {
        ...current[matchId],
        [side]: trimmed,
      },
    }))
  }

  function handleNext() {
    setActiveIndex((current) => Math.min(fixtureOrder.length - 1, current + 1))
  }

  function handlePrev() {
    setActiveIndex((current) => Math.max(0, current - 1))
  }

  function handleJump(index) {
    setActiveIndex(index)
  }

  function handleReset() {
    setFixtureOrder(shuffleArray(matches))
    setGuesses(Object.fromEntries(matches.map((match) => [match.id, { home: '', away: '' }])))
    setActiveIndex(0)
    setElapsedSeconds(0)
  }

  const metrics = useMemo(() => {
    const results = fixtureOrder.map((match) => ({
      match,
      result: scorePrediction(match, guesses[match.id]),
    }))

    const completed = results.filter(({ result }) => result.complete)
    const allGuessed = completed.length === fixtureOrder.length
    const scored = allGuessed ? completed : []
    const score = scored.reduce((total, item) => total + item.result.points, 0)
    const maxScore = fixtureOrder.length * 7
    const exact = scored.filter(({ result }) => result.exact).length
    const calls = scored.filter(({ result }) => result.outcome).length
    const percentile = computePercentile(score, maxScore)
    const rating = buildRating(percentile)

    return {
      results,
      completedCount: completed.length,
      resultsUnlocked: allGuessed,
      score,
      maxScore,
      exact,
      calls,
      percentile,
      rating,
    }
  }, [fixtureOrder, guesses])

  const activeEntry = metrics.results[activeIndex]
  const activeMatch = activeEntry.match
  const activeGuess = guesses[activeMatch.id]
  const activeResult = activeEntry.result
  const isLast = activeIndex === fixtureOrder.length - 1
  const allRevealed = metrics.resultsUnlocked

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
    const target = activeGuess.home === '' ? homeInputRef.current : awayInputRef.current
    target?.focus()
    target?.select?.()
  }, [activeIndex, activeGuess.home])

  function handleHomeKeyDown(event) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      handlePrev()
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      handleNext()
      return
    }

    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    awayInputRef.current?.focus()
    awayInputRef.current?.select?.()
  }

  function handleAwayKeyDown(event) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      handlePrev()
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      handleNext()
      return
    }

    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    if (!activeResult.complete) {
      return
    }

    if (!isLast) {
      setActiveIndex((current) => current + 1)
    }
  }

  return (
    <main className="app-shell">
      <div className="background-orb orb-a" />
      <div className="background-orb orb-b" />
      <div className="background-orb orb-c" />

      <section className="hero-panel">
        <div className="hero-copy">
          <h1>World Cup 2026 Score Predictor</h1>
        </div>
        <div className="top-logo" aria-label="World Cup Predictor logo">
          <span className="logo-ball">O</span>
          <span className="logo-wordmark">WC26</span>
        </div>
      </section>

      <section className="experience-layout">
        <aside className="progress-panel">
          <div className="progress-copy">
            <p className="section-label">Matchday Progress</p>
            <h2>Work through the shuffled fixtures</h2>
          </div>

          <div className="progress-bar">
            <span style={{ width: `${(metrics.lockedCount / fixtureOrder.length) * 100}%` }} />
          </div>

          <div className="match-dots">
            {metrics.results.map((entry, index) => (
              <button
                key={entry.match.id}
                className={`match-dot ${index === activeIndex ? 'active' : ''} ${metrics.resultsUnlocked ? getChartTone(entry.result) : entry.result.complete ? 'filled' : 'idle'}`}
                onClick={() => handleJump(index)}
                aria-label={`Open match ${index + 1}`}
              >
                <span>{index + 1}</span>
                <small>{entry.match.group}</small>
              </button>
            ))}
          </div>

            <div className="rating-card">
            <p className="section-label">Leaderboard Pulse</p>
            <h3>{metrics.resultsUnlocked ? metrics.rating.title : 'Results locked'}</h3>
            <div className="ranking-line">
              {metrics.resultsUnlocked ? `Top ${100 - metrics.percentile}%` : `${metrics.completedCount}/${fixtureOrder.length} picked`}
            </div>
            <div className="leaderboard-time">Time: {formatElapsedTime(elapsedSeconds)}</div>
            <p>{metrics.resultsUnlocked ? metrics.rating.note : 'Finish every fixture before the scorecard opens.'}</p>
          </div>

          <div className="rules-card">
            <p className="section-label">How Scoring Works</p>
            <div>Exact score: 7 pts</div>
            <div>Correct winner or draw: 2 pts</div>
            <div>Correct team goals: 1 pt each</div>
            <div>Correct goal difference without exact score: +1 pt</div>
          </div>
        </aside>

        <section className="match-stage">
          <div className="stage-topbar">
            <div>
              <p className="section-label">Fixture {activeIndex + 1} of {fixtureOrder.length}</p>
              <h2>Group {activeMatch.group} • {formatDate(activeMatch.date)}</h2>
            </div>
            <div className={`stage-badge ${metrics.resultsUnlocked ? 'revealed' : 'live'}`}>
              {metrics.resultsUnlocked ? 'Scorecard Open' : 'Prediction Mode'}
            </div>
          </div>

          <article className="featured-match">
            <div className="fixture-banner">
              <span>FIFA World Cup 26</span>
              <span>90 minutes • no extra hints</span>
            </div>

            <div className="team-grid">
              <TeamPanel
                side="home"
                team={activeMatch.homeTeam}
                code={activeMatch.homeCode}
                value={activeGuess.home}
                onChange={(event) => handleChange(activeMatch.id, 'home', event.target.value)}
                onKeyDown={handleHomeKeyDown}
                inputRef={homeInputRef}
              />

              <div className="versus-core">
                <div className="versus-ring">FT</div>
                <span>Predict the full-time score</span>
              </div>

              <TeamPanel
                side="away"
                team={activeMatch.awayTeam}
                code={activeMatch.awayCode}
                value={activeGuess.away}
                onChange={(event) => handleChange(activeMatch.id, 'away', event.target.value)}
                onKeyDown={handleAwayKeyDown}
                inputRef={awayInputRef}
              />
            </div>

            <ResultPanel match={activeMatch} result={activeResult} locked={metrics.resultsUnlocked} />

            <div className="keyboard-hint">
              `Enter` saves this fixture. `←` and `→` move between fixtures.
            </div>
          </article>

          <section className="footer-panels">
            <div className="summary-card">
              <p className="section-label">Scorecard</p>
              <div className="bottom-score-hero">
                <div>
                  <span className="bottom-score-label">Tournament points</span>
                  <strong>{metrics.score}/{metrics.maxScore}</strong>
                </div>
                <div>
                  <span className="bottom-score-label">Projected finish</span>
                  <strong>Top {100 - metrics.percentile}%</strong>
                </div>
              </div>
              <div className="summary-grid">
                <div>
                  <span>Entered picks</span>
                  <strong>{metrics.completedCount}</strong>
                </div>
                <div>
                  <span>Scored picks</span>
                  <strong>{metrics.resultsUnlocked ? fixtureOrder.length : 0}</strong>
                </div>
                <div>
                  <span>Exact hits</span>
                  <strong>{metrics.exact}</strong>
                </div>
                <div>
                  <span>Table read</span>
                  <strong>{metrics.rating.title}</strong>
                </div>
                <div>
                  <span>Time</span>
                  <strong>{formatElapsedTime(elapsedSeconds)}</strong>
                </div>
                <div>
                  <span>Outcome calls</span>
                  <strong>{metrics.calls}</strong>
                </div>
              </div>
            </div>

            <div className="summary-card finale">
              <p className="section-label">Final Whistle</p>
              <h3>{allRevealed ? 'Full card scored' : 'Keep going'}</h3>
              <p>
                {allRevealed
                  ? `Final projection: top ${100 - metrics.percentile}% with ${metrics.score} points in ${formatElapsedTime(elapsedSeconds)}.`
                  : 'Results stay hidden until every fixture has a saved prediction.'}
              </p>
              <button className="ghost" onClick={handleReset}>Reset everything</button>
            </div>
          </section>
        </section>
      </section>
    </main>
  )
}
