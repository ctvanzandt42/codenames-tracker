import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import AppHeader from '../components/AppHeader'

const SIDE_LABEL = { red: 'Red', blue: 'Blue' }
const COLOR_EMOJI = { red: '🔴', blue: '🔵', neutral: '⚪', assassin: '💀' }

export default function PlayGame() {
  const { gameId } = useParams()
  const { profile, isAdminOf } = useAuth()
  const navigate = useNavigate()

  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [events, setEvents] = useState([])
  const [secretKey, setSecretKey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loadPlayers = useCallback(async () => {
    const { data } = await supabase
      .from('live_game_players')
      .select('id, profile_id, side, role, joined_at, profiles(display_name)')
      .eq('game_id', gameId)
      .order('joined_at', { ascending: true })
    setPlayers(data || [])
  }, [gameId])

  const loadEvents = useCallback(async () => {
    const { data } = await supabase
      .from('live_game_events')
      .select('id, type, side, profile_id, payload, created_at, profiles(display_name)')
      .eq('game_id', gameId)
      .order('created_at', { ascending: true })
    setEvents(data || [])
  }, [gameId])

  // Initial load
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setSecretKey(null)

    async function init() {
      const { data: g, error: gErr } = await supabase
        .from('live_games')
        .select('*')
        .eq('id', gameId)
        .single()

      if (gErr || !g) {
        if (!cancelled) { setError('Game not found.'); setLoading(false) }
        return
      }
      if (cancelled) return
      setGame(g)
      await Promise.all([loadPlayers(), loadEvents()])
      if (!cancelled) setLoading(false)
    }
    init()

    return () => { cancelled = true }
  }, [gameId, loadPlayers, loadEvents])

  // Realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel(`live_game:${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_games', filter: `id=eq.${gameId}` },
        payload => setGame(payload.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_game_players', filter: `game_id=eq.${gameId}` },
        () => loadPlayers())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_game_events', filter: `game_id=eq.${gameId}` },
        () => loadEvents())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [gameId, loadPlayers, loadEvents])

  const me = useMemo(() => players.find(p => p.profile_id === profile?.id), [players, profile])
  const canCancel = !!game && (game.created_by === profile?.id || isAdminOf(game.team_id))

  // Fetch the secret key once we know we're a spymaster on an active/finished game
  useEffect(() => {
    if (!game || !me || me.role !== 'spymaster' || game.status === 'lobby') return
    let cancelled = false
    supabase
      .from('live_game_key')
      .select('key')
      .eq('game_id', gameId)
      .single()
      .then(({ data }) => { if (!cancelled && data) setSecretKey(data.key) })
    return () => { cancelled = true }
  }, [game, me, gameId])

  async function joinAs(side, role) {
    setBusy(true)
    setError('')
    let res
    if (me) {
      res = await supabase.from('live_game_players').update({ side, role }).eq('id', me.id)
    } else {
      res = await supabase.from('live_game_players').insert({ game_id: gameId, profile_id: profile.id, side, role })
    }
    setBusy(false)
    if (res.error) {
      setError(res.error.code === '23505'
        ? `${SIDE_LABEL[side]} already has a spymaster.`
        : res.error.message)
    }
  }

  async function leaveGame() {
    setBusy(true)
    await supabase.from('live_game_players').delete().eq('game_id', gameId).eq('profile_id', profile.id)
    setBusy(false)
  }

  async function startGame() {
    setBusy(true)
    setError('')
    const { error: rpcErr } = await supabase.rpc('start_live_game', { p_game_id: gameId })
    setBusy(false)
    if (rpcErr) setError(rpcErr.message)
  }

  async function cancelGame() {
    if (!window.confirm('Cancel this game? It will be removed with no effect on stats.')) return
    setBusy(true)
    setError('')
    const { error: rpcErr } = await supabase.rpc('cancel_live_game', { p_game_id: gameId })
    setBusy(false)
    if (rpcErr) setError(rpcErr.message)
  }

  async function submitClue(word, number) {
    setBusy(true)
    setError('')
    const { error: insErr } = await supabase.from('live_game_events').insert({
      game_id: gameId,
      type: 'clue',
      side: me.side,
      profile_id: profile.id,
      payload: { word: word.trim(), number },
    })
    setBusy(false)
    if (insErr) setError(insErr.message)
  }

  async function tapCard(index) {
    if (busy) return
    setBusy(true)
    setError('')
    const { error: rpcErr } = await supabase.rpc('reveal_card', { p_game_id: gameId, p_index: index })
    setBusy(false)
    if (rpcErr) setError(rpcErr.message)
  }

  if (loading) {
    return (
      <div className="app-shell">
        <AppHeader title="Play"><BackBtn navigate={navigate} /></AppHeader>
        <main className="main-content"><div className="loading-state">Loading game…</div></main>
      </div>
    )
  }

  if (error && !game) {
    return (
      <div className="app-shell">
        <AppHeader title="Play"><BackBtn navigate={navigate} /></AppHeader>
        <main className="main-content"><p className="muted">{error}</p></main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <AppHeader title="Play"><BackBtn navigate={navigate} /></AppHeader>
      <main className="main-content play-room">
        {error && <p className="error-msg">{error}</p>}

        {game.status === 'lobby' && (
          <LobbyView
            game={game} players={players} me={me} busy={busy} canCancel={canCancel}
            onJoin={joinAs} onLeave={leaveGame} onStart={startGame} onCancel={cancelGame}
          />
        )}

        {game.status === 'active' && (
          <ActiveView
            game={game} players={players} me={me} events={events} secretKey={secretKey}
            busy={busy} canCancel={canCancel}
            onSubmitClue={submitClue} onTapCard={tapCard} onCancel={cancelGame}
          />
        )}

        {game.status === 'finished' && (
          <FinishedView game={game} players={players} events={events} navigate={navigate} />
        )}

        {game.status === 'cancelled' && (
          <CancelledView navigate={navigate} />
        )}
      </main>
    </div>
  )
}

function BackBtn({ navigate }) {
  return <button className="nav-link sign-out-btn" onClick={() => navigate('/play')}>← Lobbies</button>
}

// ── Lobby ────────────────────────────────────────────────────────────────────

function LobbyView({ game, players, me, busy, canCancel, onJoin, onLeave, onStart, onCancel }) {
  const sides = ['red', 'blue']
  const canStart = sides.every(side =>
    players.some(p => p.side === side && p.role === 'spymaster') &&
    players.some(p => p.side === side && p.role === 'operative')
  )

  return (
    <>
      <section className="log-section">
        <h2 className="section-title">Lobby</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Pick a side and role. Each side needs exactly one spymaster and at least one operative to start.
        </p>

        <div className="play-roster-grid">
          {sides.map(side => (
            <div key={side} className={`play-roster-col play-roster-${side}`}>
              <h3 className="play-roster-heading">{COLOR_EMOJI[side]} {SIDE_LABEL[side]}</h3>

              <RosterRole label="Spymaster" roleKey="spymaster" side={side} players={players} me={me}
                busy={busy} onJoin={onJoin} singleSlot />
              <RosterRole label="Operatives" roleKey="operative" side={side} players={players} me={me}
                busy={busy} onJoin={onJoin} />
            </div>
          ))}
        </div>

        <div className="play-lobby-actions">
          {me && (
            <button className="nav-link sign-out-btn" disabled={busy} onClick={onLeave}>Leave game</button>
          )}
          {canCancel && (
            <button className="nav-link sign-out-btn" disabled={busy} onClick={onCancel}>Cancel game</button>
          )}
          <button className="btn-magic" style={{ width: 'auto', padding: '11px 28px' }}
            disabled={busy || !canStart} onClick={onStart}>
            {canStart ? '▶ Start Game' : 'Waiting for both sides…'}
          </button>
        </div>
      </section>
    </>
  )
}

function RosterRole({ label, roleKey, side, players, me, busy, onJoin, singleSlot }) {
  const here = players.filter(p => p.side === side && p.role === roleKey)
  const iAmHere = me?.side === side && me?.role === roleKey
  const full = singleSlot && here.length > 0 && !iAmHere

  return (
    <div className="play-roster-role">
      <span className="play-roster-role-label">{label}</span>
      <ul className="play-roster-names">
        {here.map(p => (
          <li key={p.id} className={p.profile_id === me?.profile_id ? 'play-roster-me' : ''}>
            {p.profiles?.display_name || 'Player'}
          </li>
        ))}
        {here.length === 0 && <li className="play-roster-empty">— empty —</li>}
      </ul>
      {!iAmHere && (
        <button className="nav-link" disabled={busy || full} onClick={() => onJoin(side, roleKey)}>
          {full ? 'Taken' : `Join as ${label.replace(/s$/, '')}`}
        </button>
      )}
      {iAmHere && <span className="play-roster-tag">You're here</span>}
    </div>
  )
}

// ── Active ───────────────────────────────────────────────────────────────────

function ActiveView({ game, players, me, events, secretKey, busy, canCancel, onSubmitClue, onTapCard, onCancel }) {
  const isSpymaster = me?.role === 'spymaster'
  const isMyTurn = me?.side === game.current_turn
  const totals = useMemo(() => sideTotals(game, secretKey), [game, secretKey])

  const lastClue = [...events].reverse().find(e => e.type === 'clue' && sinceLastTurnEnd(e, events))

  let banner
  if (isMyTurn && isSpymaster) {
    banner = lastClue ? `Waiting on ${SIDE_LABEL[game.current_turn].toLowerCase()} operatives to guess "${lastClue.payload?.word}"` : 'Give your team a clue'
  } else if (isMyTurn) {
    banner = lastClue ? 'Tap a card your spymaster clued' : 'Waiting for your spymaster\'s clue…'
  } else {
    banner = `${SIDE_LABEL[game.current_turn]}'s turn`
  }

  return (
    <div className="play-active">
      <ScoreBar game={game} totals={totals} />

      <div className="play-turn-banner">
        <span className={`play-turn-pill play-turn-${game.current_turn}`}>{banner}</span>
        {canCancel && (
          <button className="nav-link sign-out-btn" disabled={busy} onClick={onCancel}>Cancel game</button>
        )}
      </div>

      {lastClue && (
        <div className="play-clue-banner">
          <span className="play-clue-word">"{lastClue.payload?.word}"</span>
          <span className="play-clue-number">{lastClue.payload?.number}</span>
          <span className="play-clue-by">— {lastClue.profiles?.display_name || SIDE_LABEL[lastClue.side]}</span>
        </div>
      )}

      <Board game={game} me={me} secretKey={secretKey} isSpymaster={isSpymaster}
        canTap={!isSpymaster && isMyTurn && !!lastClue} busy={busy} onTapCard={onTapCard} />

      {isSpymaster && isMyTurn && (
        <ClueForm busy={busy} onSubmit={onSubmitClue} />
      )}

      <EventLog events={events} />
    </div>
  )
}

function sinceLastTurnEnd(clueEvent, events) {
  // Show a clue only while it's still "live" — i.e. no turn_end/game_over after it
  return !events.some(e =>
    (e.type === 'turn_end' || e.type === 'game_over') &&
    new Date(e.created_at) > new Date(clueEvent.created_at)
  )
}

function sideTotals(game, secretKey) {
  // The starting side always gets 9 cards, the other 8 — that split is public
  // knowledge the moment the game starts, so it's safe to show to everyone.
  const startCount = { [game.starting_side]: 9, [game.starting_side === 'red' ? 'blue' : 'red']: 8 }
  const found = { red: 0, blue: 0 }

  if (secretKey) {
    secretKey.forEach((color, i) => {
      if (game.revealed[i] && (color === 'red' || color === 'blue')) found[color]++
    })
  } else {
    game.revealed.forEach(color => {
      if (color === 'red' || color === 'blue') found[color]++
    })
  }

  return {
    red: { found: found.red, total: startCount.red },
    blue: { found: found.blue, total: startCount.blue },
  }
}

function ScoreBar({ game, totals }) {
  return (
    <div className="play-score-bar">
      <div className={`play-score play-score-red ${game.current_turn === 'red' ? 'play-score-active' : ''}`}>
        <span className="play-score-label">🔴 Red</span>
        <span className="play-score-value">{totals.red.found} / {totals.red.total}</span>
      </div>
      <div className={`play-score play-score-blue ${game.current_turn === 'blue' ? 'play-score-active' : ''}`}>
        <span className="play-score-label">🔵 Blue</span>
        <span className="play-score-value">{totals.blue.found} / {totals.blue.total}</span>
      </div>
    </div>
  )
}

function Board({ game, me, secretKey, isSpymaster, canTap, busy, onTapCard }) {
  return (
    <div className="play-board">
      {game.grid.map((word, i) => {
        const revealedColor = game.revealed[i]
        const hintColor = isSpymaster && !revealedColor ? secretKey?.[i] : null
        const classes = ['play-card']
        if (revealedColor) classes.push('play-card-revealed', `play-card-${revealedColor}`)
        else if (hintColor) classes.push('play-card-hint', `play-card-hint-${hintColor}`)
        if (canTap && !revealedColor) classes.push('play-card-tappable')

        return (
          <button
            key={i}
            className={classes.join(' ')}
            disabled={!canTap || !!revealedColor || busy}
            onClick={() => onTapCard(i)}
          >
            <span className="play-card-word">{word}</span>
            {revealedColor && <span className="play-card-icon">{COLOR_EMOJI[revealedColor]}</span>}
          </button>
        )
      })}
    </div>
  )
}

function ClueForm({ busy, onSubmit }) {
  const [word, setWord] = useState('')
  const [number, setNumber] = useState(1)

  function handleSubmit(e) {
    e.preventDefault()
    if (!word.trim()) return
    onSubmit(word, number)
    setWord('')
    setNumber(1)
  }

  return (
    <form className="play-clue-form" onSubmit={handleSubmit}>
      <input
        className="player-select"
        style={{ flex: 2 }}
        type="text"
        placeholder="One-word clue"
        value={word}
        onChange={e => setWord(e.target.value)}
        maxLength={40}
      />
      <select className="role-select" value={number} onChange={e => setNumber(Number(e.target.value))}>
        {Array.from({ length: 9 }, (_, i) => i + 1).map(n => (
          <option key={n} value={n}>{n}</option>
        ))}
        <option value={0}>0 (unlimited)</option>
      </select>
      <button className="btn-magic" style={{ width: 'auto', padding: '11px 24px' }} disabled={busy || !word.trim()}>
        Give Clue
      </button>
    </form>
  )
}

function EventLog({ events }) {
  const clueAndReveal = events.filter(e => e.type === 'clue' || e.type === 'reveal' || e.type === 'turn_end')
  const recent = clueAndReveal.slice(-12).reverse()
  const ref = useRef(null)

  if (recent.length === 0) return null

  return (
    <div className="play-event-log" ref={ref}>
      <h3 className="play-roster-role-label">Activity</h3>
      <ul>
        {recent.map(e => (
          <li key={e.id} className={`play-event play-event-${e.side || 'neutral'}`}>
            {eventLine(e)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function eventLine(e) {
  if (e.type === 'clue') {
    return <>💬 <strong>{e.profiles?.display_name || SIDE_LABEL[e.side]}</strong> clued "{e.payload?.word}" — {e.payload?.number}</>
  }
  if (e.type === 'reveal') {
    return <>{COLOR_EMOJI[e.payload?.color] || '·'} <strong>{e.profiles?.display_name || SIDE_LABEL[e.side]}</strong> revealed "{e.payload?.word}"</>
  }
  if (e.type === 'turn_end') {
    return <>↪ Turn passes to {SIDE_LABEL[e.side]}</>
  }
  return null
}

// ── Finished ─────────────────────────────────────────────────────────────────

function FinishedView({ game, players, events, navigate }) {
  const winnerLabel = game.winner ? SIDE_LABEL[game.winner] : '—'

  return (
    <div className="play-finished">
      <div className={`play-winner-banner play-winner-${game.winner}`}>
        <span className="play-winner-emoji">{COLOR_EMOJI[game.winner]}</span>
        <h2>{winnerLabel} wins!</h2>
        <p className="muted">Stats have been tallied and added to the leaderboard.</p>
      </div>

      <Board game={game} me={null} secretKey={null} isSpymaster={false} canTap={false} busy onTapCard={() => {}} />

      <div className="play-lobby-actions">
        <button className="btn-magic" style={{ width: 'auto', padding: '11px 28px' }} onClick={() => navigate('/play')}>
          Back to Lobbies
        </button>
      </div>

      <EventLog events={events} />
    </div>
  )
}

// ── Cancelled ────────────────────────────────────────────────────────────────

function CancelledView({ navigate }) {
  return (
    <div className="play-finished">
      <div className="play-winner-banner">
        <span className="play-winner-emoji">🚫</span>
        <h2>Game cancelled</h2>
        <p className="muted">No stats were recorded for this game.</p>
      </div>

      <div className="play-lobby-actions">
        <button className="btn-magic" style={{ width: 'auto', padding: '11px 28px' }} onClick={() => navigate('/play')}>
          Back to Lobbies
        </button>
      </div>
    </div>
  )
}
