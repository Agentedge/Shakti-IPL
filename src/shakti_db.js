// shakti_db.js - UPDATED
// Imports real Cricsheet data from shakti_data.json
// Maintains backward compatibility with App.jsx
// Last updated: March 29, 2026

import shakti_data from './shakti_data.json';

// ============================================================================
// EXTRACT AND EXPORT REAL DATA FROM shakti_data.json
// ============================================================================

// Venues: Real baselines from 9,426 matches (2008-2026)
export const VENUES_BASE = shakti_data.venues;

// Players: Real statistics from Cricsheet (ppSR, midSR, deathSR by phase)
export const PLAYERS_BASE = shakti_data.players;

// Bowlers: Real economy rates from Cricsheet (ppEcon, midEcon, deathEcon)
export const BOWLERS_BASE = shakti_data.bowlers;

// New: Batter-vs-bowler matchups (20,353 real combinations)
export const MATCHUPS = shakti_data.matchups;

// New: Team H2H records (venue-specific, 5,964 records)
export const H2H = shakti_data.h2h;

// New: Toss data by venue (real win % from 2008-2025)
export const TOSS_DATA = shakti_data.toss_by_venue;

// New: Season trends (scoring evolution 2008-2025)
export const SEASON_TRENDS = shakti_data.season_trends;

// Metadata
export const SHAKTI_META = shakti_data.meta;

// ============================================================================
// IPL 2026 HARDCODED DATA (not in shakti_data.json)
// ============================================================================

// Team squads for IPL 2026 (from official announcement)
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

// IPL 2026 Phase 1 Schedule (March 28 - April 12)
export const MATCHES = [
  {id:1, t1:"RCB", t2:"SRH", venue:"Chinnaswamy, Bangalore", date:"Mar 28", time:"7:30 PM"},
  {id:2, t1:"MI", t2:"KKR", venue:"Wankhede, Mumbai", date:"Mar 29", time:"7:30 PM"},
  {id:3, t1:"RR", t2:"CSK", venue:"Barsapara, Guwahati", date:"Mar 30", time:"7:30 PM"},
  {id:4, t1:"PBKS", t2:"GT", venue:"MYSI, Mullanpur", date:"Mar 31", time:"3:30 PM"},
  {id:5, t1:"LSG", t2:"DC", venue:"Ekana, Lucknow", date:"Mar 31", time:"7:30 PM"},
  {id:6, t1:"KKR", t2:"SRH", venue:"Eden Gardens, Kolkata", date:"Apr 1", time:"7:30 PM"},
  {id:7, t1:"CSK", t2:"PBKS", venue:"Chidambaram, Chennai", date:"Apr 3", time:"7:30 PM"},
  {id:8, t1:"DC", t2:"MI", venue:"Arun Jaitley, Delhi", date:"Apr 4", time:"3:30 PM"},
  {id:9, t1:"GT", t2:"RR", venue:"Narendra Modi, Ahmedabad", date:"Apr 4", time:"7:30 PM"},
  {id:10, t1:"SRH", t2:"LSG", venue:"RGISC, Hyderabad", date:"Apr 5", time:"3:30 PM"},
  {id:11, t1:"RCB", t2:"CSK", venue:"Chinnaswamy, Bangalore", date:"Apr 5", time:"7:30 PM"},
  {id:12, t1:"KKR", t2:"PBKS", venue:"Eden Gardens, Kolkata", date:"Apr 6", time:"7:30 PM"},
  {id:13, t1:"RR", t2:"MI", venue:"Barsapara, Guwahati", date:"Apr 7", time:"7:30 PM"},
  {id:14, t1:"DC", t2:"GT", venue:"Arun Jaitley, Delhi", date:"Apr 8", time:"7:30 PM"},
  {id:15, t1:"KKR", t2:"LSG", venue:"Eden Gardens, Kolkata", date:"Apr 9", time:"7:30 PM"},
  {id:16, t1:"RR", t2:"RCB", venue:"Barsapara, Guwahati", date:"Apr 10", time:"7:30 PM"},
  {id:17, t1:"PBKS", t2:"SRH", venue:"MYSI, Mullanpur", date:"Apr 11", time:"3:30 PM"},
  {id:18, t1:"CSK", t2:"DC", venue:"Chidambaram, Chennai", date:"Apr 11", time:"7:30 PM"},
  {id:19, t1:"LSG", t2:"GT", venue:"Ekana, Lucknow", date:"Apr 12", time:"3:30 PM"},
  {id:20, t1:"MI", t2:"RCB", venue:"Wankhede, Mumbai", date:"Apr 12", time:"7:30 PM"},
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get player's phase-specific strike rate with form multiplier
 * @param {string} playerName - Full player name
 * @param {string} phase - 'pp', 'mid', or 'death'
 * @param {object} formMultipliers - From learning_state.json (optional)
 * @returns {number} Adjusted strike rate
 */
export const getPlayerPhaseStats = (playerName, phase, formMultipliers = null) => {
  const player = PLAYERS_BASE[playerName];
  if (!player) return 120; // Default fallback
  
  const key = `${phase}SR`;
  const baseSR = player[key] || 120;
  
  if (!formMultipliers) return baseSR;
  
  // Apply phase-specific form multiplier (if available)
  const form_mult = formMultipliers.player_form_2026[playerName];
  if (!form_mult) return baseSR;
  
  const phaseMultKey = `${phase}_mult`;
  const phaseMult = form_mult[phaseMultKey] || 1.0;
  
  return baseSR * phaseMult;
};

/**
 * Get bowler's phase-specific economy with form multiplier
 * @param {string} bowlerName - Full bowler name
 * @param {string} phase - 'pp', 'mid', or 'death'
 * @param {object} formMultipliers - From learning_state.json (optional)
 * @returns {number} Adjusted economy rate
 */
export const getBowlerPhaseStats = (bowlerName, phase, formMultipliers = null) => {
  const bowler = BOWLERS_BASE[bowlerName];
  if (!bowler) return 8.8; // Default fallback
  
  const key = `${phase}Econ`;
  const baseEcon = bowler[key] || 8.8;
  
  if (!formMultipliers) return baseEcon;
  
  // Apply phase-specific form multiplier (if available)
  const form_mult = formMultipliers.bowler_form_2026[bowlerName];
  if (!form_mult) return baseEcon;
  
  const phaseMultKey = `${phase}_mult`;
  const phaseMult = form_mult[phaseMultKey] || 1.0;
  
  return baseEcon * phaseMult;
};

/**
 * Get historical matchup strike rate (if exists)
 * @param {string} batter - Batter name
 * @param {string} bowler - Bowler name
 * @returns {number} Historical SR or null if no data
 */
export const getMatchupSR = (batter, bowler) => {
  const matchupKey = `${batter}||${bowler}`;
  const matchup = MATCHUPS[matchupKey];
  return matchup ? matchup.sr : null;
};

/**
 * Get venue toss data
 * @param {string} venue - Venue name
 * @returns {object} {batFirstWin, fieldFirstWin, matches}
 */
export const getVenueTossData = (venue) => {
  return TOSS_DATA[venue] || { batFirstWin: 50, fieldFirstWin: 50, matches: 0 };
};

/**
 * Get H2H record for two teams at a venue
 * @param {string} team1
 * @param {string} team2
 * @param {string} venue
 * @returns {object} {matches, t1_win_pct, avg_pp}
 */
export const getH2H = (team1, team2, venue) => {
  const h2hKey = `${team1}||${team2}||${venue}`;
  return H2H[h2hKey] || { matches: 0, t1_win_pct: 50, avg_pp: 0 };
};

/**
 * Get season scoring trend
 * @param {number} season - Year (e.g., 2025)
 * @returns {object} {avg_pp, avg_total, matches}
 */
export const getSeasonTrend = (season) => {
  return SEASON_TRENDS[season] || { avg_pp: 53, avg_total: 188, matches: 0 };
};

// ============================================================================
// EXPORTS SUMMARY
// ============================================================================

/*
REAL DATA (from shakti_data.json):
- VENUES_BASE: 455 venues with pp, ov10, ov12, ov15, total, chase%, pacePen, spinPen
- PLAYERS_BASE: 6,673 players with ppSR, midSR, deathSR, conf, by_season
- BOWLERS_BASE: 4,986 bowlers with ppEcon, midEcon, deathEcon, type
- MATCHUPS: 20,353 batter-vs-bowler pairs (sr, balls)
- H2H: 5,964 team records by venue
- TOSS_DATA: Real toss win % by venue
- SEASON_TRENDS: 1985-2025 scoring evolution
- SHAKTI_META: Metadata (source, decay_factor, form_weighting strategy)

HARDCODED FOR IPL 2026:
- SQUADS: 10 team rosters
- MATCHES: Phase 1 schedule (20 matches)

HELPER FUNCTIONS:
- getPlayerPhaseStats(name, phase, formMultipliers?)
- getBowlerPhaseStats(name, phase, formMultipliers?)
- getMatchupSR(batter, bowler)
- getVenueTossData(venue)
- getH2H(team1, team2, venue)
- getSeasonTrend(season)
*/
