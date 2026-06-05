/**
 * Compute per-member stats from game_players rows + optional stat seeds.
 *
 * Seeds represent historical totals entered by an admin before game logging
 * began. They contribute to W/L/SM counts. For streak:
 *   - If the member has real logged games, the streak is calculated purely
 *     from those (seeds are too coarse to extend a streak reliably).
 *   - If the member has NO logged games yet, the seeded streak is shown as-is.
 *
 * @param {Array} gamePlayers  - rows from game_players joined with profiles + games
 * @param {Array} seeds        - rows from stat_seeds (may be empty)
 */
export function computeStats(gamePlayers, seeds = []) {
  // Index seeds by profile_id for fast lookup
  const seedMap = {}
  for (const s of seeds) {
    seedMap[s.profile_id] = s
  }

  // Collect all profile ids from both sources
  const allProfiles = {}

  for (const gp of gamePlayers) {
    const pid = gp.profile_id
    if (!allProfiles[pid]) {
      allProfiles[pid] = {
        profile_id: pid,
        display_name: gp.profiles?.display_name ?? 'Unknown',
        entries: [],
      }
    }
    allProfiles[pid].entries.push(gp)
  }

  // Include any seeded members who haven't logged a real game yet
  for (const s of seeds) {
    if (!allProfiles[s.profile_id]) {
      allProfiles[s.profile_id] = {
        profile_id: s.profile_id,
        display_name: s.profiles?.display_name ?? 'Unknown',
        entries: [],
      }
    }
  }

  return Object.values(allProfiles).map(({ profile_id, display_name, entries }) => {
    const seed = seedMap[profile_id]

    // Sort real games chronologically
    entries.sort((a, b) => new Date(a.games?.played_at) - new Date(b.games?.played_at))

    // Tally real games
    let w = 0, l = 0, smW = 0, smL = 0
    for (const e of entries) {
      if (e.won) w++; else l++
      if (e.role === 'spymaster') {
        if (e.won) smW++; else smL++
      }
    }

    // Add seed totals
    if (seed) {
      w   += seed.w    ?? 0
      l   += seed.l    ?? 0
      smW += seed.sm_w ?? 0
      smL += seed.sm_l ?? 0
    }

    // Streak logic
    let streakLabel = '—'
    if (entries.length > 0) {
      // Real games exist — calculate streak from those only
      let streak = 0
      let streakType = null
      for (let i = entries.length - 1; i >= 0; i--) {
        const result = entries[i].won
        if (streakType === null) { streakType = result; streak = 1 }
        else if (result === streakType) streak++
        else break
      }
      streakLabel = `${streakType ? 'W' : 'L'}${streak}`
    } else if (seed && seed.streak_count > 0 && seed.streak_type) {
      // No real games yet — show the seeded streak
      streakLabel = `${seed.streak_type}${seed.streak_count}`
    }

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
      hasRealGames: entries.length > 0,
    }
  }).sort((a, b) => b.winPct - a.winPct || b.gamesPlayed - a.gamesPlayed)
}