// Vercel Serverless Function — /api/sync.js
// Fetches last IPL match scorecard from CricketData and returns processed data

const CRIC_KEY = "8f930e07-6483-45f5-8088-89927fc5973b";
const CRIC_BASE = "https://api.cricapi.com/v1";

const VENUE_MAP = {
  "chinnaswamy": "Chinnaswamy, Bangalore",
  "bangalore": "Chinnaswamy, Bangalore",
  "wankhede": "Wankhede, Mumbai",
  "mumbai": "Wankhede, Mumbai",
  "eden": "Eden Gardens, Kolkata",
  "kolkata": "Eden Gardens, Kolkata",
  "feroz shah": "Arun Jaitley, Delhi",
  "arun jaitley": "Arun Jaitley, Delhi",
  "delhi": "Arun Jaitley, Delhi",
  "chepauk": "Chidambaram, Chennai",
  "chidambaram": "Chidambaram, Chennai",
  "chennai": "Chidambaram, Chennai",
  "rajiv gandhi": "RGISC, Hyderabad",
  "hyderabad": "RGISC, Hyderabad",
  "uppal": "RGISC, Hyderabad",
  "sawai": "SMS Stadium, Jaipur",
  "jaipur": "SMS Stadium, Jaipur",
  "punjab": "PCA Stadium, Mohali",
  "mohali": "PCA Stadium, Mohali",
  "narendra modi": "Narendra Modi, Ahmedabad",
  "ahmedabad": "Narendra Modi, Ahmedabad",
  "motera": "Narendra Modi, Ahmedabad",
  "barsapara": "Barsapara, Guwahati",
  "guwahati": "Barsapara, Guwahati",
  "mullanpur": "MYSI, Mullanpur",
  "new chandigarh": "MYSI, Mullanpur",
  "ekana": "Ekana, Lucknow",
  "lucknow": "Ekana, Lucknow",
};

function matchVenue(venueName) {
  if (!venueName) return null;
  const lower = venueName.toLowerCase();
  for (const [key, val] of Object.entries(VENUE_MAP)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

async function findLastIPLMatch() {
  // Try multiple endpoints to find the most recent IPL match
  const endpoints = [
    `${CRIC_BASE}/currentMatches?apikey=${CRIC_KEY}&offset=0`,
    `${CRIC_BASE}/matches?apikey=${CRIC_KEY}&offset=0`,
  ];

  const iplKeywords = ["indian premier league", "ipl", "rcb", "mi ", "csk", "kkr", "srh", "rr ", " dc ", "pbks", "gt ", "lsg"];

  for (const url of endpoints) {
    try {
      const r = await fetch(url);
      const d = await r.json();
      if (d.status !== "success") continue;

      const matches = d.data || [];
      // Find IPL match — check name or series
      const ipl = matches.filter(m => {
        const name = (m.name || "").toLowerCase();
        const series = (m.series || "").toLowerCase();
        return iplKeywords.some(k => name.includes(k) || series.includes(k));
      });

      if (ipl.length > 0) {
        // Prefer completed matches, then most recent
        const completed = ipl.filter(m => m.matchEnded);
        return completed.length > 0 ? completed[0] : ipl[0];
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

async function fetchScorecard(matchId) {
  const r = await fetch(`${CRIC_BASE}/match_scorecard?apikey=${CRIC_KEY}&id=${matchId}`);
  const d = await r.json();
  if (d.status !== "success") throw new Error(d.reason || "Scorecard fetch failed");
  return d.data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Step 1: Find last IPL match
    const match = await findLastIPLMatch();
    if (!match) {
      return res.status(200).json({
        success: false,
        msg: "No recent IPL matches found. IPL season may not have started yet or API limit reached."
      });
    }

    // Step 2: Fetch full scorecard
    let scorecard;
    try {
      scorecard = await fetchScorecard(match.id);
    } catch (e) {
      return res.status(200).json({
        success: false,
        msg: `Found match "${match.name}" but scorecard failed: ${e.message}`
      });
    }

    // Step 3: Parse batting and bowling data
    const innings1 = scorecard?.scorecard?.[0];
    const innings2 = scorecard?.scorecard?.[1];

    if (!innings1) {
      return res.status(200).json({
        success: false,
        msg: `Match found (${match.name}) but scorecard empty — match may still be in progress`
      });
    }

    // Parse batsmen
    const parseBatting = (inn) => (inn?.batting || [])
      .filter(b => b.batsman?.name && parseInt(b.b) >= 4)
      .map(b => ({
        name: b.batsman.name,
        runs: parseInt(b.r) || 0,
        balls: parseInt(b.b) || 1,
        sr: Math.round((parseInt(b.r) || 0) / Math.max(1, parseInt(b.b) || 1) * 100),
      }));

    // Parse bowlers
    const parseBowling = (inn) => (inn?.bowling || [])
      .filter(b => b.bowler?.name && parseFloat(b.o) >= 1)
      .map(b => ({
        name: b.bowler.name,
        overs: parseFloat(b.o) || 0,
        runs: parseInt(b.r) || 0,
        wickets: parseInt(b.w) || 0,
        econ: parseFloat(b.eco) || 0,
      }));

    // Estimate PP score from over-by-over if available, else estimate
    const estimatePP = (inn) => {
      if (!inn) return null;
      // Some scorecards have over data
      if (inn.overs && Array.isArray(inn.overs)) {
        return inn.overs.slice(0, 6).reduce((s, o) => s + (parseInt(o.runs) || 0), 0);
      }
      // Estimate from run rate: total * (6/20) adjusted for typical T20 scoring curve
      const total = parseInt(inn.r) || 0;
      const wickets = parseInt(inn.w) || 0;
      // PP typically ~28-30% of total in T20
      return Math.round(total * 0.29);
    };

    const ppRuns = estimatePP(innings1);
    const totalRuns = parseInt(innings1.r) || 0;
    const venueName = matchVenue(scorecard.venue || match.venue || "");

    return res.status(200).json({
      success: true,
      matchName: match.name,
      date: (match.date || "").slice(0, 10),
      venue: scorecard.venue || match.venue || "",
      venueMapped: venueName,
      ppRuns,
      totalRuns,
      tossWinner: scorecard.tossChoice || null,
      matchWinner: scorecard.matchWinner || null,
      innings: [
        {
          team: innings1?.inning || "",
          total: totalRuns,
          wickets: parseInt(innings1?.w) || 0,
          batting: parseBatting(innings1),
          bowling: parseBowling(innings1),
          ppRuns,
        },
        innings2 ? {
          team: innings2?.inning || "",
          total: parseInt(innings2.r) || 0,
          wickets: parseInt(innings2.w) || 0,
          batting: parseBatting(innings2),
          bowling: parseBowling(innings2),
          ppRuns: estimatePP(innings2),
        } : null,
      ].filter(Boolean),
    });

  } catch (e) {
    return res.status(200).json({
      success: false,
      msg: "Sync error: " + e.message
    });
  }
}
