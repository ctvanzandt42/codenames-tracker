/**
 * Given a flat array of game_players rows (each with profile_id, role, won, game.played_at),
 * compute per-member stats: W, L, spymasterW, spymasterL, streak
 */
export function computeStats(gamePlayers) {
  // Group by profile
  const byProfile = {}

  for (const gp of gamePlayers) {
    const pid = gp.profile_id
    if (!byProfile[pid]) {
      byProfile[pid] = {
        profile_id: pid,
        display_name: gp.profiles?.display_name ?? 'Unknown',
        entries: [],
      }
    }
    byProfile[pid].entries.push(gp)
  }

  return Object.values(byProfile).map(({ profile_id, display_name, entries }) => {
    // Sort chronologically
    entries.sort((a, b) => new Date(a.games?.played_at) - new Date(b.games?.played_at))

    let w = 0, l = 0, smW = 0, smL = 0
    for (const e of entries) {
      if (e.won) w++; else l++
      if (e.role === 'spymaster') {
        if (e.won) smW++; else smL++
      }
    }

    // Current streak: walk backwards
    let streak = 0
    let streakType = null
    for (let i = entries.length - 1; i >= 0; i--) {
      const result = entries[i].won
      if (streakType === null) {
        streakType = result
        streak = 1
      } else if (result === streakType) {
        streak++
      } else {
        break
      }
    }

    const streakLabel = streak === 0
      ? '—'
      : `${streakType ? 'W' : 'L'}${streak}`

    return {
      profile_id,
      display_name,
      w,
      l,
      smW,
      smL,
      streak: streakLabel,
      gamesPlayed: w + l,
      winPct: w + l > 0 ? Math.round((w / (w + l)) * 100) : 0,
    }
  }).sort((a, b) => b.winPct - a.winPct || b.gamesPlayed - a.gamesPlayed)
}
