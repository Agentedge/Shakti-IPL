// shakti_db.js - UPDATED
// Imports real Cricsheet data from shakti_data.json
// Maintains backward compatibility with App.jsx
// Last updated: March 29, 2026

import shakti_data from './shakti_data.json';

// ============================================================================
// EXTRACT AND EXPORT REAL DATA FROM shakti_data.json
// ============================================================================

export const VENUES_BASE = shakti_data.venues;
export const PLAYERS_BASE = shakti_data.players;
export const BOWLERS_BASE = shakti_data.bowlers;
export const MATCHUPS = shakti_data.matchups;
export const H2H = shakti_data.h2h;
export const TOSS_DATA = shakti_data.toss_by_venue;
export const SEASON_TRENDS = shakti_data.season_trends;
export const SHAKTI_META = shakti_data.meta;

// ============================================================================
// IPL 2026 HARDCODED DATA (not in shakti_data.json)
// ============================================================================

export const SQUADS = {
  CSK: [
    "Ruturaj Gaikwad", "Devon Conway", "Rachin Ravindra", "Shivam Dube",
    "MS Dhoni", "Ravindra Jadeja", "Deepak Chahar", "Matheesha Pathirana",
    "Khaleel Ahmed", "Noor Ahmad", "Sam Curran", "Shahrukh Khan"
  ],
  MI: [
    "Rohit Sharma", "Suryakumar Yadav", "Hardik Pandya", "Ishan Kishan",
    "Tim David", "Tilak Varma", "Will Jacks", "Jasprit Bumrah",
    "Trent Boult", "Deepak Chahar", "Harshit Rana", "Karn Sharma"
  ],
  RCB: [
    "Virat Kohli", "Phil Salt", "Rajat Patidar", "Jacob Bethell",
    "Glenn Maxwell", "Liam Livingstone", "Krunal Pandya", "Josh Hazlewood",
    "Mohammed Siraj", "Yash Dayal", "Suyash Sharma", "Rasikh Dar"
  ],
  KKR: [
    "Ajinkya Rahane", "Quinton de Kock", "Finn Allen", "Tim Seifert",
    "Sunil Narine", "Andre Russell", "Rinku Singh", "Venkatesh Iyer",
    "Varun Chakravarthy", "Mitchell Starc", "Spencer Johnson", "Anrich Nortje"
  ],
  SRH: [
    "Travis Head", "Abhishek Sharma", "Heinrich Klaasen", "Nitish Kumar Reddy",
    "Pat Cummins", "Bhuvneshwar Kumar", "T Natarajan", "Harshal Patel",
    "Simarjeet Singh", "Jaydev Unadkat"
  ],
  RR: [
    "Yashasvi Jaiswal", "Sanju Samson", "Riyan Parag", "Shimron Hetmyer",
    "Dhruv Jurel", "Shubham Dubey", "Trent Boult", "Yuzvendra Chahal",
    "Sandeep Sharma", "Prasidh Krishna", "Wanindu Hasaranga"
  ],
  DC: [
    "Jake Fraser-McGurk", "Harry Brook", "Faf du Plessis", "Mitchell Marsh",
    "Tristan Stubbs", "Axar Patel", "KL Rahul", "Kuldeep Yadav",
    "Anrich Nortje", "Khaleel Ahmed", "Mukesh Kumar", "Mohsin Khan"
  ],
  PBKS: [
    "Prabhsimran Singh", "Shreyas Iyer", "Jonny Bairstow", "Marcus Stoinis",
    "Sam Curran", "Shashank Singh", "Arshdeep Singh", "Kagiso Rabada",
    "Yuzvendra Chahal", "Azmatullah Omarzai", "Vishnu Vinod", "Harpreet Brar"
  ],
  GT: [
    "Shubman Gill", "Sai Sudharsan", "David Miller", "Shahrukh Khan",
    "Rahul Tewatia", "Washington Sundar", "Rashid Khan", "Mohammed Shami",
    "Spencer Johnson", "Noor Ahmad", "Prasidh Krishna", "Manav Suthar"
  ],
  LSG: [
    "KL Rahul", "Nicholas Pooran", "Aiden Markram", "Mitchell Marsh",
    "Deepak Hooda", "Ravi Bishnoi", "Avesh Khan", "Mark Wood",
    "Mayank Yadav", "Mohsin Khan", "Akash Deep", "Naveen ul Haq"
  ]
};

export const MATCHES = [
  {id:1,  t1:"RCB",  t2:"SRH", venue:"Chinnaswamy, Bangalore",      date:"Mar 28", time:"7:30 PM"},
  {id:2,  t1:"MI",   t2:"KKR", venue:"Wankhede, Mumbai",             date:"Mar 29", time:"7:30 PM"},
  {id:3,  t1:"RR",   t2:"CSK", venue:"Barsapara, Guwahati",          date:"Mar 30", time:"7:30 PM"},
  {id:4,  t1:"PBKS", t2:"GT",  venue:"MYSI, Mullanpur",              date:"Mar 31", time:"3:30 PM"},
  {id:5,  t1:"LSG",  t2:"DC",  venue:"Ekana, Lucknow",               date:"Mar 31", time:"7:30 PM"},
  {id:6,  t1:"KKR",  t2:"SRH", venue:"Eden Gardens, Kolkata",        date:"Apr 1",  time:"7:30 PM"},
  {id:7,  t1:"CSK",  t2:"PBKS",venue:"Chidambaram, Chennai",         date:"Apr 3",  time:"7:30 PM"},
  {id:8,  t1:"DC",   t2:"MI",  venue:"Arun Jaitley, Delhi",          date:"Apr 4",  time:"3:30 PM"},
  {id:9,  t1:"GT",   t2:"RR",  venue:"Narendra Modi, Ahmedabad",     date:"Apr 4",  time:"7:30 PM"},
  {id:10, t1:"SRH",  t2:"LSG", venue:"RGISC, Hyderabad",             date:"Apr 5",  time:"3:30 PM"},
  {id:11, t1:"RCB",  t2:"CSK", venue:"Chinnaswamy, Bangalore",       date:"Apr 5",  time:"7:30 PM"},
  {id:12, t1:"KKR",  t2:"PBKS",venue:"Eden Gardens, Kolkata",        date:"Apr 6",  time:"7:30 PM"},
  {id:13, t1:"RR",   t2:"MI",  venue:"Barsapara, Guwahati",          date:"Apr 7",  time:"7:30 PM"},
  {id:14, t1:"DC",   t2:"GT",  venue:"Arun Jaitley, Delhi",          date:"Apr 8",  time:"7:30 PM"},
  {id:15, t1:"KKR",  t2:"LSG", venue:"Eden Gardens, Kolkata",        date:"Apr 9",  time:"7:30 PM"},
  {id:16, t1:"RR",   t2:"RCB", venue:"Barsapara, Guwahati",          date:"Apr 10", time:"7:30 PM"},
  {id:17, t1:"PBKS", t2:"SRH", venue:"MYSI, Mullanpur",              date:"Apr 11", time:"3:30 PM"},
  {id:18, t1:"CSK",  t2:"DC",  venue:"Chidambaram, Chennai",         date:"Apr 11", time:"7:30 PM"},
  {id:19, t1:"LSG",  t2:"GT",  venue:"Ekana, Lucknow",               date:"Apr 12", time:"3:30 PM"},
  {id:20, t1:"MI",   t2:"RCB", venue:"Wankhede, Mumbai",             date:"Apr 12", time:"7:30 PM"},
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get player's phase-specific strike rate with form multiplier
 */
export const getPlayerPhaseStats = (playerName, phase, formMultipliers = null) => {
  const player = PLAYERS_BASE[playerName];
  if (!player) return 120;
  const key = `${phase}SR`;
  const baseSR = player[key] || 120;
  if (!formMultipliers) return baseSR;
  const form_mult = formMultipliers.player_form_2026?.[playerName];
  if (!form_mult) return baseSR;
  const phaseMult = form_mult[`${phase}_mult`] || 1.0;
  return baseSR * phaseMult;
};

/**
 * Get bowler's phase-specific economy with form multiplier
 */
export const getBowlerPhaseStats = (bowlerName, phase, formMultipliers = null) => {
  const bowler = BOWLERS_BASE[bowlerName];
  if (!bowler) return 8.8;
  const key = `${phase}Econ`;
  const baseEcon = bowler[key] || 8.8;
  if (!formMultipliers) return baseEcon;
  const form_mult = formMultipliers.bowler_form_2026?.[bowlerName];
  if (!form_mult) return baseEcon;
  const phaseMult = form_mult[`${phase}_mult`] || 1.0;
  return baseEcon * phaseMult;
};

/**
 * Get historical batter-vs-bowler matchup strike rate.
 * Returns null if no data or fewer than 20 balls faced.
 */
export const getMatchupSR = (batter, bowler) => {
  if (!batter || !bowler) return null;
  const matchup = MATCHUPS?.[`${batter}||${bowler}`];
  if (!matchup) return null;
  if ((matchup.balls || 0) < 20) return null; // minimum threshold
  return matchup.sr || null;
};

// FIX 1: getVenueTossData now returns null for unknown venues
// App.jsx checks: if (rawToss !== null) → show real data, else show fallback message
export const getVenueTossData = (venue) => {
  if (!venue) return null;
  const data = TOSS_DATA?.[venue];
  if (!data) return null;
  return data; // shape: { batFirstWin, fieldFirstWin, matches }
};

// FIX 2: getH2H remaps snake_case from shakti_data.json → camelCase for App.jsx
// shakti_data.json stores: t1_win_pct, avg_pp
// App.jsx reads:           t1WinPct,   avgPP
export const getH2H = (team1, team2, venue) => {
  if (!team1 || !team2) return { matches: 0, t1WinPct: 50, last5: [], avgPP: 0 };
  const raw = H2H?.[`${team1}||${team2}||${venue}`];
  if (!raw) return { matches: 0, t1WinPct: 50, last5: [], avgPP: 0 };
  return {
    matches:   raw.matches    || 0,
    t1WinPct:  raw.t1_win_pct || 50,  // remap
    last5:     raw.last5      || [],
    avgPP:     raw.avg_pp     || 0,   // remap
  };
};

// FIX 3: getTeamPPBowlers — NEW function, was missing entirely
// Returns top 3 PP bowlers for a team from real Cricsheet data.
// Used by getTeamPPEconFull() and the Bowlers sub-tab in App.jsx.
export const getTeamPPBowlers = (teamCode) => {
  if (!teamCode) return [];
  const squad = SQUADS[teamCode] || [];
  const bowlers = squad
    .filter(name => BOWLERS_BASE?.[name])          // only players with real bowler data
    .map(name => ({
      name,
      ppEcon: BOWLERS_BASE[name].ppEcon || 8.5,
    }))
    .sort((a, b) => a.ppEcon - b.ppEcon)           // best (lowest) economy first
    .slice(0, 3);                                   // top 3 PP bowlers
  return bowlers; // shape: [{ name: string, ppEcon: number }]
};

/**
 * Get season scoring trend
 */
export const getSeasonTrend = (season) => {
  return SEASON_TRENDS?.[season] || { avg_pp: 53, avg_total: 188, matches: 0 };
};
