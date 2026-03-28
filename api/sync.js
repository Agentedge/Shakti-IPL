// Vercel Serverless Function — /api/sync.js
const CRIC_KEY = "8f930e07-6483-45f5-8088-89927fc5973b";
const CRIC_BASE = "https://api.cricapi.com/v1";

const VENUE_MAP = {
  "chinnaswamy":"Chinnaswamy, Bangalore","bangalore":"Chinnaswamy, Bangalore",
  "wankhede":"Wankhede, Mumbai","mumbai":"Wankhede, Mumbai",
  "eden":"Eden Gardens, Kolkata","kolkata":"Eden Gardens, Kolkata",
  "feroz shah":"Arun Jaitley, Delhi","arun jaitley":"Arun Jaitley, Delhi","delhi":"Arun Jaitley, Delhi",
  "chepauk":"Chidambaram, Chennai","chidambaram":"Chidambaram, Chennai","chennai":"Chidambaram, Chennai",
  "rajiv gandhi":"RGISC, Hyderabad","hyderabad":"RGISC, Hyderabad","uppal":"RGISC, Hyderabad",
  "sawai":"SMS Stadium, Jaipur","jaipur":"SMS Stadium, Jaipur",
  "punjab":"PCA Stadium, Mohali","mohali":"PCA Stadium, Mohali",
  "narendra modi":"Narendra Modi, Ahmedabad","ahmedabad":"Narendra Modi, Ahmedabad",
  "barsapara":"Barsapara, Guwahati","guwahati":"Barsapara, Guwahati",
  "mullanpur":"MYSI, Mullanpur","ekana":"Ekana, Lucknow","lucknow":"Ekana, Lucknow",
};

function matchVenue(v) {
  if (!v) return null;
  const lower = v.toLowerCase();
  for (const [k, val] of Object.entries(VENUE_MAP)) {
    if (lower.includes(k)) return val;
  }
  return null;
}

// Team code from full name
const TEAM_CODES = {
  "royal challengers":"RCB","sunrisers":"SRH","mumbai indians":"MI",
  "chennai super kings":"CSK","kolkata knight riders":"KKR","rajasthan royals":"RR",
  "delhi capitals":"DC","punjab kings":"PBKS","gujarat titans":"GT","lucknow super giants":"LSG",
};
function teamCode(name) {
  if (!name) return name;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(TEAM_CODES)) {
    if (lower.includes(k)) return v;
  }
  return name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,3);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Get query param for specific teams if provided
    const url = new URL(req.url, `http://${req.headers.host}`);
    const t1req = url.searchParams.get('t1') || '';
    const t2req = url.searchParams.get('t2') || '';

    // Fetch all current/recent matches
    let allMatches = [];
    for (const endpoint of ['currentMatches', 'matches']) {
      try {
        const r = await fetch(`${CRIC_BASE}/${endpoint}?apikey=${CRIC_KEY}&offset=0`);
        const d = await r.json();
        if (d.status === 'success') {
          allMatches = [...allMatches, ...(d.data || [])];
        }
      } catch(e) {}
    }

    // Remove duplicates by id
    const seen = new Set();
    allMatches = allMatches.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id); return true;
    });

    // Filter IPL matches
    const iplKw = ["indian premier league","ipl 2026","rcb","srh","mi ","csk","kkr","rr ","dc ","pbks","gt ","lsg"];
    let iplMatches = allMatches.filter(m => {
      const name = (m.name||"").toLowerCase();
      const series = (m.series||"").toLowerCase();
      return iplKw.some(k => name.includes(k) || series.includes(k));
    });

    if (iplMatches.length === 0) {
      // Return debug info
      return res.status(200).json({
        success: false,
        msg: `No IPL matches found. Total matches in API: ${allMatches.length}. Sample: ${allMatches.slice(0,3).map(m=>m.name).join(' | ')}`
      });
    }

    // Sort: completed first, then by date desc
    iplMatches.sort((a,b) => {
      if (a.matchEnded && !b.matchEnded) return -1;
      if (!a.matchEnded && b.matchEnded) return 1;
      return new Date(b.date||0) - new Date(a.date||0);
    });

    // If specific teams requested, find that match first
    let target = iplMatches[0];
    if (t1req && t2req) {
      const specific = iplMatches.find(m => {
        const name = (m.name||"").toLowerCase();
        return name.includes(t1req.toLowerCase()) && name.includes(t2req.toLowerCase());
      });
      if (specific) target = specific;
    }

    // Try to get scorecard — try multiple endpoints
    let scoreData = null;
    let dataSource = 'none';

    // Try 1: full scorecard
    try {
      const r = await fetch(`${CRIC_BASE}/match_scorecard?apikey=${CRIC_KEY}&id=${target.id}`);
      const d = await r.json();
      if (d.status === 'success' && d.data?.scorecard?.length > 0) {
        scoreData = d.data;
        dataSource = 'scorecard';
      }
    } catch(e) {}

    // Try 2: match_info (lighter endpoint)
    if (!scoreData) {
      try {
        const r = await fetch(`${CRIC_BASE}/match_info?apikey=${CRIC_KEY}&id=${target.id}`);
        const d = await r.json();
        if (d.status === 'success') {
          scoreData = d.data;
          dataSource = 'match_info';
        }
      } catch(e) {}
    }

    // Build response from whatever data we have
    // Even match listing has: score[], teamInfo[], matchWinner, etc.
    const matchScore = target.score || [];
    const inn1Score = matchScore[0] || {};
    const inn2Score = matchScore[1] || {};

    // Parse scores like "185/6 (20)" -> 185
    const parseScore = (s) => {
      if (!s) return 0;
      const m = String(s).match(/(\d+)/);
      return m ? parseInt(m[1]) : 0;
    };

    const total1 = parseScore(inn1Score.r || scoreData?.scorecard?.[0]?.r);
    const total2 = parseScore(inn2Score.r || scoreData?.scorecard?.[1]?.r);

    // Extract batting from scorecard if available
    const parseBatting = (inn) => {
      if (!inn?.batting) return [];
      return inn.batting
        .filter(b => b.batsman?.name && parseInt(b.b||0) >= 4)
        .map(b => ({
          name: b.batsman.name,
          runs: parseInt(b.r)||0,
          balls: parseInt(b.b)||1,
          sr: Math.round((parseInt(b.r)||0)/Math.max(1,parseInt(b.b)||1)*100),
        }));
    };

    const parseBowling = (inn) => {
      if (!inn?.bowling) return [];
      return inn.bowling
        .filter(b => b.bowler?.name && parseFloat(b.o||0) >= 1)
        .map(b => ({
          name: b.bowler.name,
          overs: parseFloat(b.o)||0,
          runs: parseInt(b.r)||0,
          wickets: parseInt(b.w)||0,
          econ: parseFloat(b.eco)||0,
        }));
    };

    const sc0 = scoreData?.scorecard?.[0];
    const sc1 = scoreData?.scorecard?.[1];

    // Estimate PP: if no over data, use 29% of total (typical T20 average)
    const ppEst = (total) => total > 0 ? Math.round(total * 0.29) : null;

    const venueName = matchVenue(scoreData?.venue || target.venue || "");

    // Extract winner
    const winner = scoreData?.matchWinner || target.matchWinner ||
      (target.status && target.status.includes("won") ? target.status : null);

    return res.status(200).json({
      success: true,
      matchName: target.name,
      date: (target.date||"").slice(0,10),
      venue: scoreData?.venue || target.venue || "",
      venueMapped: venueName,
      dataSource,
      winner,
      ppRuns: ppEst(total1),
      totalRuns: total1,
      innings: [
        {
          team: teamCode(inn1Score.inning || sc0?.inning || ""),
          total: total1,
          wickets: parseScore(inn1Score.w || sc0?.w),
          ppRuns: ppEst(total1),
          batting: parseBatting(sc0),
          bowling: parseBowling(sc0),
        },
        total2 > 0 ? {
          team: teamCode(inn2Score.inning || sc1?.inning || ""),
          total: total2,
          wickets: parseScore(inn2Score.w || sc1?.w),
          ppRuns: ppEst(total2),
          batting: parseBatting(sc1),
          bowling: parseBowling(sc1),
        } : null,
      ].filter(Boolean),
    });

  } catch(e) {
    return res.status(200).json({ success: false, msg: "Server error: " + e.message });
  }
}
