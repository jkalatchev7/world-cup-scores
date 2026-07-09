import { useEffect, useMemo, useRef, useState } from 'react'
import { matches } from './data'
import { useLeaderboard } from './useLeaderboard'

const STORAGE_KEY = 'world-cup-recall-progress-v1'
const PRACTICE_STORAGE_KEY = 'world-cup-recall-practice-v1'
const TAB_PATHS = {
  play: '/',
  practice: '/practice',
  leaderboard: '/leaderboard',
}

function getRouteState(pathname) {
  const attemptMatch = pathname.match(/^\/attempt\/([0-9a-f-]+)$/i)

  if (attemptMatch) {
    return {
      mode: 'attemptReview',
      shareToken: attemptMatch[1],
    }
  }

  if (pathname === '/practice') {
    return { mode: 'practice', shareToken: null }
  }

  if (pathname === '/leaderboard') {
    return { mode: 'leaderboard', shareToken: null }
  }

  return { mode: 'play', shareToken: null }
}

function getTabFromRoute(route) {
  return route.mode === 'attemptReview' ? 'play' : route.mode
}

const flagOverrides = {
  // Subdivision flags need Unicode tag sequences instead of ISO alpha-2 pairs.
  'GB-ENG': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'GB-SCT': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
}

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

function getPracticeStageLabel(card) {
  return card.group.length === 1 ? 'Group Stage' : card.group
}

function getPracticeMeta(card) {
  const year = card.date ? new Date(card.date).getUTCFullYear() : null
  const stage = getPracticeStageLabel(card)

  return year ? `${year} ${stage}` : stage
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

function getRandomScoreDigit() {
  return String(Math.floor(Math.random() * 8))
}

function restorePracticeState() {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(PRACTICE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
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

function getWeaknessWeight(result) {
  if (!result.complete) {
    return 5
  }
  if (result.exact) {
    return 1
  }
  if (result.outcome) {
    return 3
  }
  if (result.points > 0) {
    return 4
  }
  return 5
}

function getInitialPracticeCard(result) {
  return {
    interval: 0,
    ease: 2.5,
    dueStep: 0,
    reviews: 0,
    retired: false,
    lapses: result.exact ? 0 : 1,
    lastRating: result.complete && result.exact ? 'good' : 'again',
    lastScore: result.points,
    weakness: getWeaknessWeight(result),
  }
}

function applyPracticeRating(card, rating, result) {
  const next = {
    ...card,
    reviews: (card.reviews ?? 0) + 1,
    lastRating: rating,
    lastScore: result.points,
  }

  if (rating === 'again') {
    next.interval = 0
    next.dueStep = (card.dueStep ?? 0) + 1
    next.ease = Math.max(1.4, (card.ease ?? 2.5) - 0.2)
    next.lapses = (card.lapses ?? 0) + 1
    next.retired = false
    next.weakness = Math.min(6, Math.max(getWeaknessWeight(result), (card.weakness ?? 0) + 1))
    return next
  }

  if (rating === 'hard') {
    next.interval = Math.max(1, Math.round(Math.max(1, card.interval ?? 1) * 1.2))
    next.dueStep = (card.dueStep ?? 0) + 3
    next.ease = Math.max(1.5, (card.ease ?? 2.5) - 0.15)
    next.lapses = card.lapses ?? 0
    next.retired = false
    next.weakness = Math.max(2, (card.weakness ?? getWeaknessWeight(result)) - 1)
    return next
  }

  if (rating === 'easy') {
    const base = card.interval && card.interval > 0 ? card.interval : 2
    next.interval = Math.round(base * Math.max(2.2, (card.ease ?? 2.5) + 0.3))
    next.dueStep = (card.dueStep ?? 0) + 999
    next.ease = Math.min(3.4, (card.ease ?? 2.5) + 0.15)
    next.lapses = card.lapses ?? 0
    next.retired = true
    next.weakness = Math.max(1, (card.weakness ?? getWeaknessWeight(result)) - 2)
    return next
  }

  const base = card.interval && card.interval > 0 ? card.interval : 1
  next.interval = Math.round(base * Math.max(1.8, card.ease ?? 2.5))
  next.dueStep = (card.dueStep ?? 0) + 6
  next.ease = card.ease ?? 2.5
  next.lapses = card.lapses ?? 0
  next.retired = false
  next.weakness = Math.max(1, (card.weakness ?? getWeaknessWeight(result)) - 1)
  return next
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
        autoComplete="off"
        enterKeyHint="done"
        inputMode="numeric"
        pattern="[0-9]*"
        type="tel"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

function buildExportPayload({ fixtureOrder, guesses, metrics, elapsedSeconds }) {
  const reviewItems = fixtureOrder.map((match, index) => {
    const guess = guesses[match.id]
    const result = metrics.results.find((entry) => entry.match.id === match.id)?.result

    return {
      matchId: match.id,
      matchNumber: index + 1,
      stage: match.group,
      date: match.date,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeCode: match.homeCode,
      awayCode: match.awayCode,
      guessedHome: guess.home,
      guessedAway: guess.away,
      actualHome: match.homeScore,
      actualAway: match.awayScore,
      guessedScore: `${guess.home}-${guess.away}`,
      actualScore: `${match.homeScore}-${match.awayScore}`,
      points: result?.points ?? 0,
      exact: result?.exact ?? false,
      correctOutcome: result?.outcome ?? false,
    }
  })

  return {
    game: 'World Cup Recall',
    exportedAt: new Date().toISOString(),
    points: metrics.score,
    maxPoints: metrics.maxScore,
    percentile: metrics.percentile,
    exactScores: metrics.exact,
    correctWinners: metrics.calls,
    elapsedSeconds,
    matches: reviewItems,
  }
}

function getAttemptReviewLink(shareToken) {
  return `${window.location.origin}/attempt/${shareToken}`
}

function getReviewResultTone(entry) {
  if (entry.exact) {
    return 'exact'
  }
  if (entry.correctOutcome) {
    return 'good'
  }
  return 'miss'
}

function formatAttemptsLabel(attempts) {
  return `${attempts} attempt${attempts === 1 ? '' : 's'}`
}

function formatBestAttemptLabel(attemptIndex) {
  return `Attempt #${attemptIndex ?? 1}`
}

function formatPercentileTop(percentile) {
  if (!Number.isFinite(percentile)) {
    return null
  }

  const topPercent = Math.max(0, 100 - percentile)
  const rounded = topPercent % 1 === 0 ? topPercent.toFixed(0) : topPercent.toFixed(2)
  return `Top ${rounded}%`
}

function getResultStatusLabel(entry) {
  if (entry.exact) {
    return 'Exact score'
  }
  if (entry.correctOutcome) {
    return 'Correct outcome'
  }
  return 'Miss'
}

function formatReviewTeams(entry) {
  return `${entry.homeTeam} vs ${entry.awayTeam}`
}

function formatReviewActualLabel(entry) {
  return `Actual ${entry.actualScore}`
}

function ReviewList({ matches, title, description, collapsible = false }) {
  const [isOpen, setIsOpen] = useState(!collapsible)

  return (
    <section className="leaderboard-panel">
      <div className="attempt-review-header">
        <div className="leaderboard-copy">
          <h3>Detailed review</h3>
          <p>{description}</p>
        </div>
        {collapsible ? (
          <button
            aria-expanded={isOpen}
            className="attempt-review-section-toggle"
            onClick={() => setIsOpen((current) => !current)}
            type="button"
          >
            {isOpen ? 'Hide review' : 'Show review'}
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div className="attempt-review-list">
          {matches.map((entry) => {
            const matchKey = `${entry.matchId}-${entry.matchNumber}`

            return (
              <article className={`attempt-review-row is-${getReviewResultTone(entry)}`} key={matchKey}>
              <div className="attempt-review-match">
                <span className="attempt-review-index">#{entry.matchNumber}</span>
                <div className="attempt-review-match-copy">
                  <strong>{formatReviewTeams(entry)}</strong>
                  <span className="attempt-review-stage">{formatMatchStage(entry.stage)}</span>
                </div>
              </div>
              <div className="attempt-review-score">
                <span>Pick {entry.guessedScore}</span>
                <strong>Actual {entry.actualScore}</strong>
              </div>
              <div className="attempt-review-points">
                <strong>{entry.points} pts</strong>
                <span className="attempt-review-status">{getResultStatusLabel(entry)}</span>
              </div>
            </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function CompletionScreen({
  metrics,
  reviewMatches,
  reviewUrl,
  displayedPercentile,
  percentileSource,
  savedAttempt,
  elapsedSeconds,
  onReset,
  onCopyLink,
  shareState,
  leaderboardForm,
  leaderboardState,
  leaderboardError,
  onLeaderboardChange,
  onSaveLeaderboard,
}) {
  const hasSavedAttempt = Boolean(savedAttempt) && leaderboardState === 'saved'

  return (
    <section className="completion-screen">
      <p className="screen-title">WORLD CUP RECALL</p>
      <h2 className="hero-title">WORLD CUP RECALL</h2>
      <p className="completion-points-label">Points</p>
      <h1>{metrics.score} / {metrics.maxScore}</h1>
      <p className="completion-rank">{formatPercentileTop(displayedPercentile) ?? 'Save your score to see percentile'}</p>

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
          <strong>{metrics.bestGroup ? formatMatchStage(metrics.bestGroup.group) : 'N/A'}</strong>
        </div>
        <div>
          <span>Toughest Group</span>
          <strong>{metrics.worstGroup ? formatMatchStage(metrics.worstGroup.group) : 'N/A'}</strong>
        </div>
        <div>
          <span>Time</span>
          <strong>{formatElapsedTime(elapsedSeconds)}</strong>
        </div>
      </div>

      <section className="save-score-spotlight">
        <div className="save-score-badge">Save your score before replay</div>
        <div className="leaderboard-save leaderboard-save-hero">
          <div className="leaderboard-copy">
            <p className="screen-title">Save Score</p>
            <h3>{hasSavedAttempt ? 'Result saved' : 'Lock in your result'}</h3>
            {hasSavedAttempt && savedAttempt?.attempt_index ? (
              <p>{formatBestAttemptLabel(savedAttempt.attempt_index)}</p>
            ) : null}
            {!hasSavedAttempt ? (
              <p>
                Email is used privately and not shown.
                {percentileSource === 'backend' && savedAttempt
                  ? ` Saved as attempt ${savedAttempt.attempt_index}.`
                  : ' Percentile becomes exact after saving.'}
              </p>
            ) : null}
          </div>

          {!hasSavedAttempt ? (
            <div className="leaderboard-save-row">
              <div className="leaderboard-form leaderboard-form-hero">
                <input
                  aria-label="Name"
                  className="leaderboard-input"
                  name="name"
                  placeholder="Name"
                  type="text"
                  value={leaderboardForm.name}
                  onChange={onLeaderboardChange}
                />
                <input
                  aria-label="Email"
                  className="leaderboard-input"
                  name="email"
                  placeholder="Email"
                  type="email"
                  value={leaderboardForm.email}
                  onChange={onLeaderboardChange}
                />
              </div>
              <button className="primary-button leaderboard-button leaderboard-button-hero" onClick={onSaveLeaderboard}>Save Score</button>
            </div>
          ) : null}
          <p className="leaderboard-feedback">
            {leaderboardState === 'saved' && savedAttempt && `Result saved as ${formatBestAttemptLabel(savedAttempt.attempt_index)}`}
            {leaderboardState === 'invalid' && 'Enter a valid name and email'}
            {leaderboardState === 'error' && (leaderboardError || 'Could not save leaderboard entry')}
          </p>
          {reviewUrl ? (
            <div className="share-link-panel">
              <p className="share-link-label">Copy link to share with friends</p>
              <div className="share-link-actions">
                <button className="secondary-button" type="button" onClick={onCopyLink}>Copy Link</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <ReviewList
        title="Exam Review"
        description="Open any result to see the prediction, the actual score, and whether you were right or wrong."
        matches={reviewMatches}
        collapsible
      />

      <div className="completion-actions">
        <button className="primary-button" onClick={onReset}>Play Again</button>
      </div>

      <p className="share-feedback">
        {shareState === 'shared' && 'Shared'}
        {shareState === 'copied' && 'Copied review link'}
        {shareState === 'needs-save' && 'Save your score first to create a review link'}
        {shareState === 'error' && 'Share failed'}
      </p>
    </section>
  )
}

function PracticeFace({ card, revealed }) {
  const hiddenScore = `${card.homeScore} - ${card.awayScore}`
  const metaLabel = getPracticeMeta(card)

  return (
    <div className={`practice-face ${revealed ? 'is-back' : 'is-front'}`}>
      <div className="practice-matchup">
        <div className="practice-team">
          <span className="practice-flag" aria-hidden="true">{getFlagEmoji(card.homeCode)}</span>
          <strong>{card.homeTeam}</strong>
        </div>
        <span className={`practice-versus ${revealed ? 'is-score' : ''}`}>{revealed ? hiddenScore : 'vs'}</span>
        <div className="practice-team">
          <span className="practice-flag" aria-hidden="true">{getFlagEmoji(card.awayCode)}</span>
          <strong>{card.awayTeam}</strong>
        </div>
      </div>
      <div className="practice-meta-block">
        <p className="practice-meta">{metaLabel}</p>
      </div>
      <p>{revealed ? `Your original result: ${card.resultLabel}` : 'Click to reveal score.'}</p>
    </div>
  )
}

function PracticeScreen({
  card,
  totalCount,
  learnedCount,
  weakCount,
  onFlip,
  onRate,
  showingAnswer,
  selectedRatingIndex,
  onSelectRatingIndex,
  onRatingKeyDown,
  onJumpToPlay,
}) {
  const ratingOptions = [
    { id: 'again', label: 'Again', tone: 'secondary-button' },
    { id: 'hard', label: 'Hard', tone: 'secondary-button' },
    { id: 'good', label: 'Good', tone: 'primary-button' },
    { id: 'easy', label: 'Easy', tone: 'primary-button' },
  ]
  const weakPercent = totalCount ? (weakCount / totalCount) * 100 : 0
  const stabilizedPercent = totalCount ? (learnedCount / totalCount) * 100 : 0
  const activePercent = totalCount ? ((totalCount - weakCount - learnedCount) / totalCount) * 100 : 0

  if (!card) {
    return (
      <section className="practice-shell">
        <article className="match-card practice-card">
          <div className="practice-empty">
            <p className="screen-title">Practice Mode</p>
            <h2>No weak matches yet</h2>
            <p>Play through matches first. Misses and near-misses will show up here for review.</p>
            <button className="primary-button" onClick={onJumpToPlay}>Go To Play</button>
          </div>
        </article>
      </section>
    )
  }

  return (
    <section className="practice-shell">
      <aside className="progress-rail practice-rail">
        <div className="practice-stats-grid">
          <div className="practice-stat-card">
            <div className="progress-copy">
              <span>Total cards</span>
              <strong>{totalCount}</strong>
            </div>
            <div className="practice-stat-bar is-neutral" aria-hidden="true">
              <span style={{ width: '100%' }} />
            </div>
          </div>
          <div className="practice-stat-card is-weak">
            <div className="progress-copy">
              <span>Weak cards</span>
              <strong>{weakCount}</strong>
            </div>
            <div className="practice-stat-bar is-weak" aria-hidden="true">
              <span style={{ width: `${weakPercent}%` }} />
            </div>
          </div>
          <div className="practice-stat-card is-active">
            <div className="progress-copy">
              <span>Still practicing</span>
              <strong>{Math.max(0, totalCount - weakCount - learnedCount)}</strong>
            </div>
            <div className="practice-stat-bar is-active" aria-hidden="true">
              <span style={{ width: `${activePercent}%` }} />
            </div>
          </div>
          <div className="practice-stat-card is-stable">
            <div className="progress-copy">
              <span>Learned</span>
              <strong>{learnedCount}</strong>
            </div>
            <div className="practice-stat-bar is-stable" aria-hidden="true">
              <span style={{ width: `${stabilizedPercent}%` }} />
            </div>
          </div>
        </div>
        <p className="practice-note">Reveal the score, then grade how hard it was to remember.</p>
      </aside>

      <article className="match-card practice-card">
        <button
          className={`practice-flip-card ${showingAnswer ? 'is-flipped' : ''}`}
          type="button"
          onClick={onFlip}
          aria-label={showingAnswer ? 'Flip card to hide answer' : 'Flip card to reveal answer'}
        >
          <div className="practice-flip-inner">
            <PracticeFace card={card} revealed={false} />
            <PracticeFace card={card} revealed />
          </div>
        </button>

        <div
          className={`practice-actions ${showingAnswer ? 'is-visible' : ''}`}
          onKeyDown={onRatingKeyDown}
          role="toolbar"
          aria-label="Practice difficulty"
        >
          {ratingOptions.map((option, index) => (
            <button
              key={option.id}
              className={`${option.tone} ${selectedRatingIndex === index ? 'is-selected' : ''}`.trim()}
              disabled={!showingAnswer}
              tabIndex={showingAnswer && selectedRatingIndex === index ? 0 : -1}
              onClick={() => onRate(option.id)}
              onFocus={() => onSelectRatingIndex(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </article>
    </section>
  )
}

function LeaderboardScreen({ leaderboard, onJumpToPlay }) {
  return (
    <section className="leaderboard-screen">
      <article className="completion-screen leaderboard-screen-card">
        <div className="leaderboard-copy">
          <p className="screen-title">Leaderboard</p>
          <h2>Top scores</h2>
          <p>Higher score wins. Matching scores are ordered by faster time.</p>
        </div>

        {leaderboard.length > 0 ? (
          <div className="leaderboard-rows">
            {leaderboard.map((entry, index) => (
              <div className="leaderboard-row" key={`${entry.email}-${entry.createdAt}`}>
                <span className="leaderboard-rank">#{index + 1}</span>
                <div className="leaderboard-person">
                  <strong>{entry.name}</strong>
                  <span>{formatBestAttemptLabel(entry.attemptIndex)}</span>
                </div>
                <div className="leaderboard-score">
                  <strong>{entry.points} pts</strong>
                  <span>{formatElapsedTime(entry.elapsedSeconds)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="leaderboard-empty">No saved scores yet.</p>
        )}

        <div className="completion-actions">
          <button className="primary-button" onClick={onJumpToPlay}>Back To Play</button>
        </div>
      </article>
    </section>
  )
}

function AttemptReviewScreen({ attempt, reviewState, onCopyLink, onBackToPlay, shareState }) {
  const reviewPayload = attempt?.metadata?.reviewPayload ?? null
  const reviewMatches = Array.isArray(reviewPayload?.matches) ? reviewPayload.matches : []
  const reviewBestGroup = reviewPayload?.bestGroup ?? null
  const reviewWorstGroup = reviewPayload?.worstGroup ?? null

  if (reviewState === 'loading') {
    return (
      <main className="app-shell app-shell-complete">
        <div className="background-wash" />
        <section className="completion-screen leaderboard-screen-card">
          <p className="screen-title">Saved Attempt</p>
          <h2>Loading review</h2>
        </section>
      </main>
    )
  }

  if (reviewState === 'error' || !attempt || !reviewPayload) {
    return (
      <main className="app-shell app-shell-complete">
        <div className="background-wash" />
        <section className="completion-screen leaderboard-screen-card">
          <p className="screen-title">Saved Attempt</p>
          <h2>Review unavailable</h2>
          <p>This shared attempt could not be loaded.</p>
          <div className="completion-actions">
            <button className="primary-button" onClick={onBackToPlay}>Back To Play</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell app-shell-complete">
      <div className="background-wash" />
      <section className="completion-screen leaderboard-screen-card attempt-review-screen">
        <p className="screen-title">Saved Attempt</p>
        <h2>{attempt.name}</h2>
        <p className="completion-note">{formatBestAttemptLabel(attempt.attemptIndex)}</p>
        <p className="completion-rank">{formatPercentileTop(attempt.percentile) ?? 'Saved result'}</p>

        <div className="completion-grid">
          <div>
            <span>Points</span>
            <strong>{attempt.points} / {attempt.maxPoints}</strong>
          </div>
          <div>
            <span>Exact Scores</span>
            <strong>{attempt.exactScores}</strong>
          </div>
          <div>
            <span>Correct Winners</span>
            <strong>{attempt.correctWinners}</strong>
          </div>
          <div>
            <span>Time</span>
            <strong>{formatElapsedTime(attempt.elapsedSeconds)}</strong>
          </div>
          <div>
            <span>Best Group</span>
            <strong>{reviewBestGroup ? formatMatchStage(reviewBestGroup) : 'N/A'}</strong>
          </div>
          <div>
            <span>Toughest Group</span>
            <strong>{reviewWorstGroup ? formatMatchStage(reviewWorstGroup) : 'N/A'}</strong>
          </div>
        </div>
        <ReviewList
          title="Match Review"
          description="Exact scores, right outcome calls, and misses are all preserved from the saved attempt."
          matches={reviewMatches}
          collapsible
        />

        <div className="completion-actions">
          <button className="primary-button" onClick={onBackToPlay}>Back To Play</button>
          <button className="secondary-button" onClick={onCopyLink}>Copy Share Link</button>
        </div>

        <p className="share-feedback">
          {shareState === 'copied' && 'Copied share link'}
          {shareState === 'shared' && 'Shared'}
          {shareState === 'error' && 'Share failed'}
        </p>
      </section>
    </main>
  )
}

export default function App() {
  const [initialState] = useState(() => restoreGameState())
  const [initialPracticeState] = useState(() => restorePracticeState())
  const [fixtureOrder, setFixtureOrder] = useState(initialState.fixtureOrder)
  const [guesses, setGuesses] = useState(initialState.guesses)
  const [lockedMatches, setLockedMatches] = useState(initialState.lockedMatches)
  const [activeIndex, setActiveIndex] = useState(initialState.activeIndex)
  const [elapsedSeconds, setElapsedSeconds] = useState(initialState.elapsedSeconds)
  const [route, setRoute] = useState(() => getRouteState(window.location.pathname))
  const [practiceCards, setPracticeCards] = useState(initialPracticeState)
  const [practiceStep, setPracticeStep] = useState(0)
  const [practiceRevealId, setPracticeRevealId] = useState(null)
  const [selectedRatingIndex, setSelectedRatingIndex] = useState(2)
  const [shareState, setShareState] = useState('idle')
  const [revealMatchId, setRevealMatchId] = useState(null)
  const [sharedAttempt, setSharedAttempt] = useState(null)
  const [sharedAttemptState, setSharedAttemptState] = useState('idle')
  const homeInputRef = useRef(null)
  const awayInputRef = useRef(null)
  const {
    leaderboard,
    leaderboardForm,
    leaderboardState,
    leaderboardError,
    savedAttempt,
    setLeaderboardState,
    handleLeaderboardChange,
    saveLeaderboardEntry,
    loadSharedAttempt,
  } = useLeaderboard()

  const activeTab = getTabFromRoute(route)

  function navigateToTab(nextTab) {
    const nextPath = TAB_PATHS[nextTab] ?? TAB_PATHS.play
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }
    setRoute(getRouteState(nextPath))
  }

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
    navigateToTab('play')
    setPracticeStep(0)
    setLeaderboardState('idle')
    setShareState('idle')
    setRevealMatchId(null)
  }

  function randomizeRest() {
    const nextGuesses = { ...guesses }
    const nextLockedMatches = { ...lockedMatches }
    const nextPracticeCards = {}

    fixtureOrder.forEach((match) => {
      if (nextLockedMatches[match.id]) {
        return
      }

      const guess = {
        home: getRandomScoreDigit(),
        away: getRandomScoreDigit(),
      }
      nextGuesses[match.id] = guess
      nextLockedMatches[match.id] = true
      nextPracticeCards[match.id] = getInitialPracticeCard(scorePrediction(match, guess))
    })

    setGuesses(nextGuesses)
    setLockedMatches(nextLockedMatches)
    setPracticeCards((current) => ({
      ...current,
      ...nextPracticeCards,
    }))
    setRevealMatchId(null)
    setShareState('idle')
    setLeaderboardState('idle')
    navigateToTab('play')
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
    const groupSummary = summarizeGroups(results)

    return {
      results,
      lockedCount: lockedResults.length,
      score,
      maxScore,
      exact,
      calls,
      percentile,
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
  const showCompletion = route.mode === 'play' && allRevealed && revealEntry === null
  const progressPercent = (metrics.lockedCount / fixtureOrder.length) * 100
  const displayedPercentile = savedAttempt?.percentile ?? null
  const percentileSource = savedAttempt ? 'backend' : 'local'
  const reviewUrl = savedAttempt?.share_token ? getAttemptReviewLink(savedAttempt.share_token) : ''
  const reviewMatches = useMemo(() => (
    buildExportPayload({
      fixtureOrder,
      guesses,
      metrics,
      elapsedSeconds,
    }).matches
  ), [elapsedSeconds, fixtureOrder, guesses, metrics])

  const practiceDeck = useMemo(() => {
    return metrics.results
      .map(({ match, result, locked }) => {
        const savedCard = practiceCards[match.id] ?? getInitialPracticeCard(result)
        return {
          id: match.id,
          ...match,
          card: savedCard,
          weakness: Math.max(savedCard.weakness ?? 0, getWeaknessWeight(result)),
          resultLabel: !locked
            ? 'Not answered yet'
            : result.exact
              ? 'Exact score'
              : result.outcome
                ? 'Correct winner only'
                : result.points > 0
                  ? 'Close miss'
                  : 'Missed outright',
        }
      })
      .sort((left, right) => {
        if ((left.card.dueStep ?? 0) !== (right.card.dueStep ?? 0)) {
          return (left.card.dueStep ?? 0) - (right.card.dueStep ?? 0)
        }
        if (right.weakness !== left.weakness) {
          return right.weakness - left.weakness
        }
        if ((left.card.interval ?? 0) !== (right.card.interval ?? 0)) {
          return (left.card.interval ?? 0) - (right.card.interval ?? 0)
        }
        return (right.card.lapses ?? 0) - (left.card.lapses ?? 0)
      })
  }, [metrics.results, practiceCards])

  const activePracticeDeck = practiceDeck.filter((entry) => !entry.card.retired)
  const practiceCard = activePracticeDeck.find((entry) => (entry.card.dueStep ?? 0) <= practiceStep) ?? activePracticeDeck[0] ?? null
  const practiceShowingAnswer = practiceRevealId === practiceCard?.id
  const weakPracticeCount = activePracticeDeck.filter((entry) => entry.weakness >= 3).length
  const learnedPracticeCount = practiceDeck.length - activePracticeDeck.length

  async function handleSaveLeaderboard() {
    setShareState('idle')
    const reviewPayload = buildExportPayload({
      fixtureOrder,
      guesses,
      metrics,
      elapsedSeconds,
    })

    await saveLeaderboardEntry({
      name: leaderboardForm.name,
      email: leaderboardForm.email,
      points: metrics.score,
      maxPoints: metrics.maxScore,
      elapsedSeconds,
      exactScores: metrics.exact,
      correctWinners: metrics.calls,
      metadata: {
        bestGroup: metrics.bestGroup?.group ?? null,
        worstGroup: metrics.worstGroup?.group ?? null,
        reviewPayload: {
          ...reviewPayload,
          bestGroup: metrics.bestGroup?.group ?? null,
          worstGroup: metrics.worstGroup?.group ?? null,
        },
      },
    })
  }

  async function handleCopyReviewLink() {
    const shareToken = route.mode === 'attemptReview' ? route.shareToken : savedAttempt?.share_token

    if (!shareToken) {
      setShareState('needs-save')
      return
    }

    try {
      await navigator.clipboard.writeText(getAttemptReviewLink(shareToken))
      setShareState('copied')
    } catch {
      setShareState('error')
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
    setPracticeCards((current) => ({
      ...current,
      [activeMatch.id]: current[activeMatch.id] ?? getInitialPracticeCard(activeResult),
    }))
    setRevealMatchId(activeMatch.id)
  }

  function handlePracticeRating(rating) {
    if (!practiceCard) {
      return
    }

    const result = metrics.results.find((entry) => entry.match.id === practiceCard.id)?.result
    if (!result) {
      return
    }

    setPracticeCards((current) => ({
      ...current,
      [practiceCard.id]: applyPracticeRating(current[practiceCard.id] ?? getInitialPracticeCard(result), rating, result),
    }))
    setSelectedRatingIndex(2)
    setPracticeStep((current) => current + 1)
    setPracticeRevealId(null)
  }

  function handlePracticeRatingKeyDown(event) {
    if (!practiceShowingAnswer) {
      return
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedRatingIndex((current) => (current + 1) % 4)
      return
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedRatingIndex((current) => (current + 3) % 4)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handlePracticeRating(['again', 'hard', 'good', 'easy'][selectedRatingIndex])
    }
  }

  useEffect(() => {
    function syncRouteWithLocation() {
      setRoute(getRouteState(window.location.pathname))
    }

    window.addEventListener('popstate', syncRouteWithLocation)
    syncRouteWithLocation()

    return () => window.removeEventListener('popstate', syncRouteWithLocation)
  }, [])

  useEffect(() => {
    if (route.mode !== 'attemptReview' || !route.shareToken) {
      setSharedAttempt(null)
      setSharedAttemptState('idle')
      return
    }

    let cancelled = false
    setSharedAttemptState('loading')

    loadSharedAttempt(route.shareToken)
      .then((attempt) => {
        if (cancelled) {
          return
        }

        setSharedAttempt(attempt)
        setSharedAttemptState(attempt ? 'ready' : 'error')
      })
      .catch(() => {
        if (cancelled) {
          return
        }

        setSharedAttempt(null)
        setSharedAttemptState('error')
      })

    return () => {
      cancelled = true
    }
  }, [loadSharedAttempt, route.mode, route.shareToken])

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
    window.localStorage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(practiceCards))
  }, [practiceCards])

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
    if (activeTab !== 'play' || revealEntry || activeLocked) {
      return
    }

    const target = activeGuess.home === '' ? homeInputRef.current : awayInputRef.current
    target?.focus()
    target?.select?.()
  }, [activeGuess.home, activeLocked, activeIndex, activeTab, revealEntry])

  useEffect(() => {
    if (!practiceShowingAnswer) {
      setSelectedRatingIndex(2)
    }
  }, [practiceCard?.id, practiceShowingAnswer])

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

  const revealCopy = revealEntry ? getRevealCopy(revealEntry.result) : null

  if (route.mode === 'attemptReview') {
    return (
      <AttemptReviewScreen
        attempt={sharedAttempt}
        reviewState={sharedAttemptState}
        onCopyLink={handleCopyReviewLink}
        onBackToPlay={() => navigateToTab('play')}
        shareState={shareState}
      />
    )
  }

  if (showCompletion) {
    return (
      <main className="app-shell app-shell-complete">
        <div className="background-wash" />
        <div className="tab-row tab-row-floating">
          <button className={`tab-button ${activeTab === 'play' ? 'is-active' : ''}`} type="button" onClick={() => navigateToTab('play')}>Play</button>
          <button className={`tab-button ${activeTab === 'practice' ? 'is-active' : ''}`} type="button" onClick={() => navigateToTab('practice')}>Practice</button>
          <button className={`tab-button ${activeTab === 'leaderboard' ? 'is-active' : ''}`} type="button" onClick={() => navigateToTab('leaderboard')}>Leaderboard</button>
        </div>
        <CompletionScreen
          metrics={metrics}
          reviewMatches={reviewMatches}
          reviewUrl={reviewUrl}
          displayedPercentile={displayedPercentile}
          percentileSource={percentileSource}
          savedAttempt={savedAttempt}
          elapsedSeconds={elapsedSeconds}
          onReset={resetGame}
          onCopyLink={handleCopyReviewLink}
          shareState={shareState}
          leaderboardForm={leaderboardForm}
          leaderboardState={leaderboardState}
          leaderboardError={leaderboardError}
          onLeaderboardChange={handleLeaderboardChange}
          onSaveLeaderboard={handleSaveLeaderboard}
        />
      </main>
    )
  }

  return (
    <main className="app-shell">
      <div className="background-wash" />

      <header className="game-header">
        <div className="header-copy">
          <h1 className="hero-title">WORLD CUP RECALL 2026</h1>
          <p className="header-kicker">Host countries: USA, Canada, Mexico</p>
        </div>
        <div className="header-meta">
          <div className="tab-row" role="tablist" aria-label="Game mode">
            <button className={`tab-button ${activeTab === 'play' ? 'is-active' : ''}`} type="button" onClick={() => navigateToTab('play')}>Play</button>
            <button className={`tab-button ${activeTab === 'practice' ? 'is-active' : ''}`} type="button" onClick={() => navigateToTab('practice')}>Practice</button>
            <button className={`tab-button ${activeTab === 'leaderboard' ? 'is-active' : ''}`} type="button" onClick={() => navigateToTab('leaderboard')}>Leaderboard</button>
          </div>
          <p className="match-counter">
            {activeTab === 'play' ? `Match ${activeIndex + 1} / ${fixtureOrder.length}` : activeTab === 'practice' ? `${weakPracticeCount} weak cards` : `${leaderboard.length} saved scores`}
          </p>
        </div>
      </header>

      {activeTab === 'play' ? (
        <section className="game-layout">
          <aside className="progress-rail" aria-label="Match progress">
            <div className="rail-heading">
              <p className="screen-title">Tournament Ledger</p>
            </div>
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

                  <div className="play-actions">
                    <button
                      className="primary-button submit-button"
                      disabled={!activeResult.complete}
                      onClick={handleSubmitCurrentFixture}
                    >
                      Submit
                    </button>
                    {import.meta.env.DEV ? (
                      <button
                        className="secondary-button submit-button"
                        type="button"
                        onClick={randomizeRest}
                      >
                        Randomize Rest
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </article>
          </section>
        </section>
      ) : activeTab === 'practice' ? (
        <PracticeScreen
          card={practiceCard}
          totalCount={practiceDeck.length}
          learnedCount={learnedPracticeCount}
          weakCount={weakPracticeCount}
          onFlip={() => setPracticeRevealId((current) => current === practiceCard?.id ? null : (practiceCard?.id ?? null))}
          onRate={handlePracticeRating}
          showingAnswer={practiceShowingAnswer}
          selectedRatingIndex={selectedRatingIndex}
          onSelectRatingIndex={setSelectedRatingIndex}
          onRatingKeyDown={handlePracticeRatingKeyDown}
          onJumpToPlay={() => navigateToTab('play')}
        />
      ) : (
        <LeaderboardScreen
          leaderboard={leaderboard}
          onJumpToPlay={() => navigateToTab('play')}
        />
      )}
    </main>
  )
}
