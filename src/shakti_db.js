// shakti_db.js — COMPLETE FIX
// All venue, team, and player name mismatches resolved.
// Last updated: March 29, 2026

import shakti_data from './shakti_data.json';

// ============================================================================
// RAW DATA FROM shakti_data.json
// ============================================================================

export const VENUES_BASE   = shakti_data.venues;
export const PLAYERS_BASE  = shakti_data.players;
export const BOWLERS_BASE  = shakti_data.bowlers;
export const MATCHUPS      = shakti_data.matchups;
export const H2H           = shakti_data.h2h;
export const TOSS_DATA     = shakti_data.toss_by_venue;
export const SEASON_TRENDS = shakti_data.season_trends;
export const SHAKTI_META   = shakti_data.meta;

// ============================================================================
// FALLBACKS — exported so App.jsx can use them
// ============================================================================

export const FALLBACK_BATTER = { ppSR:120, midSR:130, deathSR:150, conf:"LOW" };
export const FALLBACK_BOWLER = { ppEcon:8.5, midEcon:8.8, deathEcon:10.0, type:"pace" };
export const FALLBACK_VENUE  = { pp:50, ov10:80, ov12:96, ov15:122, total:165, chase:50, pacePen:1.0, spinPen:1.0 };

// ============================================================================
// VENUE NAME MAPS
// MATCHES uses short names. shakti_data.json uses full stadium names.
// VENUES_BASE, TOSS_DATA, and H2H can use DIFFERENT keys for the same ground.
// ============================================================================

// Short name → key in VENUES_BASE
const VENUE_TO_BASE = {
  "Chinnaswamy, Bangalore":  "M Chinnaswamy Stadium",
  "Wankhede, Mumbai":        "Wankhede Stadium",
  "Eden Gardens, Kolkata":   "Eden Gardens",
  "Arun Jaitley, Delhi":     "Arun Jaitley Stadium",
  "Chidambaram, Chennai":    "MA Chidambaram Stadium",
  "RGISC, Hyderabad":        "Rajiv Gandhi International Stadium",
  "SMS Stadium, Jaipur":     "Sawai Mansingh Stadium",
  "Narendra Modi, Ahmedabad":"Narendra Modi Stadium",
  "MYSI, Mullanpur":         "Punjab Cricket Association IS Bindra Stadium",
  // New venues — no historical data
  "Barsapara, Guwahati":     null,
  "Ekana, Lucknow":          null,
};

// Short name → ordered list of keys to try in TOSS_DATA
// toss_by_venue uses different key formats than VENUES_BASE
const VENUE_TO_TOSS = {
  "Chinnaswamy, Bangalore":  ["M Chinnaswamy Stadium", "M.Chinnaswamy Stadium"],
  "Wankhede, Mumbai":        ["Wankhede Stadium"],
  "Eden Gardens, Kolkata":   ["Eden Gardens"],
  "Arun Jaitley, Delhi":     ["Arun Jaitley Stadium", "Feroz Shah Kotla"],
  "Chidambaram, Chennai":    ["MA Chidambaram Stadium", "MA Chidambaram Stadium, Chepauk, Chennai"],
  "RGISC, Hyderabad":        ["Rajiv Gandhi International Stadium, Uppal", "Rajiv Gandhi International Stadium"],
  "SMS Stadium, Jaipur":     ["Sawai Mansingh Stadium"],
  "Narendra Modi, Ahmedabad":["Narendra Modi Stadium", "Sardar Patel Stadium, Motera"],
  "MYSI, Mullanpur":         ["Punjab Cricket Association IS Bindra Stadium, Mohali", "Punjab Cricket Association IS Bindra Stadium"],
  "Barsapara, Guwahati":     [],
  "Ekana, Lucknow":          [],
};

// Short name → ordered list of venue name variants to try in H2H keys
// H2H uses historical names (Feroz Shah Kotla, etc.)
const VENUE_TO_H2H = {
  "Chinnaswamy, Bangalore":  ["M Chinnaswamy Stadium", "M.Chinnaswamy Stadium"],
  "Wankhede, Mumbai":        ["Wankhede Stadium"],
  "Eden Gardens, Kolkata":   ["Eden Gardens"],
  "Arun Jaitley, Delhi":     ["Feroz Shah Kotla", "Arun Jaitley Stadium"],
  "Chidambaram, Chennai":    ["MA Chidambaram Stadium", "MA Chidambaram Stadium, Chepauk, Chennai"],
  "RGISC, Hyderabad":        ["Rajiv Gandhi International Stadium, Uppal", "Rajiv Gandhi International Stadium"],
  "SMS Stadium, Jaipur":     ["Sawai Mansingh Stadium"],
  "Narendra Modi, Ahmedabad":["Narendra Modi Stadium", "Sardar Patel Stadium, Motera"],
  "MYSI, Mullanpur":         ["Punjab Cricket Association IS Bindra Stadium, Mohali", "Punjab Cricket Association IS Bindra Stadium"],
  "Barsapara, Guwahati":     [],
  "Ekana, Lucknow":          [],
};

// ============================================================================
// TEAM NAME MAP
// App uses codes (RCB). H2H keys use full names (current + historical).
// ============================================================================

const TEAM_NAMES = {
  RCB:  ["Royal Challengers Bangalore", "Royal Challengers Bengaluru"],
  MI:   ["Mumbai Indians"],
  CSK:  ["Chennai Super Kings"],
  KKR:  ["Kolkata Knight Riders"],
  SRH:  ["Sunrisers Hyderabad"],
  RR:   ["Rajasthan Royals"],
  DC:   ["Delhi Capitals", "Delhi Daredevils"],
  PBKS: ["Punjab Kings", "Kings XI Punjab"],
  GT:   ["Gujarat Titans"],
  LSG:  ["Lucknow Super Giants"],
};

// ============================================================================
// PLAYER NAME MAP
// SQUADS uses full names ("Virat Kohli").
// shakti_data.json uses Cricsheet abbreviated names ("V Kohli").
// This map covers all IPL 2026 squad members.
// ============================================================================

const PLAYER_NAME_MAP = {
  // CSK
  "Ruturaj Gaikwad":     "RD Gaikwad",
  "Devon Conway":        "DP Conway",
  "Rachin Ravindra":     "Rachin Ravindra",
  "Shivam Dube":         "SH Dube",
  "MS Dhoni":            "MS Dhoni",
  "Ravindra Jadeja":     "RA Jadeja",
  "Deepak Chahar":       "DL Chahar",
  "Matheesha Pathirana": "MCM Pathirana",
  "Khaleel Ahmed":       "Khaleel Ahmed",
  "Noor Ahmad":          "Noor Ahmad",
  "Sam Curran":          "SM Curran",
  "Shahrukh Khan":       "Shahrukh Khan",
  // MI
  "Rohit Sharma":        "RG Sharma",
  "Suryakumar Yadav":    "SK Yadav",
  "Hardik Pandya":       "HH Pandya",
  "Ishan Kishan":        "IK Kishan",
  "Tim David":           "TH David",
  "Tilak Varma":         "Tilak Varma",
  "Will Jacks":          "WG Jacks",
  "Jasprit Bumrah":      "JJ Bumrah",
  "Trent Boult":         "TA Boult",
  "Harshit Rana":        "Harshit Rana",
  "Karn Sharma":         "K Sharma",
  // RCB
  "Virat Kohli":         "V Kohli",
  "Phil Salt":           "PD Salt",
  "Rajat Patidar":       "Rajat Patidar",
  "Jacob Bethell":       "JM Bethell",
  "Glenn Maxwell":       "GJ Maxwell",
  "Liam Livingstone":    "LS Livingstone",
  "Krunal Pandya":       "KH Pandya",
  "Josh Hazlewood":      "JR Hazlewood",
  "Mohammed Siraj":      "Mohammed Siraj",
  "Yash Dayal":          "Yash Dayal",
  "Suyash Sharma":       "Suyash Sharma",
  "Rasikh Dar":          "Rasikh Salam Dar",
  // KKR
  "Ajinkya Rahane":      "AM Rahane",
  "Quinton de Kock":     "Q de Kock",
  "Finn Allen":          "FH Allen",
  "Tim Seifert":         "TS Seifert",
  "Sunil Narine":        "SP Narine",
  "Andre Russell":       "AD Russell",
  "Rinku Singh":         "Rinku Singh",
  "Venkatesh Iyer":      "Venkatesh Iyer",
  "Varun Chakravarthy":  "VR Chakravarthy",
  "Mitchell Starc":      "MA Starc",
  "Spencer Johnson":     "SA Johnson",
  "Anrich Nortje":       "A Nortje",
  // SRH
  "Travis Head":         "TM Head",
  "Abhishek Sharma":     "Abhishek Sharma",
  "Heinrich Klaasen":    "HE Klaasen",
  "Nitish Kumar Reddy":  "Nitish Kumar Reddy",
  "Pat Cummins":         "PJ Cummins",
  "Bhuvneshwar Kumar":   "B Kumar",
  "T Natarajan":         "T Natarajan",
  "Harshal Patel":       "Harshal Patel",
  "Simarjeet Singh":     "Simarjeet Singh",
  "Jaydev Unadkat":      "JD Unadkat",
  // RR
  "Yashasvi Jaiswal":    "YBK Jaiswal",
  "Sanju Samson":        "SV Samson",
  "Riyan Parag":         "Riyan Parag",
  "Shimron Hetmyer":     "SO Hetmyer",
  "Dhruv Jurel":         "Dhruv Jurel",
  "Shubham Dubey":       "Shubham Dubey",
  "Yuzvendra Chahal":    "YS Chahal",
  "Sandeep Sharma":      "Sandeep Sharma",
  "Prasidh Krishna":     "P Krishna",
  "Wanindu Hasaranga":   "PWH de Silva",
  // DC
  "Jake Fraser-McGurk":  "JP Fraser-McGurk",
  "Harry Brook":         "HP Brook",
  "Faf du Plessis":      "F du Plessis",
  "Mitchell Marsh":      "MR Marsh",
  "Tristan Stubbs":      "TL Stubbs",
  "Axar Patel":          "AR Patel",
  "KL Rahul":            "KL Rahul",
  "Kuldeep Yadav":       "Kuldeep Yadav",
  "Mukesh Kumar":        "Mukesh Kumar",
  "Mohsin Khan":         "Mohsin Khan",
  // PBKS
  "Prabhsimran Singh":   "Prabhsimran Singh",
  "Shreyas Iyer":        "SS Iyer",
  "Jonny Bairstow":      "JM Bairstow",
  "Marcus Stoinis":      "MP Stoinis",
  "Shashank Singh":      "Shashank Singh",
  "Arshdeep Singh":      "Arshdeep Singh",
  "Kagiso Rabada":       "K Rabada",
  "Azmatullah Omarzai":  "Azmatullah Omarzai",
  "Vishnu Vinod":        "Vishnu Vinod",
  "Harpreet Brar":       "Harpreet Brar",
  // GT
  "Shubman Gill":        "Shubman Gill",
  "Sai Sudharsan":       "B Sai Sudharsan",
  "David Miller":        "DA Miller",
  "Rahul Tewatia":       "Rahul Tewatia",
  "Washington Sundar":   "W Sundar",
  "Rashid Khan":         "Rashid Khan",
  "Mohammed Shami":      "Mohammed Shami",
  "Manav Suthar":        "Manav Suthar",
  // LSG
  "Nicholas Pooran":     "N Pooran",
  "Aiden Markram":       "AK Markram",
  "Deepak Hooda":        "Deepak Hooda",
  "Ravi Bishnoi":        "Ravi Bishnoi",
  "Avesh Khan":          "Avesh Khan",
  "Mark Wood":           "MA Wood",
  "Mayank Yadav":        "Mayank Yadav",
  "Akash Deep":          "Akash Deep",
  "Naveen ul Haq":       "Naveen-ul-Haq",
};

// ============================================================================
// IPL 2026 HARDCODED DATA
// ============================================================================

export const SQUADS = {
  CSK:  ["Ruturaj Gaikwad","Devon Conway","Rachin Ravindra","Shivam Dube","MS Dhoni","Ravindra Jadeja","Deepak Chahar","Matheesha Pathirana","Khaleel Ahmed","Noor Ahmad","Sam Curran","Shahrukh Khan"],
  MI:   ["Rohit Sharma","Suryakumar Yadav","Hardik Pandya","Ishan Kishan","Tim David","Tilak Varma","Will Jacks","Jasprit Bumrah","Trent Boult","Deepak Chahar","Harshit Rana","Karn Sharma"],
  RCB:  ["Virat Kohli","Phil Salt","Rajat Patidar","Jacob Bethell","Glenn Maxwell","Liam Livingstone","Krunal Pandya","Josh Hazlewood","Mohammed Siraj","Yash Dayal","Suyash Sharma","Rasikh Dar"],
  KKR:  ["Ajinkya Rahane","Quinton de Kock","Finn Allen","Tim Seifert","Sunil Narine","Andre Russell","Rinku Singh","Venkatesh Iyer","Varun Chakravarthy","Mitchell Starc","Spencer Johnson","Anrich Nortje"],
  SRH:  ["Travis Head","Abhishek Sharma","Heinrich Klaasen","Nitish Kumar Reddy","Pat Cummins","Bhuvneshwar Kumar","T Natarajan","Harshal Patel","Simarjeet Singh","Jaydev Unadkat"],
  RR:   ["Yashasvi Jaiswal","Sanju Samson","Riyan Parag","Shimron Hetmyer","Dhruv Jurel","Shubham Dubey","Trent Boult","Yuzvendra Chahal","Sandeep Sharma","Prasidh Krishna","Wanindu Hasaranga"],
  DC:   ["Jake Fraser-McGurk","Harry Brook","Faf du Plessis","Mitchell Marsh","Tristan Stubbs","Axar Patel","KL Rahul","Kuldeep Yadav","Anrich Nortje","Khaleel Ahmed","Mukesh Kumar","Mohsin Khan"],
  PBKS: ["Prabhsimran Singh","Shreyas Iyer","Jonny Bairstow","Marcus Stoinis","Sam Curran","Shashank Singh","Arshdeep Singh","Kagiso Rabada","Yuzvendra Chahal","Azmatullah Omarzai","Vishnu Vinod","Harpreet Brar"],
  GT:   ["Shubman Gill","Sai Sudharsan","David Miller","Shahrukh Khan","Rahul Tewatia","Washington Sundar","Rashid Khan","Mohammed Shami","Spencer Johnson","Noor Ahmad","Prasidh Krishna","Manav Suthar"],
  LSG:  ["KL Rahul","Nicholas Pooran","Aiden Markram","Mitchell Marsh","Deepak Hooda","Ravi Bishnoi","Avesh Khan","Mark Wood","Mayank Yadav","Mohsin Khan","Akash Deep","Naveen ul Haq"],
};

export const MATCHES = [
  {id:1,  t1:"RCB",  t2:"SRH",  venue:"Chinnaswamy, Bangalore",    date:"Mar 28", time:"7:30 PM"},
  {id:2,  t1:"MI",   t2:"KKR",  venue:"Wankhede, Mumbai",           date:"Mar 29", time:"7:30 PM"},
  {id:3,  t1:"RR",   t2:"CSK",  venue:"Barsapara, Guwahati",        date:"Mar 30", time:"7:30 PM"},
  {id:4,  t1:"PBKS", t2:"GT",   venue:"MYSI, Mullanpur",            date:"Mar 31", time:"3:30 PM"},
  {id:5,  t1:"LSG",  t2:"DC",   venue:"Ekana, Lucknow",             date:"Mar 31", time:"7:30 PM"},
  {id:6,  t1:"KKR",  t2:"SRH",  venue:"Eden Gardens, Kolkata",      date:"Apr 1",  time:"7:30 PM"},
  {id:7,  t1:"CSK",  t2:"PBKS", venue:"Chidambaram, Chennai",       date:"Apr 3",  time:"7:30 PM"},
  {id:8,  t1:"DC",   t2:"MI",   venue:"Arun Jaitley, Delhi",        date:"Apr 4",  time:"3:30 PM"},
  {id:9,  t1:"GT",   t2:"RR",   venue:"Narendra Modi, Ahmedabad",   date:"Apr 4",  time:"7:30 PM"},
  {id:10, t1:"SRH",  t2:"LSG",  venue:"RGISC, Hyderabad",           date:"Apr 5",  time:"3:30 PM"},
  {id:11, t1:"RCB",  t2:"CSK",  venue:"Chinnaswamy, Bangalore",     date:"Apr 5",  time:"7:30 PM"},
  {id:12, t1:"KKR",  t2:"PBKS", venue:"Eden Gardens, Kolkata",      date:"Apr 6",  time:"7:30 PM"},
  {id:13, t1:"RR",   t2:"MI",   venue:"Barsapara, Guwahati",        date:"Apr 7",  time:"7:30 PM"},
  {id:14, t1:"DC",   t2:"GT",   venue:"Arun Jaitley, Delhi",        date:"Apr 8",  time:"7:30 PM"},
  {id:15, t1:"KKR",  t2:"LSG",  venue:"Eden Gardens, Kolkata",      date:"Apr 9",  time:"7:30 PM"},
  {id:16, t1:"RR",   t2:"RCB",  venue:"Barsapara, Guwahati",        date:"Apr 10", time:"7:30 PM"},
  {id:17, t1:"PBKS", t2:"SRH",  venue:"MYSI, Mullanpur",            date:"Apr 11", time:"3:30 PM"},
  {id:18, t1:"CSK",  t2:"DC",   venue:"Chidambaram, Chennai",       date:"Apr 11", time:"7:30 PM"},
  {id:19, t1:"LSG",  t2:"GT",   venue:"Ekana, Lucknow",             date:"Apr 12", time:"3:30 PM"},
  {id:20, t1:"MI",   t2:"RCB",  venue:"Wankhede, Mumbai",           date:"Apr 12", time:"7:30 PM"},
];

// ============================================================================
// INTERNAL RESOLUTION HELPERS
// ============================================================================

// Resolve short venue name → VENUES_BASE key
function resolveVenueBase(shortName) {
  if (!shortName) return null;
  if (VENUES_BASE[shortName]) return shortName;       // already full name
  const mapped = VENUE_TO_BASE[shortName];
  if (mapped && VENUES_BASE[mapped]) return mapped;
  return null;
}

// ============================================================================
// EXPORTED HELPER FUNCTIONS
// ============================================================================

/**
 * Get venue data by short name (resolves via VENUE_TO_BASE map).
 * Returns null for new venues or unrecognised names.
 * App.jsx uses this in calibratedVenue, calcPreMatchWinProb, calcLiveWinProb.
 */
export const getVenueData = (shortName) => {
  const key = resolveVenueBase(shortName);
  return key ? VENUES_BASE[key] : null;
};

/**
 * Resolve full player name → Cricsheet abbreviated key for PLAYERS_BASE.
 * Returns the resolved key string, or null if not found.
 */
export const resolvePlayerName = (fullName) => {
  if (!fullName) return null;
  if (PLAYERS_BASE[fullName]) return fullName;                  // already correct
  const mapped = PLAYER_NAME_MAP[fullName];
  if (mapped && PLAYERS_BASE[mapped]) return mapped;            // found via map
  return null;
};

/**
 * Resolve full player name → Cricsheet abbreviated key for BOWLERS_BASE.
 * Returns the resolved key string, or null if not found.
 */
export const resolveBowlerName = (fullName) => {
  if (!fullName) return null;
  if (BOWLERS_BASE[fullName]) return fullName;
  const mapped = PLAYER_NAME_MAP[fullName];
  if (mapped && BOWLERS_BASE[mapped]) return mapped;
  return null;
};

/**
 * Get player phase stats with optional form multiplier.
 * Handles name resolution internally.
 */
export const getPlayerPhaseStats = (fullName, phase, formMultipliers = null) => {
  const key = resolvePlayerName(fullName);
  const player = key ? PLAYERS_BASE[key] : null;
  if (!player) return 120;
  const baseSR = player[`${phase}SR`] || 120;
  if (!formMultipliers) return baseSR;
  const form = formMultipliers.player_form_2026?.[key];
  if (!form) return baseSR;
  return baseSR * (form[`${phase}_mult`] || 1.0);
};

/**
 * Get bowler phase stats with optional form multiplier.
 * Handles name resolution internally.
 */
export const getBowlerPhaseStats = (fullName, phase, formMultipliers = null) => {
  const key = resolveBowlerName(fullName);
  const bowler = key ? BOWLERS_BASE[key] : null;
  if (!bowler) return 8.8;
  const baseEcon = bowler[`${phase}Econ`] || 8.8;
  if (!formMultipliers) return baseEcon;
  const form = formMultipliers.bowler_form_2026?.[key];
  if (!form) return baseEcon;
  return baseEcon * (form[`${phase}_mult`] || 1.0);
};

/**
 * Get batter-vs-bowler matchup SR. Resolves both names internally.
 * Returns null if <20 balls or no data.
 */
export const getMatchupSR = (batterFull, bowlerFull) => {
  if (!batterFull || !bowlerFull) return null;
  const batter = resolvePlayerName(batterFull) || batterFull;
  const bowler = resolveBowlerName(bowlerFull) || bowlerFull;
  const matchup = MATCHUPS?.[`${batter}||${bowler}`];
  if (!matchup || (matchup.balls || 0) < 20) return null;
  return matchup.sr || null;
};

/**
 * Get venue toss data. Tries multiple key variants (TOSS_DATA uses
 * different names than VENUES_BASE — e.g. "Rajiv Gandhi International
 * Stadium, Uppal" vs "Rajiv Gandhi International Stadium").
 * Returns null if no data found (App.jsx shows "No historical data").
 */
export const getVenueTossData = (shortName) => {
  if (!shortName) return null;
  const candidates = VENUE_TO_TOSS[shortName] || [];
  for (const key of candidates) {
    const data = TOSS_DATA?.[key];
    if (data) return data;    // shape: { batFirstWin, fieldFirstWin, matches }
  }
  return null;
};

/**
 * Get H2H record for two team codes at a venue.
 * Tries all combinations of:
 *   - current + historical team full names
 *   - current + historical venue names (Feroz Shah Kotla etc.)
 *   - both team orderings (with win pct flipped for reverse)
 * Returns safe fallback if no record found.
 */
export const getH2H = (team1Code, team2Code, shortVenue) => {
  const EMPTY = { matches: 0, t1WinPct: 50, last5: [], avgPP: 0 };
  if (!team1Code || !team2Code) return EMPTY;

  const t1Names  = TEAM_NAMES[team1Code]  || [team1Code];
  const t2Names  = TEAM_NAMES[team2Code]  || [team2Code];
  const venues   = (shortVenue && VENUE_TO_H2H[shortVenue]) || (shortVenue ? [shortVenue] : [""]);

  for (const venue of venues) {
    for (const t1 of t1Names) {
      for (const t2 of t2Names) {
        // Normal order
        const raw = H2H?.[`${t1}||${t2}||${venue}`];
        if (raw) return {
          matches:  raw.matches    || 0,
          t1WinPct: raw.t1_win_pct || 50,
          last5:    raw.last5      || [],
          avgPP:    raw.avg_pp     || 0,
        };
        // Reversed order — flip win pct and results
        const rawRev = H2H?.[`${t2}||${t1}||${venue}`];
        if (rawRev) return {
          matches:  rawRev.matches || 0,
          t1WinPct: 100 - (rawRev.t1_win_pct || 50),
          last5:    (rawRev.last5 || []).map(v => v === 1 ? 0 : 1),
          avgPP:    rawRev.avg_pp  || 0,
        };
      }
    }
  }
  return EMPTY;
};

/**
 * Get top 3 PP bowlers for a team from real Cricsheet data.
 * Resolves full squad names to Cricsheet names before lookup.
 * Returns [{ name (full), ppEcon }] sorted best economy first.
 */
export const getTeamPPBowlers = (teamCode) => {
  if (!teamCode) return [];
  const squad = SQUADS[teamCode] || [];
  return squad
    .map(fullName => {
      const key = resolveBowlerName(fullName);
      if (!key) return null;
      return { name: fullName, ppEcon: BOWLERS_BASE[key].ppEcon || 8.5 };
    })
    .filter(Boolean)
    .sort((a, b) => a.ppEcon - b.ppEcon)
    .slice(0, 3);
};

/**
 * Get season scoring trend.
 */
export const getSeasonTrend = (season) => {
  return SEASON_TRENDS?.[season] || { avg_pp: 53, avg_total: 188, matches: 0 };
};
