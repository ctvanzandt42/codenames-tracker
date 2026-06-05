/**
 * Compute per-member stats from game_players rows + optional stat seeds.
 *
 * Seeds represent historical totals entered by an admin before game logging
 * began. They contribute to W/L/SM counts. For streak:
 *   - If the member has real logged games, streak is calculated from those.
 *   - If the member has NO logged games yet, the seeded streak is shown.
 *
 * @param {Array} gamePlayers  - rows from game_players joined with profiles + games
 * @param {Array} seeds        - rows from stat_seeds (may be empty)
 * @param {Array} allMembers   - all profiles on the team (catches seed-only / ghost members)
 */
export function computeStats(gamePlayers, seeds = [], allMembers = []) {
  const seedMap = {}
  for (const s of seeds) seedMap[s.profile_id] = s

  const memberMeta = {}
  for (const m of allMembers) {
    memberMeta[m.id] = {
      display_name: m.display_name ?? 'Unknown',
      is_active: m.is_active ?? true,
      is_ghost: m.is_ghost ?? false,
    }
  }

  const byProfile = {}

  for (const gp of gamePlayers) {
    const pid = gp.profile_id
    if (!byProfile[pid]) {
      byProfile[pid] = {
        profile_id: pid,
        display_name: gp.profiles?.display_name ?? memberMeta[pid]?.display_name ?? 'Unknown',
        is_active: memberMeta[pid]?.is_active ?? true,
        is_ghost: memberMeta[pid]?.is_ghost ?? false,
        entries: [],
      }
    }
    byProfile[pid].entries.push(gp)
  }

  // Include seed-only and ghost members who may have no logged games
  for (const m of allMembers) {
    if (!byProfile[m.id]) {
      byProfile[m.id] = {
        profile_id: m.id,
        display_name: m.display_name ?? 'Unknown',
        is_active: m.is_active ?? true,
        is_ghost: m.is_ghost ?? false,
        entries: [],
      }
    }
  }

  return Object.values(byProfile).map(({ profile_id, display_name, is_active, is_ghost, entries }) => {
    const seed = seedMap[profile_id]

    entries.sort((a, b) => new Date(a.games?.played_at) - new Date(b.games?.played_at))

    let w = 0, l = 0, smW = 0, smL = 0
    for (const e of entries) {
      if (e.won) w++; else l++
      if (e.role === 'spymaster') {
        if (e.won) smW++; else smL++
      }
    }

    if (seed) {
      w   += seed.w    ?? 0
      l   += seed.l    ?? 0
      smW += seed.sm_w ?? 0
      smL += seed.sm_l ?? 0
    }

    let streakLabel = '—'
    if (entries.length > 0) {
      let streak = 0, streakType = null
      for (let i = entries.length - 1; i >= 0; i--) {
        const result = entries[i].won
        if (streakType === null) { streakType = result; streak = 1 }
        else if (result === streakType) streak++
        else break
      }
      streakLabel = `${streakType ? 'W' : 'L'}${streak}`
    } else if (seed?.streak_count > 0 && seed?.streak_type) {
      streakLabel = `${seed.streak_type}${seed.streak_count}`
    }

    return {
      profile_id,
      display_name,
      is_active,
      is_ghost,
      w, l, smW, smL,
      streak: streakLabel,
      gamesPlayed: w + l,
      winPct: w + l > 0 ? Math.round((w / (w + l)) * 100) : 0,
    }
  }).sort((a, b) => {
    // Active members first, then inactive
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    return b.winPct - a.winPct || b.gamesPlayed - a.gamesPlayed
  })
}