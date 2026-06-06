// supabase/functions/email-stats/index.ts
// Deployed as a Supabase Edge Function.
// Compiles full team stats + seeds and emails a formatted backup
// to the requesting admin's email address via Resend.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }
  })
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: { user: callerUser } } = await userClient.auth.getUser()
  if (!callerUser) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  // Read optional team_id from request body
  let requestedTeamId: string | null = null
  try {
    const body = await req.json()
    requestedTeamId = body?.team_id ?? null
  } catch { /* no body is fine */ }

  // Get caller's profile
  const { data: callerProfile } = await userClient
    .from('profiles')
    .select('id, display_name')
    .eq('id', callerUser.id)
    .single()

  if (!callerProfile) return new Response('Profile not found', { status: 403, headers: corsHeaders })

  // Get caller's memberships (admin ones only)
  const { data: memberships } = await userClient
    .from('team_members')
    .select('team_id, is_admin, teams(id, name)')
    .eq('profile_id', callerUser.id)
    .eq('is_admin', true)

  if (!memberships?.length) {
    return new Response('Not an admin of any team', { status: 403, headers: corsHeaders })
  }

  // Use requested team if valid, otherwise first admin team
  const membership = requestedTeamId
    ? memberships.find(m => m.team_id === requestedTeamId)
    : memberships[0]

  if (!membership) return new Response('Not an admin of that team', { status: 403, headers: corsHeaders })

  const teamId = membership.team_id
  const teamName = (membership.teams as any)?.name ?? 'Your Team'

  // ---- Rate limit: max one email per 60 minutes per user ----
  const RATE_LIMIT_MINUTES = 60
  const { data: rateRow } = await serviceClient
    .from('function_rate_limits')
    .select('last_called_at')
    .eq('profile_id', callerProfile.id)
    .maybeSingle()

  if (rateRow?.last_called_at) {
    const minutesSinceLast = (Date.now() - new Date(rateRow.last_called_at).getTime()) / 60000
    if (minutesSinceLast < RATE_LIMIT_MINUTES) {
      const waitMins = Math.ceil(RATE_LIMIT_MINUTES - minutesSinceLast)
      return new Response(
        JSON.stringify({ error: `Rate limited. Try again in ${waitMins} minute${waitMins === 1 ? '' : 's'}.` }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  await serviceClient
    .from('function_rate_limits')
    .upsert({ profile_id: callerProfile.id, last_called_at: new Date().toISOString() })

  // Fetch all members of the team (via team_members join)
  const { data: memberRows } = await userClient
    .from('team_members')
    .select('profile_id, profiles(id, display_name)')
    .eq('team_id', teamId)

  const memberMap: Record<string, string> = {}
  for (const r of memberRows ?? []) {
    memberMap[r.profile_id] = (r.profiles as any)?.display_name ?? r.profile_id
  }

  // Fetch game_players for the team
  const { data: gamePlayers } = await userClient
    .from('game_players')
    .select('profile_id, role, won, games(played_at, team_id)')
    .eq('games.team_id', teamId)

  // Fetch seeds
  const { data: seeds } = await userClient
    .from('stat_seeds')
    .select('*')
    .eq('team_id', teamId)

  // Fetch recent games
  const { data: recentGames } = await userClient
    .from('games')
    .select('id, played_at, notes, game_players(profile_id, role, side, won, profiles(display_name))')
    .eq('team_id', teamId)
    .order('played_at', { ascending: false })
    .limit(20)

  // Get admin's email
  const { data: { user: adminUser } } = await serviceClient.auth.admin.getUserById(callerProfile.id)
  const adminEmail = adminUser?.email
  if (!adminEmail) return new Response('Could not determine admin email', { status: 400, headers: corsHeaders })

  // ---- Compile stats ----
  const seedMap: Record<string, any> = {}
  for (const s of seeds ?? []) seedMap[s.profile_id] = s

  const filtered = (gamePlayers ?? []).filter((gp: any) => gp.games?.team_id === teamId)

  const statsByProfile: Record<string, any> = {}
  for (const gp of filtered) {
    const pid = gp.profile_id
    if (!statsByProfile[pid]) statsByProfile[pid] = { w: 0, l: 0, smW: 0, smL: 0, entries: [] }
    statsByProfile[pid].entries.push(gp)
    if (gp.won) statsByProfile[pid].w++; else statsByProfile[pid].l++
    if (gp.role === 'spymaster') {
      if (gp.won) statsByProfile[pid].smW++; else statsByProfile[pid].smL++
    }
  }

  for (const s of seeds ?? []) {
    if (!statsByProfile[s.profile_id]) statsByProfile[s.profile_id] = { w: 0, l: 0, smW: 0, smL: 0, entries: [] }
  }

  const rows = Object.entries(statsByProfile).map(([pid, s]: [string, any]) => {
    const seed = seedMap[pid]
    const totalW = s.w + (seed?.w ?? 0)
    const totalL = s.l + (seed?.l ?? 0)
    const smW = s.smW + (seed?.sm_w ?? 0)
    const smL = s.smL + (seed?.sm_l ?? 0)
    const gp = totalW + totalL
    const pct = gp > 0 ? Math.round((totalW / gp) * 100) : 0

    let streakLabel = '—'
    if (s.entries.length > 0) {
      s.entries.sort((a: any, b: any) => new Date(a.games?.played_at).getTime() - new Date(b.games?.played_at).getTime())
      let streak = 0, streakType = null
      for (let i = s.entries.length - 1; i >= 0; i--) {
        const won = s.entries[i].won
        if (streakType === null) { streakType = won; streak = 1 }
        else if (won === streakType) streak++
        else break
      }
      streakLabel = `${streakType ? 'W' : 'L'}${streak}`
    } else if (seed?.streak_count > 0 && seed?.streak_type) {
      streakLabel = `${seed.streak_type}${seed.streak_count}`
    }

    return { name: memberMap[pid] ?? pid, totalW, totalL, smW, smL, pct, streakLabel, gp }
  }).sort((a, b) => b.pct - a.pct || b.gp - a.gp)

  // ---- Build HTML email ----
  const now = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })

  const statsRows = rows.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#1a1a1f' : '#141418'}">
      <td style="padding:10px 14px;font-weight:700">${escapeHtml(r.name)}</td>
      <td style="padding:10px 14px;font-family:monospace">${r.totalW}-${r.totalL}</td>
      <td style="padding:10px 14px">${r.pct}%</td>
      <td style="padding:10px 14px;font-family:monospace">${r.smW}-${r.smL}</td>
      <td style="padding:10px 14px;font-family:monospace">${r.streakLabel}</td>
      <td style="padding:10px 14px">${r.gp}</td>
    </tr>`).join('')

  const recentRows = (recentGames ?? []).map((g: any) => {
    const date = new Date(g.played_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const red = (g.game_players ?? []).filter((p: any) => p.side === 'red')
    const blue = (g.game_players ?? []).filter((p: any) => p.side === 'blue')
    const winner = (g.game_players ?? []).find((p: any) => p.won)?.side ?? '?'
    const fmt = (players: any[]) => players.map((p: any) =>
      `${escapeHtml(p.profiles?.display_name ?? '?')}${p.role === 'spymaster' ? ' 🕵️' : ''}`
    ).join(', ')
    return `
    <tr>
      <td style="padding:8px 14px;color:#aaa">${date}</td>
      <td style="padding:8px 14px;color:#e85454">${fmt(red)}</td>
      <td style="padding:8px 14px;color:#5490e8">${fmt(blue)}</td>
      <td style="padding:8px 14px;font-weight:700;color:${winner === 'red' ? '#e85454' : '#5490e8'}">${winner.toUpperCase()}</td>
      <td style="padding:8px 14px;color:#888;font-style:italic">${escapeHtml(g.notes)}</td>
    </tr>`
  }).join('')

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f0f11;color:#f0f0f5;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:700px;margin:0 auto;padding:32px 24px">

    <div style="margin-bottom:32px">
      <div style="font-size:2rem;margin-bottom:4px">🕵️</div>
      <h1 style="margin:0;font-size:1.6rem;color:#e8c547">${escapeHtml(teamName)} — Stats Backup</h1>
      <p style="margin:6px 0 0;color:#7a7a8c;font-size:0.9rem">Generated ${now}</p>
    </div>

    <h2 style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:#e8c547;margin-bottom:12px">Leaderboard</h2>
    <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;margin-bottom:36px">
      <thead>
        <tr style="background:#222228">
          <th style="padding:10px 14px;text-align:left;font-size:0.72rem;color:#7a7a8c;text-transform:uppercase;letter-spacing:0.06em">Player</th>
          <th style="padding:10px 14px;text-align:left;font-size:0.72rem;color:#7a7a8c;text-transform:uppercase;letter-spacing:0.06em">W-L</th>
          <th style="padding:10px 14px;text-align:left;font-size:0.72rem;color:#7a7a8c;text-transform:uppercase;letter-spacing:0.06em">Win%</th>
          <th style="padding:10px 14px;text-align:left;font-size:0.72rem;color:#7a7a8c;text-transform:uppercase;letter-spacing:0.06em">SM W-L</th>
          <th style="padding:10px 14px;text-align:left;font-size:0.72rem;color:#7a7a8c;text-transform:uppercase;letter-spacing:0.06em">Streak</th>
          <th style="padding:10px 14px;text-align:left;font-size:0.72rem;color:#7a7a8c;text-transform:uppercase;letter-spacing:0.06em">GP</th>
        </tr>
      </thead>
      <tbody>${statsRows}</tbody>
    </table>

    <h2 style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:#e8c547;margin-bottom:12px">Recent Games (last 20)</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:36px">
      <thead>
        <tr style="background:#222228">
          <th style="padding:8px 14px;text-align:left;font-size:0.72rem;color:#7a7a8c;text-transform:uppercase">Date</th>
          <th style="padding:8px 14px;text-align:left;font-size:0.72rem;color:#e85454;text-transform:uppercase">Red</th>
          <th style="padding:8px 14px;text-align:left;font-size:0.72rem;color:#5490e8;text-transform:uppercase">Blue</th>
          <th style="padding:8px 14px;text-align:left;font-size:0.72rem;color:#7a7a8c;text-transform:uppercase">Winner</th>
          <th style="padding:8px 14px;text-align:left;font-size:0.72rem;color:#7a7a8c;text-transform:uppercase">Notes</th>
        </tr>
      </thead>
      <tbody>${recentRows || '<tr><td colspan="5" style="padding:12px 14px;color:#7a7a8c">No games logged yet.</td></tr>'}</tbody>
    </table>

    <p style="color:#444;font-size:0.78rem;border-top:1px solid #222;padding-top:16px">
      Sent by Brush Pass · Requested by ${escapeHtml(callerProfile.display_name ?? adminEmail)}
    </p>
  </div>
</body>
</html>`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Brush Pass <onboarding@resend.dev>',
      to: [adminEmail],
      subject: `📊 ${teamName} Stats Backup — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      html,
    }),
  })

  if (!resendRes.ok) {
    const err = await resendRes.text()
    return new Response(`Email send failed: ${err}`, { status: 500, headers: corsHeaders })
  }

  return new Response(JSON.stringify({ ok: true, sentTo: adminEmail }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
