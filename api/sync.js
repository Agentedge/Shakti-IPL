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

const TEAM_CODES = {
  "royal challengers":"RCB","sunrisers":"SRH","mumbai indians":"MI",
  "chennai super kings":"CSK","kolkata knight riders":"KKR","rajasthan royals":"RR",
  "delhi capitals":"DC","punjab kings":"PBKS","gujarat titans":"GT","lucknow super giants":"LSG",
};
function teamCode(name) {
  if (!name) return "";
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(TEAM_CODES)) {
    if (lower.includes(k)) return v;
  }
  return name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,3);
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const matchDate = new Date(dateStr);
  const now = new Date();
  return matchDate.getFullYear() === now.getFullYear() &&
    matchDate.getMonth() === now.getMonth() &&
    matchDate.getDate() === now.getDate();
}

function isRecent(dateStr) {
  if (!dateStr) return false;
  const matchDate = new Date(dateStr);
  const now = new Date();
  const diffDays = (now - matchDate) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 2; // within last 2 days
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const t1req = (url.searchParams.get('t1') || '').toLowerCase();
    const t2req = (url.searchParams.get('t2') || '').toLowerCase();

    // Fetch matches from both endpoints
    let allMatches = [];
    for (const endpoint of ['currentMatches', 'matches']) {
      try {
        const r = await fetch(`${CRIC_BASE}/${endpoint}?apikey=${CRIC_KEY}&offset=0`);
        const d = await r.json();
        if (d.status === 'success') allMatches.push(...(d.data || []));
      } catch(e) {}
    }

    // Deduplicate
    const seen = new Set();
    allMatches = allMatches.filter(m => { if(seen.has(m.id))return false; seen.add(m.id);return true; });

    // Filter IPL only
    const iplMatches = allMatches.filter(m => {
      const name = (m.name||"").toLowerCase();
      const series = (m.series||"").toLowerCase();
      return name.includes("indian premier league") || name.includes("ipl 2026") || series.includes("ipl");
    });

    if (iplMatches.length === 0) {
      return res.status(200).json({
        success: false,
        msg: `No IPL matches in API. Total matches found: ${allMatches.length}. Names: ${allMatches.slice(0,5).map(m=>m.name).join(' | ')}`
      });
    }

    // PRIORITY ORDER for selecting the right match:
    // 1. Specific teams requested (from app) AND completed today
    // 2. Any completed match from today
    // 3. Any completed match from last 2 days
    // 4. Currently live match
    // NEVER pick a future/upcoming match

    let target = null;

    // Priority 1: specific teams + completed today
    if (t1req && t2req) {
      target = iplMatches.find(m => {
        const name = (m.name||"").toLowerCase();
        return name.includes(t1req) && name.includes(t2req) &&
          m.matchEnded && isRecent(m.date);
      });
    }

    // Priority 2: completed today
    if (!target) {
      target = iplMatches.find(m => m.matchEnded && isToday(m.date));
    }

    // Priority 3: completed in last 2 days
    if (!target) {
      target = iplMatches.find(m => m.matchEnded && isRecent(m.date));
    }

    // Priority 4: live match
    if (!target) {
      target = iplMatches.find(m => m.matchStarted && !m.matchEnded);
    }

    if (!target) {
      const allInfo = iplMatches.map(m =>
        `${m.name} | started:${m.matchStarted} | ended:${m.matchEnded} | date:${m.date}`
      ).join('\n');
      return res.status(200).json({
        success: false,
        msg: `Found ${iplMatches.length} IPL matches but none are completed/live today. Details:\n${allInfo}`
      });
    }

    // Try scorecard
    let scoreData = null;
    let dataSource = 'listing';

    try {
      const r = await fetch(`${CRIC_BASE}/match_scorecard?apikey=${CRIC_KEY}&id=${target.id}`);
      const d = await r.json();
      if (d.status === 'success' && d.data?.scorecard?.length > 0) {
        scoreData = d.data;
        dataSource = 'scorecard';
      }
    } catch(e) {}

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

    // Extract scores from match listing (always available)
    const scores = target.score || [];
    const parseRuns = (s) => parseInt((String(s||"")).match(/(\d+)/)?.[1]||"0");
    const parseWkts = (s) => {
      const m = String(s||"").match(/\/(\d+)/);
      return m ? parseInt(m[1]) : 10;
    };

    const inn1 = scores[0] || {};
    const inn2 = scores[1] || {};
    const total1 = parseRuns(inn1.r || scoreData?.scorecard?.[0]?.r);
    const total2 = parseRuns(inn2.r || scoreData?.scorecard?.[1]?.r);
    const ppEst = (t) => t > 0 ? Math.round(t * 0.285) : null;

    const parseBatting = (sc) => (sc?.batting||[])
      .filter(b => b.batsman?.name && parseInt(b.b||0) >= 4)
      .map(b => ({
        name: b.batsman.name,
        runs: parseInt(b.r)||0,
        balls: parseInt(b.b)||1,
        sr: Math.round((parseInt(b.r)||0)/Math.max(1,parseInt(b.b)||1)*100),
      }));

    const parseBowling = (sc) => (sc?.bowling||[])
      .filter(b => b.bowler?.name && parseFloat(b.o||0) >= 1)
      .map(b => ({
        name: b.bowler.name,
        overs: parseFloat(b.o)||0,
        runs: parseInt(b.r)||0,
        wickets: parseInt(b.w)||0,
        econ: parseFloat(b.eco)||0,
      }));

    const sc0 = scoreData?.scorecard?.[0];
    const sc1 = scoreData?.scorecard?.[1];
    const venueMapped = matchVenue(scoreData?.venue || target.venue || "");

    return res.status(200).json({
      success: true,
      matchName: target.name,
      date: (target.date||"").slice(0,10),
      venue: scoreData?.venue || target.venue || "",
      venueMapped,
      dataSource,
      winner: scoreData?.matchWinner || target.matchWinner || null,
      ppRuns: ppEst(total1),
      totalRuns: total1,
      innings: [
        {
          team: teamCode(inn1.inning || sc0?.inning || ""),
          total: total1,
          wickets: parseWkts(inn1.w || sc0?.w),
          ppRuns: ppEst(total1),
          batting: parseBatting(sc0),
          bowling: parseBowling(sc0),
        },
        total2 > 0 ? {
          team: teamCode(inn2.inning || sc1?.inning || ""),
          total: total2,
          wickets: parseWkts(inn2.w || sc1?.w),
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
