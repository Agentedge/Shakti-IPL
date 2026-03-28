// SHAKTI Playing 11 + Live Scorecard Engine
// Fetches toss, playing 11, and live scorecard from CricketData

const CRIC_KEY = "8f930e07-6483-45f5-8088-89927fc5973b";
const CRIC_BASE = "https://api.cricapi.com/v1";

// Known batting orders per team (position 1-11)
export const BATTING_ORDERS = {
  RCB:  ["Phil Salt","Virat Kohli","Rajat Patidar","Jacob Bethell","Glenn Maxwell","Liam Livingstone","Krunal Pandya","Tim David","Josh Hazlewood","Mohammed Siraj","Yash Dayal"],
  MI:   ["Rohit Sharma","Ishan Kishan","Suryakumar Yadav","Tilak Varma","Hardik Pandya","Tim David","Will Jacks","Harshit Rana","Jasprit Bumrah","Trent Boult","Deepak Chahar"],
  CSK:  ["Ruturaj Gaikwad","Devon Conway","Rachin Ravindra","Shivam Dube","MS Dhoni","Ravindra Jadeja","Sam Curran","Deepak Chahar","Matheesha Pathirana","Khaleel Ahmed","Noor Ahmad"],
  KKR:  ["Quinton de Kock","Sunil Narine","Ajinkya Rahane","Venkatesh Iyer","Andre Russell","Rinku Singh","Finn Allen","Tim Seifert","Varun Chakravarthy","Mitchell Starc","Anrich Nortje"],
  SRH:  ["Travis Head","Abhishek Sharma","Heinrich Klaasen","Nitish Kumar Reddy","Pat Cummins","Shahbaz Ahmed","Harshal Patel","T Natarajan","Bhuvneshwar Kumar","Simarjeet Singh","Jaydev Unadkat"],
  RR:   ["Yashasvi Jaiswal","Sanju Samson","Riyan Parag","Shimron Hetmyer","Dhruv Jurel","Shubham Dubey","Wanindu Hasaranga","Trent Boult","Yuzvendra Chahal","Sandeep Sharma","Prasidh Krishna"],
  DC:   ["Jake Fraser-McGurk","Faf du Plessis","Harry Brook","Mitchell Marsh","KL Rahul","Axar Patel","Tristan Stubbs","Kuldeep Yadav","Anrich Nortje","Khaleel Ahmed","Mohsin Khan"],
  PBKS: ["Prabhsimran Singh","Jonny Bairstow","Shreyas Iyer","Shashank Singh","Marcus Stoinis","Sam Curran","Harpreet Brar","Arshdeep Singh","Kagiso Rabada","Yuzvendra Chahal","Azmatullah Omarzai"],
  GT:   ["Shubman Gill","Sai Sudharsan","Shahrukh Khan","David Miller","Rahul Tewatia","Washington Sundar","Rashid Khan","Noor Ahmad","Mohammed Shami","Spencer Johnson","Prasidh Krishna"],
  LSG:  ["KL Rahul","Nicholas Pooran","Aiden Markram","Mitchell Marsh","Deepak Hooda","Ravi Bishnoi","Avesh Khan","Mark Wood","Mohsin Khan","Mayank Yadav","Naveen ul Haq"],
};

// Full bowling rotation per team (who bowls which overs typically)
export const BOWLING_ROTATION = {
  RCB:  {pp:["Josh Hazlewood","Mohammed Siraj"],mid:["Krunal Pandya","Will Jacks","Yash Dayal"],death:["Josh Hazlewood","Mohammed Siraj","Yash Dayal"]},
  MI:   {pp:["Jasprit Bumrah","Trent Boult"],mid:["Hardik Pandya","Will Jacks","Deepak Chahar"],death:["Jasprit Bumrah","Trent Boult","Hardik Pandya"]},
  CSK:  {pp:["Matheesha Pathirana","Deepak Chahar"],mid:["Ravindra Jadeja","Noor Ahmad","Sam Curran"],death:["Matheesha Pathirana","Sam Curran","Khaleel Ahmed"]},
  KKR:  {pp:["Mitchell Starc","Anrich Nortje"],mid:["Sunil Narine","Varun Chakravarthy"],death:["Mitchell Starc","Anrich Nortje","Spencer Johnson"]},
  SRH:  {pp:["Pat Cummins","Bhuvneshwar Kumar"],mid:["T Natarajan","Shahbaz Ahmed","Pat Cummins"],death:["T Natarajan","Harshal Patel","Pat Cummins"]},
  RR:   {pp:["Trent Boult","Prasidh Krishna"],mid:["Wanindu Hasaranga","Yuzvendra Chahal"],death:["Trent Boult","Sandeep Sharma","Prasidh Krishna"]},
  DC:   {pp:["Anrich Nortje","Khaleel Ahmed"],mid:["Kuldeep Yadav","Axar Patel"],death:["Anrich Nortje","Mohsin Khan","Khaleel Ahmed"]},
  PBKS: {pp:["Arshdeep Singh","Kagiso Rabada"],mid:["Yuzvendra Chahal","Harpreet Brar"],death:["Arshdeep Singh","Kagiso Rabada","Sam Curran"]},
  GT:   {pp:["Mohammed Shami","Spencer Johnson"],mid:["Rashid Khan","Washington Sundar","Noor Ahmad"],death:["Mohammed Shami","Spencer Johnson","Prasidh Krishna"]},
  LSG:  {pp:["Avesh Khan","Mohsin Khan"],mid:["Ravi Bishnoi","Mark Wood"],death:["Avesh Khan","Mark Wood","Naveen ul Haq"]},
};

// ── Find today's IPL match ID ──────────────────────────────────
export async function findMatchId(t1Code, t2Code) {
  try {
    const r = await fetch(`${CRIC_BASE}/currentMatches?apikey=${CRIC_KEY}&offset=0`);
    const d = await r.json();
    if (d.status !== "success") return null;

    const teamMap = {
      RCB:"Royal Challengers",MI:"Mumbai Indians",CSK:"Chennai Super Kings",
      KKR:"Kolkata Knight Riders",SRH:"Sunrisers Hyderabad",RR:"Rajasthan Royals",
      DC:"Delhi Capitals",PBKS:"Punjab Kings",GT:"Gujarat Titans",LSG:"Lucknow Super Giants"
    };

    const t1Name = teamMap[t1Code]||t1Code;
    const t2Name = teamMap[t2Code]||t2Code;

    const match = (d.data||[]).find(m => {
      const name = (m.name||"").toLowerCase();
      return (name.includes(t1Name.toLowerCase())||name.includes(t1Code.toLowerCase())) &&
             (name.includes(t2Name.toLowerCase())||name.includes(t2Code.toLowerCase()));
    });

    return match?.id || null;
  } catch(e) {
    console.error("findMatchId error:", e);
    return null;
  }
}

// ── Fetch toss + playing 11 ────────────────────────────────────
export async function fetchTossAndPlaying11(matchId) {
  try {
    const r = await fetch(`${CRIC_BASE}/match_info?apikey=${CRIC_KEY}&id=${matchId}`);
    const d = await r.json();
    if (d.status !== "success") throw new Error(d.reason||"API error");

    const data = d.data;
    const result = {
      tossWinner: data.tossWinner||null,
      tossChoice: data.tossChoice||null, // "bat" or "field"
      teams: {},
      matchStarted: data.matchStarted||false,
      matchEnded: data.matchEnded||false,
    };

    // Extract playing 11 per team
    (data.teamInfo||[]).forEach(team => {
      const code = Object.keys({
        RCB:"Royal Challengers",MI:"Mumbai Indians",CSK:"Chennai Super Kings",
        KKR:"Kolkata Knight Riders",SRH:"Sunrisers Hyderabad",RR:"Rajasthan Royals",
        DC:"Delhi Capitals",PBKS:"Punjab Kings",GT:"Gujarat Titans",LSG:"Lucknow Super Giants"
      }).find(k => team.name?.includes(
        {RCB:"Royal Challengers",MI:"Mumbai Indians",CSK:"Chennai Super Kings",
         KKR:"Kolkata Knight Riders",SRH:"Sunrisers Hyderabad",RR:"Rajasthan Royals",
         DC:"Delhi Capitals",PBKS:"Punjab Kings",GT:"Gujarat Titans",LSG:"Lucknow Super Giants"}[k]
      )) || team.shortname;

      result.teams[code] = (team.players||[]).map(p => p.name);
    });

    return result;
  } catch(e) {
    console.error("fetchTossAndPlaying11 error:", e);
    return null;
  }
}

// ── Fetch live scorecard (every over) ─────────────────────────
export async function fetchLiveScorecard(matchId) {
  try {
    const r = await fetch(`${CRIC_BASE}/match_scorecard?apikey=${CRIC_KEY}&id=${matchId}`);
    const d = await r.json();
    if (d.status !== "success") return null;

    const data = d.data;
    if (!data.matchStarted) return { matchStarted: false };

    const result = {
      matchStarted: true,
      matchEnded: data.matchEnded||false,
      currentInning: 1,
      score: 0, wickets: 0, overs: 0, runRate: 0,
      target: null,
      striker: null, nonStriker: null, bowler: null,
      recentBalls: "",
      battingTeam: null, bowlingTeam: null,
      // Full batting scorecard per inning
      innings: [],
      // Who has batted, who is batting, who is yet to bat
      battedPlayers: [],
      currentBatsmen: [],
      bowlerSpells: [],
    };

    const scorecard = data.scorecard || [];

    scorecard.forEach((inn, idx) => {
      const batting = (inn.batting||[]).map(b => ({
        name: b.batsman?.name||"",
        runs: parseInt(b.r)||0,
        balls: parseInt(b.b)||0,
        sr: parseInt(b.sr)||0,
        out: b.dismissal !== "batting",
      }));

      const bowling = (inn.bowling||[]).map(b => ({
        name: b.bowler?.name||"",
        overs: parseFloat(b.o)||0,
        runs: parseInt(b.r)||0,
        wickets: parseInt(b.w)||0,
        econ: parseFloat(b.eco)||0,
      }));

      result.innings.push({
        team: inn.inning||"",
        total: parseInt(inn.r)||0,
        wickets: parseInt(inn.w)||0,
        overs: parseFloat(inn.o)||0,
        batting, bowling,
      });
    });

    // Current inning is the last incomplete one
    const liveInn = scorecard.find(inn => !result.matchEnded && parseFloat(inn.o) < 20) || scorecard[scorecard.length-1];

    if (liveInn) {
      result.score = parseInt(liveInn.r)||0;
      result.wickets = parseInt(liveInn.w)||0;
      result.overs = parseFloat(liveInn.o)||0;
      result.runRate = result.overs > 0 ? Math.round(result.score/result.overs*100)/100 : 0;
      result.battingTeam = liveInn.inning?.split(" Inning")?.[0]||"";

      // Current batsmen = not out in batting scorecard
      const currentBat = (liveInn.batting||[]).filter(b => b.dismissal === "batting");
      result.striker = currentBat[0]?.batsman?.name||null;
      result.nonStriker = currentBat[1]?.batsman?.name||null;
      result.currentBatsmen = currentBat.map(b => b.batsman?.name).filter(Boolean);

      // Who has already batted (out)
      result.battedPlayers = (liveInn.batting||[])
        .filter(b => b.dismissal !== "batting" && b.dismissal !== "yet to bat")
        .map(b => b.batsman?.name).filter(Boolean);

      // Current bowler = last in bowling list with incomplete overs
      const bowlers = liveInn.bowling||[];
      const activeBowler = bowlers.find(b => {
        const ov = parseFloat(b.o)||0;
        return ov % 1 !== 0; // has partial over = currently bowling
      }) || bowlers[bowlers.length-1];
      result.bowler = activeBowler?.bowler?.name||null;

      result.bowlerSpells = bowlers.map(b => ({
        name: b.bowler?.name||"",
        overs: parseFloat(b.o)||0,
        runs: parseInt(b.r)||0,
        wickets: parseInt(b.w)||0,
        econ: parseFloat(b.eco)||0,
        oversRemaining: Math.max(0, 4 - Math.floor(parseFloat(b.o)||0)),
      }));

      // Check if 2nd innings
      if (scorecard.length >= 2) {
        result.currentInning = 2;
        result.target = (parseInt(scorecard[0].r)||0) + 1;
      }
    }

    return result;
  } catch(e) {
    console.error("fetchLiveScorecard error:", e);
    return null;
  }
}

// ── Calculate remaining batting strength ──────────────────────
export function getRemainingBattingStrength(teamCode, battedPlayers, currentBatsmen, playing11, PLAYERS_BASE) {
  // Get ordered batting lineup
  const order = BATTING_ORDERS[teamCode] || [];
  
  // Filter to only playing 11 (if available) or full order
  const lineup = playing11?.length > 0
    ? order.filter(p => playing11.some(p11 => p11.includes(p.split(" ").slice(-1)[0]) || p.includes(p11.split(" ").slice(-1)[0])))
    : order;

  // Who is yet to bat
  const yetToBat = lineup.filter(p =>
    !battedPlayers.some(bp => bp.includes(p.split(" ").slice(-1)[0]) || p.includes(bp.split(" ").slice(-1)[0])) &&
    !currentBatsmen.some(cb => cb.includes(p.split(" ").slice(-1)[0]) || p.includes(cb.split(" ").slice(-1)[0]))
  );

  // Calculate weighted remaining batting strength
  const remainingData = yetToBat.map((p, pos) => {
    const data = PLAYERS_BASE[p] || PLAYERS_BASE["Other Batsman"];
    const posWeight = pos === 0 ? 0.35 : pos === 1 ? 0.25 : pos === 2 ? 0.18 : pos === 3 ? 0.12 : 0.10;
    return { name: p, data, posWeight, midSR: data.midSR||130, deathSR: data.deathSR||155 };
  });

  const totalWeight = remainingData.reduce((s, p) => s + p.posWeight, 0) || 1;
  const avgMidSR = remainingData.reduce((s, p) => s + p.midSR * p.posWeight, 0) / totalWeight;
  const avgDeathSR = remainingData.reduce((s, p) => s + p.deathSR * p.posWeight, 0) / totalWeight;

  return {
    yetToBat,
    avgMidSR: Math.round(avgMidSR) || 130,
    avgDeathSR: Math.round(avgDeathSR) || 155,
    count: yetToBat.length,
    hasFinisher: yetToBat.some(p => (PLAYERS_BASE[p]?.deathSR||0) > 180),
  };
}

// ── Calculate remaining bowling strength ──────────────────────
export function getRemainingBowlingStrength(teamCode, bowlerSpells, currentOvers, BOWLERS_BASE) {
  const rotation = BOWLING_ROTATION[teamCode];
  if (!rotation) return { avgDeathEcon: 9.5, remainingBowlers: [] };

  const phase = currentOvers < 6 ? "pp" : currentOvers < 15 ? "mid" : "death";
  const upcomingBowlers = rotation[phase] || rotation.mid;

  // Calculate how many overs each bowler has remaining (max 4 per bowler)
  const remaining = upcomingBowlers.map(name => {
    const spell = bowlerSpells.find(s => s.name?.includes(name.split(" ").slice(-1)[0])||name.includes(s.name?.split(" ").slice(-1)[0]||""));
    const bowled = spell ? Math.floor(spell.overs) : 0;
    const oversLeft = Math.max(0, 4 - bowled);
    const data = BOWLERS_BASE[name] || BOWLERS_BASE["Average Bowler"];
    return {
      name, oversLeft,
      econ: spell?.econ || data.ppEcon,
      careerEcon: data.ppEcon,
    };
  }).filter(b => b.oversLeft > 0);

  const avgDeathEcon = remaining.length > 0
    ? remaining.reduce((s, b) => s + b.econ, 0) / remaining.length
    : 9.5;

  return { remainingBowlers: remaining, avgDeathEcon: Math.round(avgDeathEcon * 100) / 100 };
}
