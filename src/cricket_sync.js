// SHAKTI CricketData Sync Engine
// Runs after every match — updates player form, venue calibration, prediction errors

const CRIC_KEY = "8f930e07-6483-45f5-8088-89927fc5973b";
const CRIC_BASE = "https://api.cricapi.com/v1";

// ── Fetch recent IPL matches ───────────────────────────────────
export async function fetchRecentIPLMatches() {
  try {
    const r = await fetch(`${CRIC_BASE}/currentMatches?apikey=${CRIC_KEY}&offset=0`);
    const d = await r.json();
    if (d.status !== "success") throw new Error(d.reason || "API error");
    // Filter IPL matches
    return (d.data || []).filter(m =>
      m.name?.includes("Indian Premier League") ||
      m.series_id?.includes("ipl") ||
      m.name?.toLowerCase().includes("ipl")
    );
  } catch (e) {
    console.error("fetchRecentIPLMatches error:", e);
    return [];
  }
}

// ── Fetch scorecard for a specific match ──────────────────────
export async function fetchScorecard(matchId) {
  try {
    const r = await fetch(`${CRIC_BASE}/match_scorecard?apikey=${CRIC_KEY}&id=${matchId}`);
    const d = await r.json();
    if (d.status !== "success") throw new Error(d.reason || "API error");
    return d.data;
  } catch (e) {
    console.error("fetchScorecard error:", e);
    return null;
  }
}

// ── Fetch live IPL score ───────────────────────────────────────
export async function fetchCricLive(t1, t2) {
  try {
    const r = await fetch(`${CRIC_BASE}/cricScore?apikey=${CRIC_KEY}`);
    const d = await r.json();
    if (d.status !== "success") return null;
    const match = (d.data || []).find(m =>
      (m.t1?.includes(t1) || m.t2?.includes(t1)) &&
      (m.t1?.includes(t2) || m.t2?.includes(t2))
    );
    return match || null;
  } catch (e) {
    return null;
  }
}

// ── Calculate form multiplier ─────────────────────────────────
function calcFormMultiplier(recentInnings, careerSR) {
  if (!recentInnings || recentInnings.length === 0) return 1.0;
  // Weighted recent form: most recent counts most
  const weights = [0.40, 0.30, 0.15, 0.10, 0.05];
  const valid = recentInnings.slice(-5);
  let weightedSR = 0, totalWeight = 0;
  valid.forEach((inn, i) => {
    const w = weights[valid.length - 1 - i] || 0.05;
    weightedSR += (inn.sr || 100) * w;
    totalWeight += w;
  });
  const avgSR = totalWeight > 0 ? weightedSR / totalWeight : careerSR;
  const ratio = avgSR / Math.max(1, careerSR);
  // Cap at ±25% form adjustment
  return Math.max(0.75, Math.min(1.25, ratio));
}

function calcBowlFormMultiplier(recentSpells, careerEcon) {
  if (!recentSpells || recentSpells.length === 0) return 1.0;
  const weights = [0.40, 0.30, 0.15, 0.10, 0.05];
  const valid = recentSpells.slice(-5);
  let weightedEcon = 0, totalWeight = 0;
  valid.forEach((spell, i) => {
    const w = weights[valid.length - 1 - i] || 0.05;
    weightedEcon += (spell.econ || careerEcon) * w;
    totalWeight += w;
  });
  const avgEcon = totalWeight > 0 ? weightedEcon / totalWeight : careerEcon;
  // Higher econ = worse for bowler → multiplier > 1 means worse
  return Math.max(0.80, Math.min(1.20, avgEcon / Math.max(1, careerEcon)));
}

// ── Parse scorecard into structured data ──────────────────────
function parseScorecard(scorecard, matchName) {
  if (!scorecard) return null;
  const result = {
    matchName,
    date: new Date().toISOString().slice(0, 10),
    innings: [],
    toss: scorecard.tossChoice || null,
    winner: scorecard.matchWinner || null,
  };

  // Parse innings
  (scorecard.scorecard || []).forEach(inn => {
    const batting = [];
    const bowling = [];

    // Batting
    (inn.batting || []).forEach(b => {
      if (b.batsman?.name && b.r != null) {
        const balls = parseInt(b.b) || 1;
        const runs = parseInt(b.r) || 0;
        batting.push({
          name: b.batsman.name,
          runs,
          balls,
          sr: balls > 0 ? Math.round(runs / balls * 100) : 0,
          fours: parseInt(b["4s"]) || 0,
          sixes: parseInt(b["6s"]) || 0,
        });
      }
    });

    // Bowling
    (inn.bowling || []).forEach(b => {
      if (b.bowler?.name && b.o != null) {
        const overs = parseFloat(b.o) || 0;
        const runs = parseInt(b.r) || 0;
        bowling.push({
          name: b.bowler.name,
          overs,
          runs,
          wickets: parseInt(b.w) || 0,
          econ: overs > 0 ? Math.round(runs / overs * 100) / 100 : 0,
        });
      }
    });

    // Try to extract PP score from scorecard
    // CricketData sometimes provides over-by-over breakdown
    let ppRuns = null;
    if (inn.overs && Array.isArray(inn.overs)) {
      const ppOvers = inn.overs.slice(0, 6);
      ppRuns = ppOvers.reduce((sum, ov) => sum + (parseInt(ov.runs) || 0), 0);
    }

    result.innings.push({
      team: inn.inning || "",
      total: parseInt(inn.r) || 0,
      wickets: parseInt(inn.w) || 0,
      overs: parseFloat(inn.o) || 0,
      ppRuns,
      batting,
      bowling,
    });
  });

  return result;
}

// ── Main sync function ─────────────────────────────────────────
export async function syncLastMatch(PLAYERS_BASE, BOWLERS_BASE, VENUES_BASE, currentState) {
  const {v2026 = {}, playerForm = {}, bowlerForm = {}, predictionLog = [], biasLog = {}} = currentState;

  // Step 1: Get recent IPL matches
  const matches = await fetchRecentIPLMatches();
  if (!matches.length) {
    return { success: false, msg: "No recent IPL matches found in API" };
  }

  // Find most recently completed match
  const completed = matches.filter(m => m.matchStarted && !m.matchEnded === false);
  const target = completed[0] || matches[0];
  if (!target?.id) return { success: false, msg: "No completed match found" };

  // Step 2: Fetch full scorecard
  const scorecard = await fetchScorecard(target.id);
  if (!scorecard) return { success: false, msg: "Could not fetch scorecard" };

  const parsed = parseScorecard(scorecard, target.name);
  if (!parsed) return { success: false, msg: "Could not parse scorecard" };

  const updates = { playersUpdated: [], bowlersUpdated: [], venueUpdated: null, biasDetected: [] };

  // Step 3: Update player form
  parsed.innings.forEach(inn => {
    inn.batting.forEach(b => {
      const player = PLAYERS_BASE[b.name];
      if (!player || b.balls < 4) return; // Skip if not in DB or less than 4 balls

      if (!playerForm[b.name]) playerForm[b.name] = [];
      playerForm[b.name].push({
        runs: b.runs, balls: b.balls, sr: b.sr,
        date: parsed.date, matchName: parsed.matchName,
      });
      // Keep last 5 innings
      if (playerForm[b.name].length > 5) playerForm[b.name] = playerForm[b.name].slice(-5);

      const mult = calcFormMultiplier(playerForm[b.name], player.ppSR);
      if (Math.abs(mult - 1.0) > 0.03) {
        updates.playersUpdated.push({
          name: b.name,
          runs: b.runs,
          sr: b.sr,
          formMult: Math.round(mult * 100) / 100,
          trend: mult > 1.05 ? "🔥 HOT" : mult < 0.95 ? "❄️ COLD" : "→ NEUTRAL",
        });
      }
    });

    // Step 4: Update bowler form
    inn.bowling.forEach(b => {
      const bowler = BOWLERS_BASE[b.name];
      if (!bowler || b.overs < 1) return;

      if (!bowlerForm[b.name]) bowlerForm[b.name] = [];
      bowlerForm[b.name].push({
        overs: b.overs, runs: b.runs, wickets: b.wickets, econ: b.econ,
        date: parsed.date, matchName: parsed.matchName,
      });
      if (bowlerForm[b.name].length > 5) bowlerForm[b.name] = bowlerForm[b.name].slice(-5);

      const mult = calcBowlFormMultiplier(bowlerForm[b.name], bowler.ppEcon);
      if (Math.abs(mult - 1.0) > 0.03) {
        updates.bowlersUpdated.push({
          name: b.name, econ: b.econ,
          formMult: Math.round(mult * 100) / 100,
          trend: mult > 1.05 ? "❄️ OFF FORM" : mult < 0.95 ? "🔥 SHARP" : "→ NORMAL",
        });
      }
    });
  });

  // Step 5: Update venue calibration
  const inn1 = parsed.innings[0];
  if (inn1 && inn1.total > 0) {
    // Try to match venue from match name
    const venueName = Object.keys(VENUES_BASE).find(v =>
      target.venue?.toLowerCase().includes(v.split(",")[0].toLowerCase())
    );
    if (venueName) {
      const prev = v2026[venueName] || {
        matches: 0,
        avgPP: VENUES_BASE[venueName].pp,
        avgTotal: VENUES_BASE[venueName].total,
      };
      const n = prev.matches + 1;
      const newAvgPP = inn1.ppRuns
        ? Math.round((prev.avgPP * (n - 1) + inn1.ppRuns) / n)
        : prev.avgPP;
      const newAvgTotal = Math.round((prev.avgTotal * (n - 1) + inn1.total) / n);
      v2026[venueName] = { matches: n, avgPP: newAvgPP, avgTotal: newAvgTotal };
      updates.venueUpdated = { venue: venueName, newAvgPP, newAvgTotal, matches: n };
    }
  }

  // Step 6: Detect prediction bias
  if (predictionLog.length >= 5) {
    const venueErrors = {};
    predictionLog.forEach(log => {
      if (!log.venue || log.actual == null || log.predicted == null) return;
      if (!venueErrors[log.venue]) venueErrors[log.venue] = { pp: [], total: [] };
      if (log.market === "pp") venueErrors[log.venue].pp.push(log.actual - log.predicted);
      if (log.market === "total") venueErrors[log.venue].total.push(log.actual - log.predicted);
    });

    Object.entries(venueErrors).forEach(([venue, errors]) => {
      if (errors.pp.length >= 3) {
        const avgBias = errors.pp.reduce((s, e) => s + e, 0) / errors.pp.length;
        if (Math.abs(avgBias) >= 4) {
          if (!biasLog[venue]) biasLog[venue] = {};
          biasLog[venue].ppBias = Math.round(avgBias);
          updates.biasDetected.push({
            venue, market: "PP",
            bias: Math.round(avgBias),
            direction: avgBias > 0 ? "underpredicting" : "overpredicting",
            msg: `${venue.split(",")[0]}: consistently ${avgBias > 0 ? "under" : "over"}predicting PP by avg ${Math.abs(Math.round(avgBias))} runs — auto-correcting`,
          });
        }
      }
    });
  }

  return {
    success: true,
    matchName: parsed.matchName,
    date: parsed.date,
    updates,
    newState: { v2026, playerForm, bowlerForm, biasLog },
  };
}

// ── Apply form multipliers to prediction ──────────────────────
export function applyFormToPlayer(playerName, playerData, playerForm, biasLog, venueName) {
  if (!playerData) return playerData;
  const form = playerForm[playerName];
  if (!form || form.length === 0) return playerData;

  const weights = [0.40, 0.30, 0.15, 0.10, 0.05];
  const valid = form.slice(-5);
  let weightedSR = 0, totalWeight = 0;
  valid.forEach((inn, i) => {
    const w = weights[valid.length - 1 - i] || 0.05;
    weightedSR += (inn.sr || 100) * w;
    totalWeight += w;
  });
  const avgSR = totalWeight > 0 ? weightedSR / totalWeight : playerData.ppSR;
  const mult = Math.max(0.75, Math.min(1.25, avgSR / Math.max(1, playerData.ppSR)));

  return {
    ...playerData,
    ppSR: Math.round(playerData.ppSR * mult),
    midSR: Math.round(playerData.midSR * mult),
    deathSR: Math.round(playerData.deathSR * mult),
    formMult: mult,
    formTrend: mult > 1.08 ? "🔥" : mult < 0.92 ? "❄️" : "→",
  };
}

export function applyFormToBowler(bowlerName, bowlerData, bowlerForm) {
  if (!bowlerData) return bowlerData;
  const form = bowlerForm[bowlerName];
  if (!form || form.length === 0) return bowlerData;

  const weights = [0.40, 0.30, 0.15, 0.10, 0.05];
  const valid = form.slice(-5);
  let weightedEcon = 0, totalWeight = 0;
  valid.forEach((spell, i) => {
    const w = weights[valid.length - 1 - i] || 0.05;
    weightedEcon += (spell.econ || bowlerData.ppEcon) * w;
    totalWeight += w;
  });
  const avgEcon = totalWeight > 0 ? weightedEcon / totalWeight : bowlerData.ppEcon;

  return {
    ...bowlerData,
    ppEcon: Math.round(avgEcon * 100) / 100,
    midEcon: Math.round(bowlerData.midEcon * (avgEcon / bowlerData.ppEcon) * 100) / 100,
    formTrend: avgEcon < bowlerData.ppEcon * 0.92 ? "🔥" : avgEcon > bowlerData.ppEcon * 1.08 ? "❄️" : "→",
  };
}
