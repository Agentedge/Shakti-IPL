import { useState, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { VENUES_BASE, PLAYERS_BASE, BOWLERS_BASE, SQUADS, MATCHES } from "./shakti_db.js";
import { H2H, TOSS_INTEL, PP_BOWLERS, IMPACT_PLAYERS } from "./shakti_extra.js";
import { syncLastMatch, applyFormToPlayer, applyFormToBowler } from "./cricket_sync.js";
import { findMatchId, fetchTossAndPlaying11, fetchLiveScorecard, getRemainingBattingStrength, getRemainingBowlingStrength, BATTING_ORDERS, BOWLING_ROTATION } from "./playing11_engine.js";

// ── Constants ─────────────────────────────────────────────────
const C = {
  bg:"#fdf6ee",panel:"#fff8f2",card:"#ffffff",border:"#e8d5c0",
  borderS:"#c9a87c",crimson:"#9b0020",crimsonL:"#c0002a",
  gold:"#b8860b",goldL:"#d4a017",goldXL:"#f0b429",
  green:"#166534",greenL:"#16a34a",red:"#991b1b",
  blue:"#1e40af",dim:"#a08060",muted:"#78604a",
  text:"#2d1a0e",sub:"#6b4c30",white:"#ffffff",
};
const TEAM_COL={CSK:"#c8941a",MI:"#004ba0",RCB:"#9b0020",KKR:"#5b21b6",SRH:"#c2410c",RR:"#1e3a8a",DC:"#1e40af",PBKS:"#9b1a1a",GT:"#1e3a5f",LSG:"#4d7c0f"};
const INIT_BR=10000,TARGET=300000;
const MILESTONES=[25000,50000,100000,150000,200000,250000,300000];
const MILESTONE_LOCKS={25000:0,50000:25000,100000:60000,150000:100000,200000:150000,250000:200000,300000:200000};
const STORAGE_KEY="shakti_v9_state";
const BETS=[
  {id:"pp",    label:"Powerplay",  sub:"Runs 0-6",   icon:"⚡",tier:"A",color:C.crimson},
  {id:"ov10",  label:"10 Overs",   sub:"Total at 10",icon:"📍",tier:"B",color:C.crimson},
  {id:"ov12",  label:"12 Overs",   sub:"Total at 12",icon:"📍",tier:"B",color:C.gold},
  {id:"ov15",  label:"15 Overs",   sub:"Total at 15",icon:"📌",tier:"B",color:C.gold},
  {id:"total", label:"1st Innings",sub:"Full total",  icon:"🏏",tier:"B",color:C.gold},
  {id:"winner",label:"Match Winner",sub:"Win prob",  icon:"🏆",tier:"A",color:C.green},
  {id:"over",  label:"Over by Over",sub:"Next over", icon:"🎲",tier:"C",color:C.muted},
];

// ── Storage ────────────────────────────────────────────────────
function loadState(){try{const r=localStorage.getItem(STORAGE_KEY);return r?JSON.parse(r):null;}catch{return null;}}
function saveState(s){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(s));}catch{}}

// ── Bankroll ───────────────────────────────────────────────────
function rawStake(br,stage,base,ks){
  if(stage===3) return Math.max(0,br-base);
  return Math.round(br*(ks?0.10:0.15));
}
function tStake(raw,tier){return Math.round(raw*(tier==="A"?1:tier==="B"?0.7:0.4));}
function tierCol(t){return t==="A"?C.crimson:t==="B"?C.gold:C.muted;}

// ── Team helpers ───────────────────────────────────────────────
function getTeamPPSR(tc){
  const s=SQUADS[tc]||[];
  const op=s.slice(0,3);
  const srs=op.map(p=>PLAYERS_BASE[p]?.ppSR||120);
  return srs[0]*0.40+(srs[1]||srs[0])*0.35+(srs[2]||srs[0])*0.25;
}
function getTeamPPEconFull(tc){
  const bwls=PP_BOWLERS[tc]||[];
  if(!bwls.length)return 8.5;
  const ec=bwls.map(b=>b.e);
  return ec[0]*0.45+(ec[1]||ec[0])*0.35+(ec[2]||ec[0])*0.20;
}
function getH2H(t1,t2){return H2H[t1+"-"+t2]||{total:10,t1wins:5,last5:[1,0,1,0,1],venueEdge:{}};}

// ── Implied probability from platform odds ─────────────────────
function impliedProb(favOdds,undOdds,role){
  if(role==="fav"){
    const profitIfWin=favOdds;
    return Math.round(100/(100+profitIfWin)*100);
  } else {
    const profitIfWin=100/undOdds*100;
    return Math.round(100/(100+profitIfWin)*100);
  }
}

// ── Expected Value ─────────────────────────────────────────────
function calcEV(realProbPct,impliedProbPct,stake){
  const rp=realProbPct/100;
  const ip=impliedProbPct/100;
  const odds=(1/ip)-1; // decimal odds minus 1
  return Math.round((rp*odds-(1-rp))*stake);
}

// ── Phase Probability Model ────────────────────────────────────
function phaseProbDist(predicted,variance){
  // Normal distribution approximation
  // P(X > threshold) = 1 - Φ((threshold - mean) / sd)
  const sd=variance*0.6; // variance is half-range, sd is 60% of that
  function phi(x){
    const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
    const sign=x<0?-1:1; const absX=Math.abs(x);
    const t=1.0/(1.0+p*absX);
    const y=1.0-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-absX*absX);
    return 0.5*(1.0+sign*y);
  }
  const overLines=[predicted-10,predicted-5,predicted,predicted+5,predicted+10];
  return overLines.map(line=>({
    line,
    probOver:Math.round((1-phi((line-predicted)/Math.max(1,sd)))*100),
    probUnder:Math.round(phi((line-predicted)/Math.max(1,sd))*100),
  }));
}

// ── Win Probability ────────────────────────────────────────────
function calcPreMatchWinProb(t1,t2,venue,toss){
  const v=VENUES_BASE[venue]||{};
  const battingFirst=toss==="batting"?t1:t2;
  const vChase=(v.chase||50)/100;
  const t1PPSR=getTeamPPSR(t1),t2PPSR=getTeamPPSR(t2);
  const t1PPE=getTeamPPEconFull(t1),t2PPE=getTeamPPEconFull(t2);
  let prob=0.50;
  const batEdge=battingFirst===t1?(t1PPSR-t2PPSR)/180:(t2PPSR-t1PPSR)/180;
  prob+=batEdge;
  const bowlEdge=battingFirst!==t1?(t2PPE-t1PPE)/35:(t1PPE-t2PPE)/35;
  prob-=bowlEdge;
  if(battingFirst===t1)prob+=(0.50-vChase)*0.18;
  else prob+=(vChase-0.50)*0.18;
  // H2H adjustment
  const h=getH2H(t1,t2);
  if(h.total>=10){const h2hEdge=(h.t1wins/h.total-0.5)*0.12;prob+=h2hEdge;}
  // Recent form (last 5)
  const recentT1=h.last5.reduce((s,v)=>s+v,0)/5;
  prob+=(recentT1-0.5)*0.06;
  // Hot players
  const t1Hot=(SQUADS[t1]||[]).filter(p=>{const pl=PLAYERS_BASE[p];return pl?.wc2026_sr&&pl.wc2026_sr>pl.ppSR*1.12;}).length;
  const t2Hot=(SQUADS[t2]||[]).filter(p=>{const pl=PLAYERS_BASE[p];return pl?.wc2026_sr&&pl.wc2026_sr>pl.ppSR*1.12;}).length;
  prob+=(t1Hot-t2Hot)*0.022;
  return Math.round(Math.max(0.28,Math.min(0.72,prob))*100);
}

function calcLiveWinProb(score,wickets,overs,target,venue,battingTeam,chasingTeam,is2nd){
  const v=VENUES_BASE[venue]||{};
  if(is2nd&&target>0){
    const needed=target-score;
    const ballsLeft=Math.max(1,(20-overs)*6);
    const reqRR=(needed/ballsLeft)*6;
    const avgSR=overs<6?getTeamPPSR(chasingTeam):(SQUADS[chasingTeam]||[]).slice(0,5).map(p=>PLAYERS_BASE[p]?.midSR||130).reduce((a,b)=>a+b,0)/5;
    const projRR=avgSR/100*6;
    const rrRatio=Math.max(0.1,projRR/Math.max(0.1,reqRR));
    const wktF=Math.pow(0.90,wickets);
    const baseChase=(v.chase||50)/100;
    return Math.round(Math.max(5,Math.min(95,baseChase*rrRatio*wktF))*100);
  }
  const curRR=overs>0?score/overs:8;
  const projTotal=score+curRR*(20-overs)*(overs<6?0.92:overs<15?1.0:1.10);
  const wktF=Math.pow(0.93,wickets);
  const adjTotal=projTotal*wktF;
  const venueTotal=v.total||175;
  const totalRatio=adjTotal/venueTotal;
  const vChase=(v.chase||50)/100;
  const batWin=Math.max(0.22,Math.min(0.82,(1-vChase)+(totalRatio-1)*0.28));
  return Math.round(batWin*100);
}

// ── Real Intel Score ───────────────────────────────────────────
function realIntelScore(match,toss,v2026){
  const v=VENUES_BASE[match.venue]||{};
  const ti=TOSS_INTEL[match.venue]||{bat:50,field:50,note:"No toss data"};
  let score=0;const details=[];
  const battingTeam=toss==="batting"?match.t1:match.t2;
  const bowlingTeam=battingTeam===match.t1?match.t2:match.t1;
  const teamPPSR=getTeamPPSR(battingTeam);
  const teamPPEcon=getTeamPPEconFull(bowlingTeam);
  const ms=Math.max(5,Math.min(28,Math.round(14+(teamPPSR-145)/8+(8.5-teamPPEcon)*2)));
  score+=ms;
  details.push({l:"PP Matchup",v:ms,max:28,note:`${battingTeam} ppSR ${Math.round(teamPPSR)} vs ${bowlingTeam} ppEcon ${teamPPEcon.toFixed(1)}`});
  const vm=v2026[match.venue]?.matches||0;
  const vc=Math.min(18,6+vm*4);score+=vc;
  details.push({l:"Venue Data",v:vc,max:18,note:`${vm} matches logged this season`});
  const tossFav=toss==="batting"?ti.bat:ti.field;
  const te=Math.max(2,Math.min(20,Math.round((tossFav-50)/2+10)));score+=te;
  details.push({l:"Toss Edge",v:te,max:20,note:ti.note});
  const h=getH2H(match.t1,match.t2);
  const h2hScore=Math.max(2,Math.min(14,Math.round(7+(h.t1wins/h.total-0.5)*14)));score+=h2hScore;
  details.push({l:"H2H Record",v:h2hScore,max:14,note:`${match.t1} ${h.t1wins}-${h.total-h.t1wins} ${match.t2} (all time)`});
  const hotPlayers=(SQUADS[battingTeam]||[]).filter(p=>{const pl=PLAYERS_BASE[p];return pl?.wc2026_sr&&pl.wc2026_sr>pl.ppSR*1.10;});
  const hf=Math.min(12,hotPlayers.length*4);score+=hf;
  details.push({l:"In-Form Players",v:hf,max:12,note:hotPlayers.length>0?`${hotPlayers.slice(0,2).join(", ")} in WC form`:"No notable hot streaks"});
  const isDew=match.time.includes("7:30")&&["Wankhede, Mumbai","RGISC, Hyderabad","SMS Stadium, Jaipur","Ekana, Lucknow","Eden Gardens, Kolkata"].includes(match.venue);
  const df=isDew?8:match.time.includes("3:30")?6:4;score+=df;
  details.push({l:"Conditions",v:df,max:8,note:isDew?"Evening dew venue — 2nd innings advantage":"Day match or low-dew venue"});
  const total=Math.min(100,score);
  const verdict=total>=72?"BET":total>=55?"WATCH":"SKIP";
  const col=verdict==="BET"?C.greenL:verdict==="WATCH"?C.gold:C.red;
  return{score:total,verdict,col,details};
}

// ── Prediction Engine ──────────────────────────────────────────
function calibratedVenue(vn,v2026){
  const base=VENUES_BASE[vn]||VENUES_BASE["Narendra Modi, Ahmedabad"];
  const cal=v2026[vn];
  if(!cal||cal.matches===0)return base;
  const w=Math.min(0.7,cal.matches*0.14);
  return{...base,pp:Math.round(base.pp*(1-w)+cal.avgPP*w),total:Math.round(base.total*(1-w)+cal.avgTotal*w)};
}
function predict(cfg){
  const{venueName,battingTeam,bowlingTeam,striker,nonStriker,bowler,pitchType,weather,toss,lS,lW,lO,v2026,is2nd,target,impactPlayerAdded,strikerData,nonStrikerData,bowlerData,biasLog,remainingBat,remainingBowl}=cfg;
  const v=calibratedVenue(venueName,v2026||{});
  const p1=strikerData||PLAYERS_BASE[striker]||PLAYERS_BASE["Other Batsman"];
  const p2=nonStrikerData||PLAYERS_BASE[nonStriker]||PLAYERS_BASE["Other Batsman"];
  const teamPPSR=battingTeam?getTeamPPSR(battingTeam):(p1.ppSR+p2.ppSR)/2;
  const teamPPEcon=bowlingTeam?getTeamPPEconFull(bowlingTeam):(BOWLERS_BASE[bowler]?.ppEcon||8.5);
  const blendedPPSR=p1.ppSR*0.35+p2.ppSR*0.25+teamPPSR*0.40;
  const blendedEcon=(BOWLERS_BASE[bowler]?.ppEcon||teamPPEcon)*0.55+teamPPEcon*0.45;
  // Impact player adjustment
  const ipBonus=impactPlayerAdded?(IMPACT_PLAYERS[battingTeam]?.find(ip=>ip.n===impactPlayerAdded)?.runsAdded||0)*0.4:0;
  const avgPPAgg=blendedPPSR/150;
  // Blend current batsmen with remaining lineup for mid/death projection
  const remMidSR=remainingBat?.avgMidSR||((p1.midSR||130)+(p2.midSR||130))/2;
  const remDeathSR=remainingBat?.avgDeathSR||((p1.deathSR||155)+(p2.deathSR||155))/2;
  const avgMidAgg=(lO<6?(p1.midSR||130)*0.4+(p2.midSR||130)*0.3+remMidSR*0.3:remMidSR)/135;
  const avgDeathAgg=(lO<15?(p1.deathSR||155)*0.3+(p2.deathSR||155)*0.2+remDeathSR*0.5:remDeathSR+(remainingBat?.hasFinisher?10:0))/165;
  const pf=pitchType==="batting"?1.12:pitchType==="seaming"?0.88:pitchType==="turning"?0.85:pitchType==="slow"?0.82:1.0;
  const wf=weather==="dew"?1.08:weather==="overcast"?0.89:weather==="humid"?0.95:1.0;
  const tf=toss==="chasing"?1.06:0.96;
  const br2=Math.max(0.5,Math.min(1.0,blendedEcon/10));
  const wp=Math.pow(0.91,lW||0);
  const baseVar=v.pp>58?1.2:v.pp<50?0.8:1.0;
  const pm=Math.round((lO>3?3:6)*baseVar);
  const om=Math.round((lO>8?5:10)*baseVar);
  const om2=Math.round((lO>10?6:12)*baseVar);
  const om3=Math.round((lO>13?7:15)*baseVar);
  const tm=Math.round((lO>15?10:22)*baseVar);
  let pp;
  if(lS>0&&lO>0&&lO<6){pp=Math.round(lS+(lS/lO)*(6-lO)*(lO<3?1.02:0.98)*wp*pf);}
  else if(lO>=6){pp=lS>0?Math.min(lS,85):v.pp;}
  else{
    const biasFix = biasLog?.[venueName]?.ppBias || 0;
    pp=Math.round(v.pp*0.25+v.pp*avgPPAgg*0.25+v.pp*(1.4-br2)*0.20+v.pp*tf*0.10+v.pp*pf*0.10+v.pp*wf*0.05+v.pp*0.05+ipBonus+biasFix);
  }
  const sc=pp/v.pp;
  const mf=avgMidAgg*0.85*pf*wp;
  const df=avgDeathAgg*pf*wf;
  const db=(lW||0)<3?1.05:(lW||0)<6?1.0:0.92;
  const at10=lO>=10&&lS>0?lS:lO>6&&lS>0?Math.round(lS+(lS/lO)*(10-lO)*mf):Math.round(v.ov10*sc*mf);
  const at12=lO>=12&&lS>0?lS:Math.round(v.ov12*sc*mf*1.02);
  const at15=lO>=15&&lS>0?lS:Math.round(v.ov15*sc*mf*1.05);
  const tot=lO>15&&lS>0?Math.round(lS+(lS/lO)*df*db*(20-lO)*6):Math.round(v.total*sc*df*db*wf+ipBonus*0.5);
  const rpo2=lO>0?lS/lO:pp/6;
  const opf=lO<6?avgPPAgg:lO<15?avgMidAgg:avgDeathAgg;
  const nxt=Math.max(3,Math.round(rpo2*opf*pf*wp));
  // Chase
  let chaseProj=null;
  if(is2nd&&target>0){
    const needed=target-(lS||0);
    const ballsLeft=Math.max(6,(20-(lO||0))*6);
    const reqRR=(needed/ballsLeft)*6;
    const teamSR=battingTeam?getTeamPPSR(battingTeam):150;
    const projRR=teamSR/100*6;
    chaseProj={needed,reqRR:reqRR.toFixed(1),projRR:projRR.toFixed(1),feasible:projRR>=reqRR*0.85};
  }
  // Phase probability distribution
  const ppDist=phaseProbDist(pp,pm*2);
  const totDist=phaseProbDist(tot,tm*2);
  return{pp,ppLo:pp-pm,ppHi:pp+pm,at10,at10Lo:at10-om,at10Hi:at10+om,at12,at12Lo:at12-om2,at12Hi:at12+om2,at15,at15Lo:at15-om3,at15Hi:at15+om3,tot,totLo:tot-tm,totHi:tot+tm,nxt,nxtLo:nxt-2,nxtHi:nxt+3,chaseWin:v.chase,isLive:lO>0,ppDist,totDist,chaseProj,ipBonus};
}
function getBV(id,pred){
  if(!pred)return{val:0,lo:0,hi:0};
  if(id==="pp")return{val:pred.pp,lo:pred.ppLo,hi:pred.ppHi};
  if(id==="ov10")return{val:pred.at10,lo:pred.at10Lo,hi:pred.at10Hi};
  if(id==="ov12")return{val:pred.at12,lo:pred.at12Lo,hi:pred.at12Hi};
  if(id==="ov15")return{val:pred.at15,lo:pred.at15Lo,hi:pred.at15Hi};
  if(id==="total")return{val:pred.tot,lo:pred.totLo,hi:pred.totHi};
  if(id==="over")return{val:pred.nxt,lo:pred.nxtLo,hi:pred.nxtHi};
  return{val:pred.pp,lo:pred.ppLo,hi:pred.ppHi};
}
function verdict(val,line){
  if(!line||line==="")return null;
  const l=parseFloat(line);if(isNaN(l)||l<=0)return null;
  const e=val-l,ep=Math.round(Math.abs(e)/l*100);
  if(Math.abs(e)>=5)return{text:e>0?"BET OVER":"BET UNDER",color:C.greenL,bg:"#f0fdf4",bdr:"#86efac",conf:Math.min(88,62+ep*2),e,strong:true};
  if(Math.abs(e)>=3)return{text:e>0?"LEAN OVER":"LEAN UNDER",color:C.gold,bg:"#fffbeb",bdr:"#fcd34d",conf:50+ep*2,e,strong:false};
  return{text:"SKIP",color:C.dim,bg:C.panel,bdr:C.border,conf:30,e,strong:false};
}

// ── Live fetch ─────────────────────────────────────────────────
async function fetchLiveClaude(t1,t2){
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:500,tools:[{type:"web_search_20250305",name:"web_search"}],
        system:'Return ONLY valid JSON: {"isLive":true,"battingTeam":"X","score":45,"wickets":1,"overs":3.4,"runRate":9.8,"lastOver":8,"recentBalls":"1 4 0 6 W 2","striker":"Name","nonStriker":"Name","bowler":"Name","target":null,"status":"text"}',
        messages:[{role:"user",content:"Live IPL score "+t1+" vs "+t2+" right now. JSON only."}]})});
    const d=await r.json();
    return JSON.parse(d.content.filter(b=>b.type==="text").map(b=>b.text).join("").replace(/```json|```/g,"").trim());
  }catch{return null;}
}
async function claudeAsk(msg,ctx){
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1200,tools:[{type:"web_search_20250305",name:"web_search"}],
        system:"You are SHAKTI — elite IPL probabilistic trading analyst. Context: "+JSON.stringify(ctx)+". Platform odds: Favourite=1st number (stake₹100 profit=odds). Underdog=2nd (stake=odds profit₹100). Hedge=use potential winnings as hedge stake, no extra cash. Give specific numbers, BET/SKIP verdicts, EV calculations. Be direct.",
        messages:[{role:"user",content:msg}]})});
    const d=await r.json();
    return d.content.filter(b=>b.type==="text").map(b=>b.text).join("").trim();
  }catch{return "Connection error.";}
}

// ── Accuracy helpers ───────────────────────────────────────────
function computeAccuracy(accLog){
  if(!accLog.length)return{overall:68,pp:null,total:null,winner:null,count:0,calibration:[]};
  const byMarket={};
  accLog.forEach(e=>{if(!byMarket[e.market])byMarket[e.market]={hits:0,total:0,confBuckets:{}};byMarket[e.market].total++;if(e.hit)byMarket[e.market].hits++;});
  const pct=(m)=>byMarket[m]?Math.round(byMarket[m].hits/byMarket[m].total*100):null;
  const ppAcc=pct("pp"),totAcc=pct("total"),winAcc=pct("winner");
  const valid=[ppAcc,totAcc,winAcc].filter(v=>v!==null);
  const overall=valid.length>0?Math.round(valid.reduce((a,b)=>a+b,0)/valid.length):Math.min(77,68+Math.floor(accLog.length/5));
  // Pattern detection
  const patterns=[];
  if(byMarket.pp?.total>=5){
    const ppPct=byMarket.pp.hits/byMarket.pp.total*100;
    if(ppPct>70)patterns.push({msg:`PP Score: ${Math.round(ppPct)}% win rate — your strongest market`,type:"good"});
    else if(ppPct<50)patterns.push({msg:`PP Score: only ${Math.round(ppPct)}% — consider skipping this market`,type:"warn"});
  }
  if(byMarket.winner?.total>=5&&byMarket.pp?.total>=5){
    const wPct=byMarket.winner.hits/byMarket.winner.total*100;
    const ppPct=byMarket.pp.hits/byMarket.pp.total*100;
    if(wPct>ppPct+15)patterns.push({msg:`Match Winner ${Math.round(wPct)}% > PP ${Math.round(ppPct)}% — shift focus to winner bets`,type:"good"});
  }
  return{overall,pp:ppAcc,total:totAcc,winner:winAcc,count:accLog.length,byMarket,patterns};
}

// ── Season projection ──────────────────────────────────────────
function seasonProjection(br,wr,bets,stage){
  const matchesPlayed=new Set(bets.map(b=>b.match)).size;
  const matchesLeft=84-matchesPlayed;
  if(matchesPlayed<3)return null;
  const wrFrac=(wr||50)/100;
  const avgBetPerMatch=bets.length/Math.max(1,matchesPlayed);
  const avgStake=bets.filter(b=>b.out!=="PENDING").reduce((s,b)=>s+b.stake,0)/Math.max(1,bets.filter(b=>b.out!=="PENDING").length);
  // Simple projection: avg P&L per match × remaining matches
  const resolvedBets=bets.filter(b=>b.out!=="PENDING");
  const netPerMatch=resolvedBets.reduce((s,b)=>s+(b.out==="WIN"?b.stake:-b.stake),0)/Math.max(1,matchesPlayed);
  const projectedFinal=Math.round(br+netPerMatch*matchesLeft);
  const variance=avgStake*Math.sqrt(matchesLeft*avgBetPerMatch)*0.5;
  return{projectedFinal,low:Math.max(0,Math.round(projectedFinal-variance)),high:Math.round(projectedFinal+variance),matchesLeft,matchesPlayed,netPerMatch:Math.round(netPerMatch)};
}

// ── Tilt & risk ────────────────────────────────────────────────
function tiltSignals(bets,cLoss){
  const s=[];
  if(cLoss>=2)s.push("2 consecutive losses — skip this match");
  const rec=bets.slice(-3);
  if(rec.length===3&&(rec[2].ts-rec[0].ts)<30*60*1000)s.push("Betting faster than usual");
  if(cLoss>=1&&rec.some(b=>b.tier==="C"))s.push("Tier C after a loss — upgrade or skip");
  return s;
}
function recoveryMode(br,peakBr){
  if(peakBr<=INIT_BR)return null;
  const drawdown=(peakBr-br)/peakBr;
  if(drawdown>=0.30)return{active:true,level:"severe",stakeAdj:0.50,msg:`Down ${Math.round(drawdown*100)}% from peak ₹${peakBr.toLocaleString("en-IN")} — 50% stakes until recovery`};
  if(drawdown>=0.20)return{active:true,level:"moderate",stakeAdj:0.70,msg:`Down ${Math.round(drawdown*100)}% from peak — 70% stakes`};
  return{active:false};
}

// ── Correlation matrix ─────────────────────────────────────────
const CORR_MATRIX={pp:{pp:1.0,ov10:0.88,ov12:0.80,ov15:0.70,total:0.65,winner:0.35,over:0.10},total:{pp:0.65,ov10:0.75,ov12:0.82,ov15:0.90,total:1.0,winner:0.40,over:0.12},winner:{pp:0.35,ov10:0.38,ov12:0.40,ov15:0.42,total:0.40,winner:1.0,over:0.08},over:{pp:0.10,total:0.12,winner:0.08,over:1.0}};
function portfolioCorrelation(marketIds){
  if(marketIds.length<2)return 0;
  let total=0,count=0;
  for(let i=0;i<marketIds.length;i++)for(let j=i+1;j<marketIds.length;j++){
    const a=marketIds[i],b=marketIds[j];
    total+=CORR_MATRIX[a]?.[b]||CORR_MATRIX[b]?.[a]||0.3;count++;
  }
  return count>0?Math.round(total/count*100):0;
}

// ── Styles ─────────────────────────────────────────────────────
const card=(x={})=>({background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:16,...x});
const tbtn=(on,col=C.crimson)=>({padding:"8px 10px",borderRadius:8,fontSize:10,cursor:"pointer",fontFamily:"inherit",border:"1.5px solid "+(on?col:C.border),background:on?col+"18":"transparent",color:on?col:C.dim,fontWeight:on?"bold":"normal"});
const sel={width:"100%",background:C.bg,border:"1px solid "+C.border,color:C.text,borderRadius:8,padding:"8px 10px",fontFamily:"inherit",fontSize:11,appearance:"none"};

// ── Match Card ─────────────────────────────────────────────────
function MCard({m,onTap,intel,isLive}){
  const c1=TEAM_COL[m.t1]||C.crimson,c2=TEAM_COL[m.t2]||C.gold;
  return(
    <div onClick={()=>onTap(m)} style={{...card({padding:0,marginBottom:10,cursor:"pointer",overflow:"hidden",border:"1px solid "+(isLive?C.goldL:C.border)})}}>
      <div style={{height:4,background:"linear-gradient(90deg,"+c1+","+c2+")"}}/>
      <div style={{padding:"12px 14px"}}>
        {isLive&&<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}><div style={{width:6,height:6,borderRadius:"50%",background:C.crimsonL,animation:"blink 1s infinite"}}/><span style={{fontSize:9,color:C.crimsonL,letterSpacing:2,fontWeight:"bold"}}>LIVE</span></div>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:20,fontWeight:"bold",color:c1}}>{m.t1}</span><span style={{fontSize:9,color:C.dim}}>vs</span><span style={{fontSize:20,fontWeight:"bold",color:c2}}>{m.t2}</span></div>
          {intel&&<div style={{padding:"3px 10px",borderRadius:20,background:intel.col+"18",border:"1px solid "+intel.col+"40",fontSize:10,fontWeight:"bold",color:intel.col}}>{intel.verdict}</div>}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}><span style={{fontSize:9,color:C.dim}}>📍 {m.venue.split(",")[0]}</span><span style={{fontSize:9,color:C.sub}}>{m.date} · {m.time}</span></div>
        {intel&&<div style={{marginTop:6,height:3,background:C.border,borderRadius:2}}><div style={{height:"100%",width:intel.score+"%",background:"linear-gradient(90deg,"+C.crimson+","+intel.col+")",borderRadius:2}}/></div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function Shakti(){
  const [tab,setTab]=useState("home");
  const [match,setMatch]=useState(null);
  const [sub,setSub]=useState("predict");

  // Bankroll
  const [br,setBr]=useState(INIT_BR);
  const [base,setBase]=useState(INIT_BR);
  const [peakBr,setPeakBr]=useState(INIT_BR);
  const [stage,setStage]=useState(1);
  const [cLoss,setCLoss]=useState(0);
  const [dLoss,setDLoss]=useState(0);
  const [bets,setBets]=useState([]);
  const [skipNext,setSkipNext]=useState(false);
  const [milestoneAlert,setMilestoneAlert]=useState(null);

  // Learning
  const [v2026,setV2026]=useState({});
  const [accLog,setAccLog]=useState([]);
  const [logged,setLogged]=useState(0);
  const [playerForm,setPlayerForm]=useState({}); // {name:[{runs,balls,date}]}
  const [bowlerForm,setBowlerForm]=useState({});
  const [biasLog,setBiasLog]=useState({});
  const [predictionLog,setPredictionLog]=useState([]);
  const [syncing,setSyncing]=useState(false);
  const [lastSync,setLastSync]=useState(null);

  // Match conditions
  const [battingFirst,setBattingFirst]=useState("");
  const [striker,setStriker]=useState("Other Batsman");
  const [nonStrike,setNonStrike]=useState("Other Batsman");
  const [bowler,setBowler]=useState("Average Bowler");
  const [pitch,setPitch]=useState("balanced");
  const [wx,setWx]=useState("clear");
  const [toss,setToss]=useState("batting");
  const [is2nd,setIs2nd]=useState(false);
  const [target,setTarget]=useState(0);
  const [impactPlayer,setImpactPlayer]=useState("");
  const [matchId,setMatchId]=useState(null);
  const [playing11,setPlaying11]=useState({});
  const [battedPlayers,setBattedPlayers]=useState([]);
  const [bowlerSpells,setBowlerSpells]=useState([]);
  const [fetchingToss,setFetchingToss]=useState(false);
  const [tossData,setTossData]=useState(null);
  const [lines,setLines]=useState({});
  const [lineHist,setLineHist]=useState({});
  const [lineAlerts,setLineAlerts]=useState([]);
  const [liveData,setLiveData]=useState(null);
  const [fetching,setFetching]=useState(false);
  const [lastUpd,setLastUpd]=useState(null);
  const [showWkt,setShowWkt]=useState(false);
  const [prevWkts,setPrevWkts]=useState(0);

  // Odds gap
  const [ogFavOdds,setOgFavOdds]=useState(60);
  const [ogUndOdds,setOgUndOdds]=useState(70);
  const [ogRole,setOgRole]=useState("fav");
  const [ogStake,setOgStake]=useState(1000);

  // Hedge
  const [hFav,setHFav]=useState("CSK");const [hUnd,setHUnd]=useState("RR");
  const [hFavOdds,setHFavOdds]=useState(60);const [hUndOdds,setHUndOdds]=useState(70);
  const [hStake,setHStake]=useState(1000);const [hRole,setHRole]=useState("fav");
  const [hNewFav,setHNewFav]=useState(40);const [hNewUnd,setHNewUnd]=useState(60);
  const [hOn,setHOn]=useState("und");const [hRes,setHRes]=useState(null);

  // Learn
  const [lVenue,setLVenue]=useState(Object.keys(VENUES_BASE)[0]);
  const [lPP,setLPP]=useState("");const [lTotal,setLTotal]=useState("");
  const [lPredPP,setLPredPP]=useState("");
  const [lActualWinner,setLActualWinner]=useState("");const [lPredWinner,setLPredWinner]=useState("");

  // Chat
  const [chatMsgs,setChatMsgs]=useState([{role:"assistant",content:"⚔ SHAKTI v9 — Full intelligence active. Win probability, EV calculator, H2H records, toss intelligence, phase probability model, player form, season projection. Ask anything.",ts:Date.now()}]);
  const [chatIn,setChatIn]=useState("");const [chatBusy,setChatBusy]=useState(false);
  const chatEnd=useRef(null);const timerRef=useRef(null);

  // ── Load from localStorage ──────────────────────────────────
  useEffect(()=>{
    const s=loadState();if(!s)return;
    if(s.br!=null)setBr(s.br);if(s.base!=null)setBase(s.base);
    if(s.peakBr!=null)setPeakBr(s.peakBr);if(s.stage!=null)setStage(s.stage);
    if(s.cLoss!=null)setCLoss(s.cLoss);if(s.dLoss!=null)setDLoss(s.dLoss);
    if(s.bets)setBets(s.bets);if(s.skipNext!=null)setSkipNext(s.skipNext);
    if(s.v2026)setV2026(s.v2026);if(s.accLog)setAccLog(s.accLog);
    if(s.logged!=null)setLogged(s.logged);if(s.playerForm)setPlayerForm(s.playerForm);
    if(s.playing11)setPlaying11(s.playing11);
    if(s.bowlerForm)setBowlerForm(s.bowlerForm);
    if(s.biasLog)setBiasLog(s.biasLog);
    if(s.predictionLog)setPredictionLog(s.predictionLog);
  },[]);

  // ── Save to localStorage ────────────────────────────────────
  useEffect(()=>{
    saveState({br,base,peakBr,stage,cLoss,dLoss,bets,skipNext,v2026,accLog,logged,playerForm,bowlerForm,biasLog,predictionLog,playing11});
  },[br,base,peakBr,stage,cLoss,dLoss,bets,skipNext,v2026,accLog,logged,playerForm]);

  // ── Derived ─────────────────────────────────────────────────
  const ks=br<4000,tilt=cLoss>=2,stop=dLoss>=2;
  const accuracy=computeAccuracy(accLog);
  const engAcc=accuracy.overall;
  const wins=bets.filter(b=>b.out==="WIN").length;
  const losses=bets.filter(b=>b.out==="LOSS").length;
  const pl=br-INIT_BR;
  const wr=bets.length>0?Math.round(wins/bets.length*100):null;
  const tSigs=tiltSignals(bets,cLoss);
  const recovery=recoveryMode(br,peakBr);
  const lS=liveData?.isLive?liveData.score:0;
  const lW=liveData?.isLive?liveData.wickets:0;
  const lO=liveData?.isLive?liveData.overs:0;
  const bTeam=battingFirst||(match?(toss==="batting"?match.t1:match.t2):"");
  const blTeam=bTeam&&match?(bTeam===match.t1?match.t2:match.t1):"";
  // Apply form multipliers to current players
  const strikerData = applyFormToPlayer(striker, PLAYERS_BASE[striker]||PLAYERS_BASE["Other Batsman"], playerForm, biasLog, match?.venue);
  const nonStrikerData = applyFormToPlayer(nonStrike, PLAYERS_BASE[nonStrike]||PLAYERS_BASE["Other Batsman"], playerForm, biasLog, match?.venue);
  const bowlerData = applyFormToBowler(bowler, BOWLERS_BASE[bowler]||BOWLERS_BASE["Average Bowler"], bowlerForm);
  const pred=match?predict({venueName:match.venue,battingTeam:bTeam,bowlingTeam:blTeam,striker,nonStriker:nonStrike,bowler,pitchType:pitch,weather:wx,toss,lS:is2nd?0:lS,lW:is2nd?0:lW,lO:is2nd?0:lO,v2026,is2nd,target,impactPlayerAdded:impactPlayer,strikerData,nonStrikerData,bowlerData,biasLog,remainingBat,remainingBowl}):null;
  const winProb=match?(liveData?.isLive?calcLiveWinProb(lS,lW,lO,is2nd?target:liveData?.target||0,match.venue,bTeam,blTeam,is2nd):calcPreMatchWinProb(match.t1,match.t2,match.venue,toss)):50;

  // Active match bets for correlation
  const activeBetMarkets=match?bets.filter(b=>b.match===match.t1+" vs "+match.t2&&b.out==="PENDING").map(b=>b.marketId):[];
  const portCorr=portfolioCorrelation(activeBetMarkets);

  // Odds gap calculation
  const ogImplied=impliedProb(ogFavOdds,ogUndOdds,ogRole);
  const ogReal=ogRole==="fav"?winProb:100-winProb;
  const ogGap=ogReal-ogImplied;
  const ogEV=calcEV(ogReal,ogImplied,ogStake);

  // Dynamic stake
  const edgeSize=Math.abs(ogGap);
  const raw=rawStake(br,stage,base,ks)*(recovery?.stakeAdj||1);
  const nextMS=MILESTONES.find(m=>m>br)||TARGET;
  const proj=seasonProjection(br,wr,bets,stage);
  const chartData=(()=>{let r=INIT_BR;const pts=[{n:0,v:INIT_BR}];bets.filter(b=>b.out!=="PENDING").forEach((b,i)=>{r+=b.out==="WIN"?b.stake:-b.stake;pts.push({n:i+1,v:r});});return pts;})();
  const matchPnL=(()=>{const map={};bets.forEach(b=>{if(!map[b.match])map[b.match]={m:b.match,p:0};if(b.out==="WIN")map[b.match].p+=b.stake;if(b.out==="LOSS")map[b.match].p-=b.stake;});return Object.values(map);})();
  // Remaining batting and bowling strength
  let remainingBat={avgMidSR:130,avgDeathSR:155,yetToBat:[],hasFinisher:false};
  let remainingBowl={avgDeathEcon:9.5,remainingBowlers:[]};
  try{if(match&&bTeam)remainingBat=getRemainingBattingStrength(bTeam,battedPlayers,[striker,nonStrike],playing11[bTeam]||[],PLAYERS_BASE);}catch(e){}
  try{if(match&&blTeam)remainingBowl=getRemainingBowlingStrength(blTeam,bowlerSpells,lO,BOWLERS_BASE);}catch(e){}
  const todayBets=bets.filter(b=>new Date(b.ts).toDateString()===new Date().toDateString());
  const todayPnL=todayBets.filter(b=>b.out!=="PENDING").reduce((s,b)=>s+(b.out==="WIN"?b.stake:-b.stake),0);

  const doFetch=useCallback(async()=>{
    if(!match)return;setFetching(true);
    try{
      // Try CricketData first if we have a matchId
      let d=null;
      let usedCricData=false;
      if(matchId){
        const scorecard=await fetchLiveScorecard(matchId);
        if(scorecard?.matchStarted){
          d={
            isLive:!scorecard.matchEnded,
            battingTeam:scorecard.battingTeam,
            score:scorecard.score,
            wickets:scorecard.wickets,
            overs:scorecard.overs,
            runRate:scorecard.runRate,
            striker:scorecard.striker,
            nonStriker:scorecard.nonStriker,
            bowler:scorecard.bowler,
            target:scorecard.target,
            status:scorecard.matchEnded?"Match ended":"Live",
            recentBalls:"",
          };
          // Update batting/bowling tracking
          if(scorecard.battedPlayers?.length) setBattedPlayers(scorecard.battedPlayers);
          if(scorecard.bowlerSpells?.length) setBowlerSpells(scorecard.bowlerSpells);
          usedCricData=true;
        }
      }
      // Fallback to Claude web search
      if(!d) d=await fetchLiveClaude(match.t1,match.t2);
      if(d){
        setLiveData(d);
        const now=new Date();setLastUpd(now.getHours()+":"+String(now.getMinutes()).padStart(2,"0")+(usedCricData?" CricData":" Web"));
        if(d.isLive){
          if(PLAYERS_BASE[d.striker])setStriker(d.striker);
          if(PLAYERS_BASE[d.nonStriker])setNonStrike(d.nonStriker);
          if(BOWLERS_BASE[d.bowler])setBowler(d.bowler);
          if((d.wickets||0)>prevWkts)setShowWkt(true);
          setPrevWkts(d.wickets||0);
          if(d.target&&d.target>0){setIs2nd(true);setTarget(d.target);}
        }
      }
    }catch(e){console.error("doFetch error:",e);}
    setFetching(false);
  },[match,matchId,prevWkts]);

  useEffect(()=>{
    if(tab==="match"&&match){setLiveData(null);setPrevWkts(0);doFetch();timerRef.current=setInterval(doFetch,60000);}
    return()=>clearInterval(timerRef.current);
  },[tab,match]);

  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:"smooth"});},[chatMsgs]);

  function updateLine(id,val,ov){
    const h=lineHist[id]||[];
    const u=[...h,{ov:ov||lO,line:parseFloat(val),ts:Date.now()}];
    setLineHist(p=>({...p,[id]:u}));setLines(p=>({...p,[id]:val}));
    if(u.length>=2){
      const curr2=u[u.length-1],prev2=u[u.length-2];
      const{val:pv}=getBV(id,pred)||{val:0};
      if(Math.abs(curr2.line-prev2.line)<1&&Math.abs(pv-curr2.line)>=6){
        setLineAlerts(p=>[{id,msg:"LINE STALE — "+Math.abs(pv-curr2.line)+" run edge on "+(BETS.find(b=>b.id===id)?.label)+". Bookmaker hasn't repriced!",ts:Date.now()},...p].slice(0,3));
      }
    }
  }

  function calcHedge(){
    const origOdds=hRole==="fav"?hFavOdds:hUndOdds;
    const pot=hRole==="fav"?hStake*origOdds/100:hStake/origOdds*100;
    const hOdds=hOn==="fav"?hNewFav:hNewUnd;
    const hProfit=hOn==="fav"?pot*hOdds/100:pot/hOdds*100;
    const ifHW=hProfit-hStake;
    const minOdds=hOn==="fav"?hStake*100/pot:pot*100/hStake;
    const vt=ifHW>500?"HEDGE NOW — STRONG PROFIT":ifHW>0?"HEDGE — THIN PROFIT":"WAIT — ODDS TOO LOW";
    const vc=ifHW>500?C.greenL:ifHW>0?C.gold:C.red;
    setHRes({pot,hStake:pot,hProfit,ifHW,minOdds,vt,vc,ok:hOdds>=minOdds});
  }

  function submitLearn(){
    if(!lPP||!lTotal)return;
    const pp2=parseFloat(lPP),tot2=parseFloat(lTotal);
    setV2026(prev=>{const e=prev[lVenue]||{matches:0,avgPP:VENUES_BASE[lVenue]?.pp||50,avgTotal:VENUES_BASE[lVenue]?.total||170};const n=e.matches+1;return{...prev,[lVenue]:{matches:n,avgPP:Math.round((e.avgPP*(n-1)+pp2)/n),avgTotal:Math.round((e.avgTotal*(n-1)+tot2)/n)}};});
    const newEntries=[];
    if(lPredPP){const hit=Math.abs(parseFloat(lPredPP)-pp2)<=5;newEntries.push({market:"pp",predicted:parseFloat(lPredPP),actual:pp2,hit,date:new Date().toISOString().slice(0,10)});}
    if(lPredWinner&&lActualWinner){newEntries.push({market:"winner",predicted:lPredWinner,actual:lActualWinner,hit:lPredWinner===lActualWinner,date:new Date().toISOString().slice(0,10)});}
    if(newEntries.length)setAccLog(prev=>[...prev,...newEntries]);
    setLogged(p=>p+1);
    setLPP("");setLTotal("");setLPredPP("");setLActualWinner("");setLPredWinner("");
  }

  function placeBet(bt,stakeAmt){
    if(tilt||stop||skipNext)return;
    const corr=portfolioCorrelation([...activeBetMarkets,bt.id]);
    if(corr>75){if(!window.confirm(`⚠ Portfolio correlation ${corr}% — very correlated bets. Continue?`))return;}
    setBets(p=>[...p,{id:Date.now(),match:match.t1+" vs "+match.t2,marketId:bt.id,market:bt.label,tier:bt.tier,stake:stakeAmt,stage,out:"PENDING",ts:Date.now()}]);
  }

  function resolve(id,out){
    const b=bets.find(b=>b.id===id);if(!b)return;
    const nb=out==="WIN"?br+b.stake:br-b.stake;
    const prevMilestone=MILESTONES.find(m=>m>br&&m<=nb);
    if(prevMilestone&&out==="WIN")setMilestoneAlert(prevMilestone);
    if(nb>peakBr)setPeakBr(nb);
    setBr(nb);
    if(out==="WIN"){setCLoss(0);setSkipNext(false);if(stage===3){setBase(nb);setStage(1);setSkipNext(true);}else setStage(s=>s+1);}
    else{setCLoss(p=>p+1);setDLoss(p=>p+1);if(stage===3){setBr(base);setSkipNext(true);}else if(stage>1)setStage(1);}
    setBets(p=>p.map(x=>x.id===id?{...x,out}:x));
  }

  async function sendChat(){
    if(!chatIn.trim()||chatBusy)return;
    const msg=chatIn.trim();
    setChatMsgs(p=>[...p,{role:"user",content:msg,ts:Date.now()}]);setChatIn("");setChatBusy(true);
    const ctx={br,stage,base,wr,cLoss,engAcc,match:match?match.t1+" vs "+match.t2:"none",lS,lO,lW,winProb:match?{[match.t1]:winProb,[match.t2]:100-winProb}:null,oddsGap:ogGap,ev:ogEV,seasonProj:proj};
    const reply=await claudeAsk(msg,ctx);
    setChatMsgs(p=>[...p,{role:"assistant",content:reply,ts:Date.now()}]);setChatBusy(false);
  }

  async function runSync(){
    setSyncing(true);
    try{
      const result = await syncLastMatch(PLAYERS_BASE, BOWLERS_BASE, VENUES_BASE, {v2026,playerForm,bowlerForm,predictionLog,biasLog});
      if(result.success){
        if(result.newState.v2026) setV2026(result.newState.v2026);
        if(result.newState.playerForm) setPlayerForm(result.newState.playerForm);
        if(result.newState.bowlerForm) setBowlerForm(result.newState.bowlerForm);
        if(result.newState.biasLog) setBiasLog(result.newState.biasLog);
        setLastSync({...result, ts:Date.now()});
      } else {
        setLastSync({success:false, msg:result.msg, ts:Date.now()});
      }
    } catch(e){
      setLastSync({success:false, msg:"Sync failed: "+e.message, ts:Date.now()});
    }
    setSyncing(false);
  }

  async function fetchTossAndLineup(){
    if(!match)return;
    setFetchingToss(true);
    try{
      // Find match ID
      let id=matchId;
      if(!id){
        id=await findMatchId(match.t1,match.t2);
        if(id)setMatchId(id);
      }
      if(!id){
        setTossData({error:"Match not found in CricketData yet. Try closer to match time."});
        setFetchingToss(false);return;
      }
      // Fetch toss + playing 11
      const data=await fetchTossAndPlaying11(id);
      if(!data){setTossData({error:"Could not fetch match info"});setFetchingToss(false);return;}
      setTossData(data);
      // Auto-set playing 11
      if(data.teams&&Object.keys(data.teams).length>0){
        setPlaying11(data.teams);
      }
      // Auto-set toss
      if(data.tossWinner&&data.tossChoice){
        const battingTeamCode=data.tossChoice==="bat"?
          (data.tossWinner.includes(match.t1)?match.t1:match.t2):
          (data.tossWinner.includes(match.t1)?match.t2:match.t1);
        setBattingFirst(battingTeamCode);
        setToss(battingTeamCode===match.t1?"batting":"chasing");
        // Auto-set openers
        const order=BATTING_ORDERS[battingTeamCode]||[];
        const p11=data.teams[battingTeamCode]||[];
        const confirmedOpeners=order.filter(p=>p11.length===0||p11.some(p11p=>p11p.includes(p.split(" ").slice(-1)[0])));
        if(confirmedOpeners[0])setStriker(confirmedOpeners[0]);
        if(confirmedOpeners[1])setNonStrike(confirmedOpeners[1]);
        // Auto-set PP bowler
        const bowlingTeam=battingTeamCode===match.t1?match.t2:match.t1;
        const ppBowlers=BOWLING_ROTATION[bowlingTeam]?.pp||[];
        if(ppBowlers[0])setBowler(ppBowlers[0]);
      }
    }catch(e){setTossData({error:"Error: "+e.message});}
    setFetchingToss(false);
  }

  function openMatch(m){
    setMatch(m);setLines({});setLineHist({});setLineAlerts([]);
    setStriker("Other Batsman");setNonStrike("Other Batsman");setBowler("Average Bowler");
    setSub("predict");setTab("match");setIs2nd(false);setTarget(0);setImpactPlayer("");
    const defaultToss="batting";setToss(defaultToss);setBattingFirst(defaultToss==="batting"?m.t1:m.t2);
  }

  const TABS=[["home","🏠"],["match","📊"],["hedge","💹"],["intel","🔍"],["learn","🧠"],["chat","⚔"],["log","📋"]];

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'DM Mono',monospace",maxWidth:480,margin:"0 auto"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');*{box-sizing:border-box;}input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}input,textarea{outline:none;}select{appearance:none;}::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:${C.border};}@keyframes spin{to{transform:rotate(360deg);}}@keyframes blink{0%,100%{opacity:.3}50%{opacity:1}}@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}textarea{resize:none;}`}</style>

      {/* Milestone Alert */}
      {milestoneAlert&&(
        <div style={{position:"fixed",inset:0,background:"rgba(45,26,14,0.85)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{width:"90%",maxWidth:400,background:C.card,borderRadius:20,padding:28,textAlign:"center",border:"2px solid "+C.goldL}}>
            <div style={{fontSize:40,marginBottom:8}}>🏆</div>
            <div style={{fontSize:9,color:C.gold,letterSpacing:3,fontWeight:"bold",marginBottom:6}}>MILESTONE REACHED</div>
            <div style={{fontSize:32,fontWeight:"bold",color:C.crimson,marginBottom:8}}>₹{milestoneAlert.toLocaleString("en-IN")}</div>
            <div style={{fontSize:12,color:C.sub,marginBottom:6,lineHeight:1.6}}>Lock <span style={{color:C.gold,fontWeight:"bold"}}>₹{(MILESTONE_LOCKS[milestoneAlert]||0).toLocaleString("en-IN")}</span> now — transfer out of betting bankroll.</div>
            <div style={{fontSize:10,color:C.muted,marginBottom:16}}>Continue with ₹{(milestoneAlert-(MILESTONE_LOCKS[milestoneAlert]||0)).toLocaleString("en-IN")} in play.</div>
            <button onClick={()=>setMilestoneAlert(null)} style={{width:"100%",padding:13,borderRadius:10,fontSize:12,fontWeight:"bold",background:"linear-gradient(135deg,"+C.crimson+","+C.goldL+")",border:"none",color:C.white,cursor:"pointer",fontFamily:"inherit",letterSpacing:2}}>✓ ACKNOWLEDGED — LOCKING NOW</button>
          </div>
        </div>
      )}

      {/* Wicket popup */}
      {showWkt&&match&&(
        <div style={{position:"fixed",inset:0,background:"rgba(45,26,14,0.65)",zIndex:200,display:"flex",alignItems:"flex-end"}}>
          <div style={{width:"100%",maxWidth:480,margin:"0 auto",background:C.card,borderTop:"3px solid "+C.crimson,borderRadius:"18px 18px 0 0",padding:"20px 16px 36px",animation:"slideUp 0.3s ease"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
              <div><div style={{fontSize:9,color:C.crimson,letterSpacing:3,fontWeight:"bold",marginBottom:3}}>WICKET FELL</div><div style={{fontSize:15,color:C.text,fontWeight:"bold"}}>Select new batter</div></div>
              <button onClick={()=>setShowWkt(false)} style={{background:"none",border:"none",color:C.muted,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {(SQUADS[bTeam||match.t1]||[]).map(p=>(
                <button key={p} onClick={()=>{setStriker(p);setShowWkt(false);}} style={{padding:"11px 10px",borderRadius:10,fontSize:10,background:PLAYERS_BASE[p]?.wc2026_sr?C.gold+"10":C.bg,border:"1px solid "+(PLAYERS_BASE[p]?.wc2026_sr?C.goldL:C.border),color:C.text,cursor:"pointer",fontFamily:"inherit",textAlign:"left",display:"flex",justifyContent:"space-between"}}>
                  <span>{p.split(" ").slice(-1)[0]}</span>
                  {PLAYERS_BASE[p]?.wc2026_sr&&<span style={{fontSize:8,color:C.gold}}>🔥</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{position:"sticky",top:0,zIndex:50,background:C.panel,borderBottom:"1px solid "+C.border,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 1px 8px rgba(155,0,32,0.08)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {tab==="match"&&<button onClick={()=>{setTab("home");setMatch(null);clearInterval(timerRef.current);}} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:22,padding:0}}>←</button>}
          <div>
            <div style={{fontSize:7,color:C.crimsonL,letterSpacing:6,fontWeight:"bold"}}>IPL 2026</div>
            <div style={{fontSize:19,fontWeight:"bold",letterSpacing:3,color:C.crimson}}>SHAKTI<span style={{color:C.goldL}}>.</span></div>
          </div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {match&&tab==="match"&&<div style={{textAlign:"center"}}><div style={{fontSize:7,color:C.dim,letterSpacing:2}}>WIN%</div><div style={{fontSize:12,fontWeight:"bold",color:winProb>=55?C.greenL:winProb<=45?C.red:C.gold}}>{match.t1} {winProb}%</div></div>}
          <div style={{textAlign:"center"}}><div style={{fontSize:7,color:C.dim,letterSpacing:2}}>BANKROLL</div><div style={{fontSize:14,fontWeight:"bold",color:br>=INIT_BR?C.crimson:C.red}}>₹{br.toLocaleString("en-IN")}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:7,color:C.dim,letterSpacing:2}}>S{stage}</div><div style={{fontSize:13,fontWeight:"bold",color:C.gold}}>{stage===1?"INIT":stage===2?"CONF":"ATK"}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:7,color:C.dim,letterSpacing:2}}>ACC</div><div style={{fontSize:12,fontWeight:"bold",color:engAcc>=72?C.greenL:engAcc>=65?C.gold:C.muted}}>{engAcc}%</div></div>
        </div>
      </div>

      {/* Alert bars */}
      {(tilt||stop||ks||skipNext||tSigs.length>0||recovery?.active)&&(
        <div style={{background:"#fff1f0",borderBottom:"1px solid #fecaca",padding:"7px 16px"}}>
          {skipNext&&<div style={{fontSize:10,color:C.red,fontWeight:"bold"}}>⏸ MANDATORY SKIP — Stage 3 result.</div>}
          {ks&&<div style={{fontSize:10,color:C.red,fontWeight:"bold"}}>☠ KILL SWITCH — 10% stakes only.</div>}
          {tilt&&<div style={{fontSize:10,color:C.red,fontWeight:"bold"}}>⛔ TILT LOCK — 2 losses. Skip match.</div>}
          {stop&&<div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:10,color:C.red,fontWeight:"bold"}}>🛑 DAILY STOP-LOSS</span><button onClick={()=>setDLoss(0)} style={{fontSize:9,background:"none",border:"1px solid "+C.red,color:C.red,padding:"2px 8px",cursor:"pointer",borderRadius:4,fontFamily:"inherit"}}>RESET</button></div>}
          {recovery?.active&&!tilt&&!stop&&<div style={{fontSize:9,color:C.gold,fontWeight:"bold"}}>📉 {recovery.msg}</div>}
          {tSigs.length>0&&!tilt&&!stop&&!recovery?.active&&<div style={{fontSize:9,color:C.gold,fontWeight:"bold"}}>⚡ {tSigs[0]}</div>}
        </div>
      )}
      {lineAlerts.length>0&&<div style={{background:"#fffbeb",borderBottom:"1px solid #fcd34d",padding:"7px 16px"}}><div style={{fontSize:10,color:C.gold,fontWeight:"bold"}}>🎯 {lineAlerts[0].msg}</div></div>}
      {portCorr>70&&activeBetMarkets.length>1&&<div style={{background:"#fff1f0",borderBottom:"1px solid #fecaca",padding:"7px 16px"}}><div style={{fontSize:9,color:C.red,fontWeight:"bold"}}>⚠ CORRELATED PORTFOLIO — {portCorr}% correlation. Exposure risk high.</div></div>}

      <div style={{padding:16,paddingBottom:80}}>

        {/* ══ HOME ════════════════════════════════════════════ */}
        {tab==="home"&&(
          <div>
            {/* Session strip */}
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              {[{l:"TODAY BETS",v:todayBets.length,c:C.crimson},{l:"TODAY P&L",v:(todayPnL>=0?"+":"")+"₹"+Math.abs(todayPnL).toLocaleString("en-IN"),c:todayPnL>=0?C.greenL:C.red},{l:"WIN RATE",v:wr!==null?wr+"%":"—",c:wr>=65?C.greenL:wr>=55?C.gold:C.red}].map(({l,v,c})=>(
                <div key={l} style={{...card({flex:1,padding:"9px 8px",textAlign:"center"})}}>
                  <div style={{fontSize:7,color:C.dim,letterSpacing:2,marginBottom:3,fontWeight:"bold"}}>{l}</div>
                  <div style={{fontSize:13,fontWeight:"bold",color:c}}>{v}</div>
                </div>
              ))}
            </div>

            {/* Stage + stakes */}
            <div style={{...card({marginBottom:12,padding:14})}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><span style={{fontSize:9,color:C.dim,letterSpacing:3,fontWeight:"bold"}}>STAGE PROGRESS</span><span style={{fontSize:9,color:tilt?"#ef4444":stop?"#ef4444":skipNext?"#f97316":recovery?.active?C.gold:C.greenL,fontWeight:"bold"}}>{skipNext?"SKIP":tilt?"TILT":stop?"STOPPED":recovery?.active?"RECOVERY":"READY"}</span></div>
              <div style={{display:"flex",gap:6,marginBottom:10}}>
                {[1,2,3].map(s=>{const a=stage===s,d=stage>s,col=a?C.crimson:d?C.greenL:C.dim;return(
                  <div key={s} style={{flex:1,background:a?C.crimson+"10":d?C.greenL+"10":C.bg,border:"1.5px solid "+(a?C.crimson:d?C.greenL:C.border),borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                    <div style={{fontSize:8,color:col,letterSpacing:2,marginBottom:4,fontWeight:"bold"}}>S{s} {d?"✓":a?"◉":"○"}</div>
                    <div style={{fontSize:13,fontWeight:"bold",color:col}}>₹{tStake(rawStake(br,s,base,ks),"A").toLocaleString("en-IN")}</div>
                    <div style={{fontSize:8,color:C.dim,marginTop:3}}>{s<3?"15%":"profit"}</div>
                  </div>);})}
              </div>
              <div style={{display:"flex",gap:6}}>
                {["A","B","C"].map(t=><div key={t} style={{flex:1,background:C.bg,borderRadius:8,padding:"8px 6px",textAlign:"center",border:"1px solid "+C.border}}><div style={{fontSize:8,color:tierCol(t),marginBottom:3,fontWeight:"bold"}}>T{t}</div><div style={{fontSize:13,fontWeight:"bold",color:tierCol(t)}}>₹{tStake(raw,t).toLocaleString("en-IN")}</div></div>)}
              </div>
            </div>

            {/* Target progress */}
            <div style={{...card({marginBottom:12,padding:14})}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{fontSize:9,color:C.dim,letterSpacing:3,fontWeight:"bold"}}>TARGET ₹3,00,000</span><span style={{fontSize:9,color:C.crimson,fontWeight:"bold"}}>{Math.round(br/TARGET*100)}%</span></div>
              <div style={{height:8,background:C.border,borderRadius:4,marginBottom:8,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,br/TARGET*100)+"%",background:"linear-gradient(90deg,"+C.crimson+","+C.goldL+")",borderRadius:4,transition:"width 0.5s"}}/></div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                {MILESTONES.map(m=><div key={m} style={{textAlign:"center"}}><div style={{width:7,height:7,borderRadius:"50%",background:br>=m?C.crimson:C.border,margin:"0 auto 2px"}}/><div style={{fontSize:7,color:br>=m?C.crimson:C.dim}}>₹{(m/1000).toFixed(0)}k</div></div>)}
              </div>
              {proj&&<div style={{padding:"8px 10px",background:C.bg,borderRadius:8,border:"1px solid "+C.border}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>SEASON PROJECTION</div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontSize:14,fontWeight:"bold",color:proj.projectedFinal>=TARGET?C.greenL:C.gold}}>₹{proj.projectedFinal.toLocaleString("en-IN")}</div><div style={{fontSize:9,color:C.muted}}>Range: ₹{(proj.low/1000).toFixed(0)}k–₹{(proj.high/1000).toFixed(0)}k</div><div style={{fontSize:8,color:C.dim}}>{proj.matchesLeft} matches left</div></div></div>}
            </div>

            {/* Chart */}
            {chartData.length>1&&<div style={{...card({marginBottom:12,padding:14})}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{fontSize:9,color:C.dim,letterSpacing:3,fontWeight:"bold"}}>BANKROLL GROWTH</span><span style={{fontSize:10,color:pl>=0?C.greenL:C.red,fontWeight:"bold"}}>{pl>=0?"+":""}₹{Math.abs(pl).toLocaleString("en-IN")}</span></div><ResponsiveContainer width="100%" height={100}><AreaChart data={chartData}><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.crimson} stopOpacity={0.2}/><stop offset="95%" stopColor={C.crimson} stopOpacity={0}/></linearGradient></defs><XAxis dataKey="n" tick={{fill:C.dim,fontSize:8}} axisLine={false} tickLine={false}/><YAxis tick={{fill:C.dim,fontSize:8}} axisLine={false} tickLine={false} width={44} tickFormatter={v=>"₹"+(v/1000).toFixed(0)+"k"}/><Tooltip contentStyle={{background:C.panel,border:"1px solid "+C.border,borderRadius:6,fontSize:10}} formatter={v=>["₹"+Number(v).toLocaleString("en-IN")]} labelFormatter={l=>"Bet #"+l}/><ReferenceLine y={INIT_BR} stroke={C.border} strokeDasharray="3 3"/><Area type="monotone" dataKey="v" stroke={C.crimson} fill="url(#bg)" strokeWidth={2} dot={false}/></AreaChart></ResponsiveContainer></div>}

            {/* Accuracy */}
            <div style={{...card({marginBottom:12,padding:14})}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:9,color:C.dim,letterSpacing:3,fontWeight:"bold"}}>ENGINE ACCURACY</span><span style={{fontSize:9,color:C.muted}}>{accLog.length} predictions</span></div>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
                <div style={{fontSize:32,fontWeight:"bold",color:engAcc>=72?C.greenL:engAcc>=65?C.gold:C.crimson}}>{engAcc}%</div>
                <div style={{flex:1}}>
                  {[["PP Score",accuracy.pp],["Winner",accuracy.winner],["Total",accuracy.total]].map(([l,v])=>v!==null&&<div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:9,color:C.muted}}>{l}</span><span style={{fontSize:9,color:v>=65?C.greenL:v>=55?C.gold:C.red,fontWeight:"bold"}}>{v}%</span></div>)}
                  {accLog.length===0&&<div style={{fontSize:9,color:C.dim}}>Log matches in Learn tab to track real accuracy</div>}
                </div>
              </div>
              {accuracy.patterns?.map((p,i)=><div key={i} style={{fontSize:9,color:p.type==="good"?C.greenL:C.gold,fontWeight:"bold",marginTop:4}}>{"→ "+p.msg}</div>)}
            </div>

            <div style={{fontSize:9,color:C.gold,letterSpacing:3,marginBottom:10,fontWeight:"bold"}}>TODAY'S MATCHES</div>
            {MATCHES.slice(0,2).map(m=><MCard key={m.id} m={m} onTap={openMatch} intel={realIntelScore(m,"batting",v2026)}/>)}
            <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:10,marginTop:8,fontWeight:"bold"}}>UPCOMING — PHASE 1</div>
            {MATCHES.slice(2).map(m=>(
              <div key={m.id} onClick={()=>openMatch(m)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",...card({marginBottom:8,cursor:"pointer"})}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:14,fontWeight:"bold",color:TEAM_COL[m.t1]||C.crimson}}>{m.t1}</span><span style={{fontSize:9,color:C.dim}}>vs</span><span style={{fontSize:14,fontWeight:"bold",color:TEAM_COL[m.t2]||C.gold}}>{m.t2}</span></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:9,color:C.sub}}>{m.date} · {m.time}</div><div style={{fontSize:8,color:C.dim}}>{m.venue.split(",")[0]}</div></div>
              </div>
            ))}
            <div style={{padding:"12px 16px",background:"#fffbeb",borderRadius:12,border:"1px solid "+C.goldL,textAlign:"center",marginTop:4}}><div style={{fontSize:9,color:C.gold,fontWeight:"bold",letterSpacing:2}}>PHASE 2 SCHEDULE</div><div style={{fontSize:10,color:C.muted,marginTop:4}}>Matches after April 12 added when officially announced</div></div>
          </div>
        )}

        {/* ══ MATCH ═══════════════════════════════════════════ */}
        {tab==="match"&&match&&(()=>{
          const intel=realIntelScore(match,toss,v2026);
          return(
          <div>
            <div style={{...card({marginBottom:10,padding:0,overflow:"hidden"})}}>
              <div style={{height:4,background:"linear-gradient(90deg,"+(TEAM_COL[match.t1]||C.crimson)+","+(TEAM_COL[match.t2]||C.gold)+")"}}/>
              <div style={{padding:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:22,fontWeight:"bold",color:TEAM_COL[match.t1]||C.crimson}}>{match.t1}</span><span style={{fontSize:9,color:C.dim}}>vs</span><span style={{fontSize:22,fontWeight:"bold",color:TEAM_COL[match.t2]||C.gold}}>{match.t2}</span></div>
                  <div style={{textAlign:"right"}}><div style={{padding:"3px 10px",borderRadius:20,background:intel.col+"18",border:"1px solid "+intel.col+"40",fontSize:10,fontWeight:"bold",color:intel.col,marginBottom:4}}>{intel.verdict}</div><div style={{fontSize:10,fontWeight:"bold",color:winProb>=55?C.greenL:winProb<=45?C.red:C.gold}}>{match.t1} {winProb}% | {match.t2} {100-winProb}%</div></div>
                </div>
                <div style={{fontSize:9,color:C.dim,marginBottom:8}}>📍 {match.venue} · {match.time}</div>
                <div style={{display:"flex",gap:5}}>
                  {[["PP",(calibratedVenue(match.venue,v2026)).pp],["10ov",(calibratedVenue(match.venue,v2026)).ov10],["15ov",(calibratedVenue(match.venue,v2026)).ov15],["TOT",(calibratedVenue(match.venue,v2026)).total],["CHS",((VENUES_BASE[match.venue]||{}).chase||50)+"%"]].map(([l,v])=>(
                    <div key={l} style={{flex:1,background:C.bg,borderRadius:6,padding:"5px 3px",textAlign:"center",border:"1px solid "+C.border}}><div style={{fontSize:7,color:C.dim,marginBottom:1}}>{l}</div><div style={{fontSize:11,color:C.crimson,fontWeight:"bold"}}>{v}</div></div>
                  ))}
                </div>
              </div>
            </div>

            {/* Innings toggle */}
            <div style={{display:"flex",gap:6,marginBottom:10}}>
              <button onClick={()=>setIs2nd(false)} style={{...tbtn(!is2nd),flex:1,fontSize:10}}>1st INN — Predict</button>
              <button onClick={()=>setIs2nd(true)} style={{...tbtn(is2nd,C.gold),flex:1,fontSize:10}}>2nd INN — Chase</button>
            </div>
            {is2nd&&<div style={{...card({marginBottom:10,padding:12,background:"#fffbeb",border:"1px solid "+C.goldL})}}><div style={{fontSize:9,color:C.gold,letterSpacing:3,marginBottom:8,fontWeight:"bold"}}>CHASE MODE</div><div style={{display:"flex",gap:8,alignItems:"center"}}><input type="number" value={target||""} onChange={e=>setTarget(+e.target.value)} placeholder="Target..." style={{...sel,fontSize:20,fontWeight:"bold",textAlign:"center",color:C.crimson}}/>{target>0&&pred?.chaseProj&&<div style={{textAlign:"center",minWidth:80}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>REQ RR</div><div style={{fontSize:16,fontWeight:"bold",color:pred.chaseProj.feasible?C.greenL:C.red}}>{pred.chaseProj.reqRR}</div><div style={{fontSize:8,color:C.dim}}>PROJ {pred.chaseProj.projRR}</div></div>}</div></div>}

            {/* Sub tabs */}
            <div style={{display:"flex",gap:6,marginBottom:10,overflowX:"auto",scrollbarWidth:"none"}}>
              {[["predict","📊 Predict"],["odds","🎯 Odds Gap"],["phase","📈 Phase"],["bowlers","🎳 Bowlers"],["live","📡 Live"]].map(([id,label])=>(
                <button key={id} onClick={()=>setSub(id)} style={{...tbtn(sub===id),flexShrink:0,padding:"7px 12px",fontSize:10}}>{label}</button>
              ))}
            </div>

            {/* PREDICT */}
            {sub==="predict"&&(
              <div>
                {liveData?.isLive&&(
                  <div style={{...card({marginBottom:10,padding:0,overflow:"hidden",border:"1.5px solid "+C.crimsonL})}}>
                    {/* Score header */}
                    <div style={{background:C.crimson+"08",padding:"10px 12px",borderBottom:"1px solid "+C.border}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <div style={{width:6,height:6,borderRadius:"50%",background:C.crimsonL,animation:"blink 1s infinite"}}/>
                          <span style={{fontSize:10,fontWeight:"bold",color:C.crimson}}>{liveData.battingTeam}</span>
                          <span style={{fontSize:22,fontWeight:"bold",color:C.text}}>{lS}/{lW}</span>
                          <span style={{fontSize:11,color:C.muted}}>({lO} ov)</span>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:10,fontWeight:"bold",color:C.gold}}>RR {liveData.runRate}</div>
                          {liveData.target&&<div style={{fontSize:9,color:C.gold}}>Target {liveData.target}</div>}
                          <div style={{fontSize:7,color:C.dim}}>upd {lastUpd}</div>
                        </div>
                      </div>
                      {is2nd&&target>0&&lS&&lO>0&&(
                        <div style={{display:"flex",gap:16,padding:"6px 0",borderTop:"1px solid "+C.border+"40"}}>
                          <div style={{fontSize:9,color:C.dim}}>Need <span style={{color:C.crimson,fontWeight:"bold"}}>{target-lS}</span> off <span style={{color:C.crimson,fontWeight:"bold"}}>{Math.round((20-lO)*6)}</span> balls</div>
                          <div style={{fontSize:9,color:C.dim}}>RRR <span style={{fontWeight:"bold",color:(((target-lS)/Math.max(1,(20-lO)*6))*6)>10?C.red:(((target-lS)/Math.max(1,(20-lO)*6))*6)>8?C.gold:C.greenL}}>{(((target-lS)/Math.max(1,(20-lO)*6))*6).toFixed(1)}</span></div>
                        </div>
                      )}
                      {liveData.recentBalls&&(
                        <div style={{display:"flex",gap:4,alignItems:"center",marginTop:4}}>
                          <span style={{fontSize:8,color:C.dim}}>Last 6:</span>
                          {liveData.recentBalls.split(" ").map((b,i)=>(
                            <span key={i} style={{width:20,height:20,borderRadius:"50%",background:b==="6"?C.gold+"30":b==="4"?C.greenL+"20":b==="W"?C.crimson+"30":C.bg,border:"1px solid "+(b==="6"?C.goldL:b==="4"?C.greenL:b==="W"?C.crimson:C.border),display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:"bold",color:b==="6"?C.gold:b==="4"?C.greenL:b==="W"?C.crimson:C.muted}}>{b}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Batting scorecard */}
                    <div style={{padding:"8px 12px",borderBottom:"1px solid "+C.border}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                        <div style={{fontSize:7,color:C.dim,fontWeight:"bold",letterSpacing:2,flex:1}}>BATTER</div>
                        <div style={{display:"flex",gap:0,width:96,justifyContent:"space-between"}}>
                          {["R","B","SR"].map(h=><span key={h} style={{fontSize:7,color:C.dim,fontWeight:"bold",width:32,textAlign:"right"}}>{h}</span>)}
                        </div>
                      </div>
                      {/* Current batsmen */}
                      {[{name:striker,isStriker:true},{name:nonStrike,isStriker:false}].filter(b=>b.name&&b.name!=="Other Batsman").map(({name,isStriker})=>{
                        const inn=( Array.isArray(liveData?.innings)?liveData.innings:[] ).find(i=>!i.overs||i.overs<20)||( Array.isArray(liveData?.innings)?liveData.innings:[] )[( Array.isArray(liveData?.innings)?liveData.innings:[] ).length-1];
                        const b=inn?.batting?.find(bt=>bt.name?.includes(name.split(" ").slice(-1)[0])||name.includes(bt.name?.split(" ").slice(-1)[0]||"x"));
                        return(
                          <div key={name} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3,padding:"5px 6px",background:isStriker?C.crimson+"08":C.bg,borderRadius:6,border:isStriker?"1px solid "+C.crimson+"20":"none"}}>
                            <div style={{display:"flex",alignItems:"center",gap:5,flex:1}}>
                              <span style={{fontSize:9,color:isStriker?C.crimson:C.dim}}>{isStriker?"●":"○"}</span>
                              <span style={{fontSize:10,fontWeight:isStriker?"bold":"normal",color:C.text}}>{name.split(" ").slice(-1)[0]}</span>
                              {isStriker&&<span style={{fontSize:9,color:C.crimson,fontWeight:"bold"}}>*</span>}
                            </div>
                            <div style={{display:"flex",width:96,justifyContent:"space-between"}}>
                              <span style={{fontSize:11,fontWeight:"bold",color:isStriker?C.crimson:C.text,width:32,textAlign:"right"}}>{b?.runs??"-"}</span>
                              <span style={{fontSize:10,color:C.muted,width:32,textAlign:"right"}}>{b?.balls??"-"}</span>
                              <span style={{fontSize:10,color:b?.sr>150?C.greenL:b?.sr>100?C.gold:b?.sr>0?C.red:C.muted,fontWeight:"bold",width:32,textAlign:"right"}}>{b?.sr??"-"}</span>
                            </div>
                          </div>
                        );
                      })}
                      {/* Already dismissed */}
                      {(()=>{
                        const inn=( Array.isArray(liveData?.innings)?liveData.innings:[] ).find(i=>!i.overs||i.overs<20)||( Array.isArray(liveData?.innings)?liveData.innings:[] )[( Array.isArray(liveData?.innings)?liveData.innings:[] ).length-1];
                        const out=(inn?.batting||[]).filter(b=>b.out&&b.balls>0).slice(-3);
                        return out.map(b=>(
                          <div key={b.name} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2,padding:"3px 6px",opacity:0.5}}>
                            <span style={{fontSize:9,color:C.muted,flex:1}}>{b.name?.split(" ").slice(-1)[0]}</span>
                            <div style={{display:"flex",width:96,justifyContent:"space-between"}}>
                              <span style={{fontSize:9,color:C.muted,width:32,textAlign:"right"}}>{b.runs}</span>
                              <span style={{fontSize:9,color:C.muted,width:32,textAlign:"right"}}>{b.balls}</span>
                              <span style={{fontSize:9,color:C.muted,width:32,textAlign:"right"}}>{b.sr}</span>
                            </div>
                          </div>
                        ));
                        }catch(e){return null;}
                      })()}
                    </div>
                    {/* Bowling scorecard */}
                    <div style={{padding:"8px 12px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                        <div style={{fontSize:7,color:C.dim,fontWeight:"bold",letterSpacing:2,flex:1}}>BOWLER</div>
                        <div style={{display:"flex",width:112,justifyContent:"space-between"}}>
                          {["O","R","W","ECO"].map(h=><span key={h} style={{fontSize:7,color:C.dim,fontWeight:"bold",width:28,textAlign:"right"}}>{h}</span>)}
                        </div>
                      </div>
                      {bowlerSpells.length>0?(
                        bowlerSpells.slice(0,5).map(b=>{
                          const isCurrent=bowler&&(b.name?.includes(bowler.split(" ").slice(-1)[0])||bowler.includes(b.name?.split(" ").slice(-1)[0]||"x"));
                          return(
                            <div key={b.name} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3,padding:"4px 6px",background:isCurrent?C.gold+"10":C.bg,borderRadius:6,border:isCurrent?"1px solid "+C.goldL:"none"}}>
                              <div style={{display:"flex",alignItems:"center",gap:4,flex:1}}>
                                {isCurrent&&<span style={{fontSize:8,color:C.gold}}>●</span>}
                                <span style={{fontSize:9,fontWeight:isCurrent?"bold":"normal",color:C.text}}>{b.name?.split(" ").slice(-1)[0]}</span>
                              </div>
                              <div style={{display:"flex",width:112,justifyContent:"space-between"}}>
                                <span style={{fontSize:9,color:C.muted,width:28,textAlign:"right"}}>{b.overs}</span>
                                <span style={{fontSize:9,color:C.muted,width:28,textAlign:"right"}}>{b.runs}</span>
                                <span style={{fontSize:9,color:b.wickets>0?C.crimson:C.muted,fontWeight:b.wickets>0?"bold":"normal",width:28,textAlign:"right"}}>{b.wickets}</span>
                                <span style={{fontSize:9,color:b.econ<7?C.greenL:b.econ<9?C.gold:C.red,fontWeight:"bold",width:28,textAlign:"right"}}>{b.econ}</span>
                              </div>
                            </div>
                          );
                        })
                      ):(
                        bowler&&bowler!=="Average Bowler"&&(
                          <div style={{padding:"4px 6px",background:C.gold+"10",borderRadius:6,border:"1px solid "+C.goldL}}>
                            <span style={{fontSize:9,color:C.text,fontWeight:"bold"}}>● {bowler.split(" ").slice(-1)[0]}</span>
                            <span style={{fontSize:8,color:C.muted,marginLeft:8}}>currently bowling</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {!liveData?.isLive&&<div style={{display:"flex",gap:8,marginBottom:10}}><div style={{flex:1}}><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>BATS FIRST</div><div style={{display:"flex",gap:6}}><button onClick={()=>{setToss("batting");setBattingFirst(match.t1);}} style={{...tbtn(battingFirst===match.t1,TEAM_COL[match.t1]),flex:1,fontSize:9}}>{match.t1}</button><button onClick={()=>{setToss("chasing");setBattingFirst(match.t2);}} style={{...tbtn(battingFirst===match.t2,TEAM_COL[match.t2]),flex:1,fontSize:9}}>{match.t2}</button></div></div><div style={{flex:1}}><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>PITCH</div><select value={pitch} onChange={e=>setPitch(e.target.value)} style={sel}><option value="balanced">Balanced</option><option value="batting">Batting</option><option value="seaming">Seaming</option><option value="turning">Turning</option><option value="slow">Slow</option></select></div></div>}

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                  <div><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>STRIKER</div><select value={striker} onChange={e=>setStriker(e.target.value)} style={sel}>{(SQUADS[bTeam||match.t1]||[]).map(p=><option key={p}>{p}</option>)}<option>Other Batsman</option></select></div>
                  <div><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>NON-STRIKER</div><select value={nonStrike} onChange={e=>setNonStrike(e.target.value)} style={sel}>{(SQUADS[bTeam||match.t1]||[]).map(p=><option key={p}>{p}</option>)}<option>Other Batsman</option></select></div>
                  <div><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>BOWLER (PP)</div><select value={bowler} onChange={e=>setBowler(e.target.value)} style={sel}>{(SQUADS[blTeam||match.t2]||[]).filter(p=>BOWLERS_BASE[p]).map(p=><option key={p}>{p}</option>)}<option>Average Bowler</option></select></div>
                  <div><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>WEATHER</div><select value={wx} onChange={e=>setWx(e.target.value)} style={sel}><option value="clear">Clear</option><option value="dew">Dew</option><option value="overcast">Overcast</option><option value="humid">Humid</option></select></div>
                </div>

                {/* Impact player */}
                <div style={{marginBottom:10}}><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>IMPACT PLAYER (if announced)</div><select value={impactPlayer} onChange={e=>setImpactPlayer(e.target.value)} style={sel}><option value="">None announced</option>{(IMPACT_PLAYERS[bTeam||match.t1]||[]).map(ip=><option key={ip.n} value={ip.n}>{ip.n} (+{ip.runsAdded} runs est)</option>)}</select></div>
                {impactPlayer&&pred?.ipBonus>0&&<div style={{marginBottom:10,padding:"8px 10px",background:C.gold+"10",borderRadius:8,border:"1px solid "+C.goldL}}><div style={{fontSize:9,color:C.gold,fontWeight:"bold"}}>⚡ IMPACT: +{Math.round(pred.ipBonus)} runs added to projection</div></div>}

                {!liveData?.isLive&&<button onClick={fetchTossAndLineup} disabled={fetchingToss} style={{width:"100%",padding:11,borderRadius:8,fontSize:10,cursor:fetchingToss?"not-allowed":"pointer",background:"#eff6ff",border:"1.5px solid #3b82f6",color:"#1e40af",fontFamily:"inherit",fontWeight:"bold",marginBottom:8}}>
                  {fetchingToss?"⏳ FETCHING TOSS & PLAYING 11...":"🏏 GET TOSS & PLAYING 11"}
                </button>}
                {tossData?.error&&<div style={{fontSize:9,color:C.red,marginBottom:8,padding:"6px 10px",background:"#fff1f0",borderRadius:6}}>{tossData.error}</div>}
                {tossData&&!tossData.error&&<div style={{fontSize:9,color:C.greenL,marginBottom:8,padding:"6px 10px",background:"#f0fdf4",borderRadius:6,border:"1px solid "+C.greenL}}>✅ {tossData.tossWinner?.split(" ").slice(-2).join(" ")} won toss → {tossData.tossChoice==="bat"?"batting":"fielding"} first. Playing 11 loaded.</div>}
                <button onClick={doFetch} disabled={fetching} style={{width:"100%",padding:11,borderRadius:8,fontSize:10,cursor:fetching?"not-allowed":"pointer",background:C.crimson+"10",border:"1.5px solid "+C.crimson,color:C.crimson,fontFamily:"inherit",fontWeight:"bold",marginBottom:10}}>
                  {fetching?<span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><span style={{width:10,height:10,border:"2px solid "+C.crimson,borderTopColor:"transparent",borderRadius:"50%",display:"inline-block",animation:"spin 0.8s linear infinite"}}/>fetching...</span>:"📡 GET LIVE SCORE"}
                </button>

                {pred&&(
                  <div>
                    {/* Remaining batting depth */}
                    {remainingBat.yetToBat.length>0&&(
                      <div style={{...card({marginBottom:10,padding:10})}}>
                        <div style={{fontSize:8,color:C.dim,letterSpacing:2,marginBottom:6,fontWeight:"bold"}}>BATTING DEPTH REMAINING</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                          {remainingBat.yetToBat.slice(0,6).map(p=>(
                            <div key={p} style={{padding:"3px 8px",borderRadius:12,background:C.bg,border:"1px solid "+C.border,fontSize:8,color:C.text}}>
                              {p.split(" ").slice(-1)[0]}
                              {(PLAYERS_BASE[p]?.deathSR||0)>180&&<span style={{color:C.gold}}> ★</span>}
                            </div>
                          ))}
                        </div>
                        <div style={{display:"flex",gap:12}}>
                          <div style={{fontSize:8,color:C.dim}}>Mid SR avg: <span style={{color:C.crimson,fontWeight:"bold"}}>{remainingBat.avgMidSR}</span></div>
                          <div style={{fontSize:8,color:C.dim}}>Death SR avg: <span style={{color:remainingBat.hasFinisher?C.greenL:C.crimson,fontWeight:"bold"}}>{remainingBat.avgDeathSR}{remainingBat.hasFinisher?" ★":""}</span></div>
                        </div>
                      </div>
                    )}
                    {/* Win prob bar */}
                    <div style={{...card({marginBottom:10,padding:12})}}>
                      <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:8,fontWeight:"bold"}}>WIN PROBABILITY</div>
                      <div style={{display:"flex",gap:4,marginBottom:6}}>
                        <div style={{flex:winProb,background:C.greenL+"18",border:"1px solid "+C.greenL+"40",borderRadius:6,padding:"8px 4px",textAlign:"center"}}><div style={{fontSize:8,color:C.greenL,fontWeight:"bold"}}>{match.t1}</div><div style={{fontSize:18,fontWeight:"bold",color:C.greenL}}>{winProb}%</div></div>
                        <div style={{flex:100-winProb,background:C.gold+"18",border:"1px solid "+C.goldL+"40",borderRadius:6,padding:"8px 4px",textAlign:"center"}}><div style={{fontSize:8,color:C.gold,fontWeight:"bold"}}>{match.t2}</div><div style={{fontSize:18,fontWeight:"bold",color:C.gold}}>{100-winProb}%</div></div>
                      </div>
                      <div style={{height:6,background:C.border,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:winProb+"%",background:"linear-gradient(90deg,"+C.greenL+","+C.goldL+")",borderRadius:3,transition:"width 0.5s"}}/></div>
                    </div>

                    {BETS.filter(bt=>bt.id!=="winner").map(bt=>{
                      const{val,lo,hi}=getBV(bt.id,pred);const line=lines[bt.id]||"";const v2=verdict(val,line);const stake=tStake(raw,bt.tier);
                      return(
                        <div key={bt.id} style={{...card({marginBottom:8,padding:12,background:v2?.strong?"#f0fdf4":v2?.e&&Math.abs(v2.e)>=3?"#fffbeb":C.card,border:"1.5px solid "+(v2?.strong?C.greenL:v2?.e&&Math.abs(v2.e)>=3?C.goldL:C.border)})}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:12,fontWeight:"bold",color:C.text}}>{bt.icon} {bt.label}</span>{v2&&<span style={{fontSize:11,fontWeight:"bold",color:v2.color,padding:"3px 10px",borderRadius:12,background:v2.bg,border:"1px solid "+v2.bdr}}>{v2.text} {v2.conf}%</span>}</div>
                          <div style={{fontSize:8,color:C.dim,marginBottom:6}}>PRED: <span style={{color:C.crimson,fontWeight:"bold"}}>{val}</span> <span style={{color:C.muted}}>({lo}–{hi})</span></div>
                          <input type="number" value={line} onChange={e=>updateLine(bt.id,e.target.value,lO)} placeholder="Platform line..." style={{width:"100%",background:C.bg,border:"1px solid "+C.border,color:C.text,borderRadius:6,padding:"7px 8px",fontFamily:"inherit",fontSize:14,fontWeight:"bold",marginBottom:v2?.strong?8:0}}/>
                          {v2?.strong&&<button onClick={()=>placeBet(bt,stake)} disabled={tilt||stop||skipNext} style={{width:"100%",padding:10,borderRadius:8,fontSize:11,cursor:"pointer",background:tilt||stop||skipNext?"transparent":"linear-gradient(135deg,"+C.greenL+","+C.gold+")",border:tilt||stop||skipNext?"1px solid "+C.border:"none",color:tilt||stop||skipNext?C.dim:C.white,fontFamily:"inherit",fontWeight:"bold"}}>⚔ BET T{bt.tier} — ₹{stake.toLocaleString("en-IN")}</button>}
                        </div>
                      );
                    })}

                    {/* Match winner */}
                    <div style={{...card({padding:12})}}>
                      <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:8,fontWeight:"bold"}}>MATCH WINNER</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        {[match.t1,match.t2].map((team,i)=>{const prob=i===0?winProb:100-winProb;const stake=tStake(raw,"A");const isGood=prob>55;return(
                          <div key={team} style={{padding:12,borderRadius:10,background:isGood?C.greenL+"10":C.bg,border:"1px solid "+(isGood?C.greenL:C.border),textAlign:"center"}}>
                            <div style={{fontSize:12,fontWeight:"bold",color:TEAM_COL[team]||C.crimson,marginBottom:4}}>{team}</div>
                            <div style={{fontSize:20,fontWeight:"bold",color:prob>=55?C.greenL:prob<=45?C.red:C.gold,marginBottom:6}}>{prob}%</div>
                            {isGood&&<button onClick={()=>placeBet(BETS.find(b=>b.id==="winner"),stake)} style={{width:"100%",padding:"8px",borderRadius:6,fontSize:10,cursor:"pointer",background:C.greenL+"18",border:"1px solid "+C.greenL,color:C.greenL,fontFamily:"inherit",fontWeight:"bold"}}>BET ₹{stake.toLocaleString("en-IN")}</button>}
                          </div>
                        );})}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ODDS GAP */}
            {sub==="odds"&&(
              <div>
                <div style={{...card({marginBottom:10,padding:14})}}>
                  <div style={{fontSize:9,color:C.crimson,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>ODDS GAP CALCULATOR</div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:12,lineHeight:1.5}}>Enter platform odds → SHAKTI compares real probability vs implied probability → calculates edge and EV.</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    <div><div style={{fontSize:8,color:C.greenL,marginBottom:3,fontWeight:"bold"}}>FAV ODDS (1st)</div><input type="number" value={ogFavOdds} onChange={e=>setOgFavOdds(+e.target.value)} style={{...sel,fontSize:18,color:C.greenL,fontWeight:"bold",textAlign:"center"}}/><div style={{fontSize:8,color:C.dim,marginTop:2}}>stake₹100 → profit₹{ogFavOdds}</div></div>
                    <div><div style={{fontSize:8,color:C.gold,marginBottom:3,fontWeight:"bold"}}>UND ODDS (2nd)</div><input type="number" value={ogUndOdds} onChange={e=>setOgUndOdds(+e.target.value)} style={{...sel,fontSize:18,color:C.gold,fontWeight:"bold",textAlign:"center"}}/><div style={{fontSize:8,color:C.dim,marginTop:2}}>stake₹{ogUndOdds} → profit₹100</div></div>
                  </div>
                  <div style={{marginBottom:10}}><div style={{fontSize:8,color:C.dim,marginBottom:6,fontWeight:"bold"}}>BETTING ON</div><div style={{display:"flex",gap:8}}><button onClick={()=>setOgRole("fav")} style={{...tbtn(ogRole==="fav",C.greenL),flex:1}}>{match.t1} (Fav)</button><button onClick={()=>setOgRole("und")} style={{...tbtn(ogRole==="und",C.gold),flex:1}}>{match.t2} (Und)</button></div></div>
                  <div style={{marginBottom:10}}><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>YOUR STAKE</div><input type="number" value={ogStake} onChange={e=>setOgStake(+e.target.value)} style={{...sel,fontSize:18,fontWeight:"bold",textAlign:"center",color:C.crimson}}/></div>
                </div>
                <div style={{...card({padding:14,background:ogGap>=8?"#f0fdf4":ogGap>=4?"#fffbeb":ogGap>0?"#f8f9fa":"#fff1f0",border:"2px solid "+(ogGap>=8?C.greenL:ogGap>=4?C.goldL:ogGap>0?C.border:C.red)})}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                    <div style={{textAlign:"center"}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>IMPLIED PROB</div><div style={{fontSize:22,fontWeight:"bold",color:C.muted}}>{ogImplied}%</div><div style={{fontSize:8,color:C.dim}}>market says</div></div>
                    <div style={{textAlign:"center"}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>SHAKTI PROB</div><div style={{fontSize:22,fontWeight:"bold",color:C.crimson}}>{ogReal}%</div><div style={{fontSize:8,color:C.dim}}>our model</div></div>
                    <div style={{textAlign:"center"}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>EDGE</div><div style={{fontSize:22,fontWeight:"bold",color:ogGap>=5?C.greenL:ogGap>0?C.gold:C.red}}>{ogGap>0?"+":""}{ogGap}%</div><div style={{fontSize:8,color:C.dim}}>gap</div></div>
                  </div>
                  <div style={{padding:12,borderRadius:10,background:C.card,marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:10,color:C.sub}}>Expected Value on ₹{ogStake.toLocaleString("en-IN")}</span><span style={{fontSize:14,fontWeight:"bold",color:ogEV>0?C.greenL:C.red}}>{ogEV>0?"+":""}₹{ogEV.toLocaleString("en-IN")}</span></div>
                    <div style={{fontSize:9,color:C.muted}}>{ogEV>0?`EV positive — expected profit ₹${ogEV} per bet at these odds`:ogEV===0?"Break-even — no edge at these odds":"Negative EV — market has the edge"}</div>
                  </div>
                  <div style={{fontSize:12,fontWeight:"bold",color:ogGap>=8?C.greenL:ogGap>=5?C.gold:ogGap>0?C.muted:C.red,letterSpacing:2}}>
                    {ogGap>=8?"⚔ STRONG BET — CLEAR EDGE":ogGap>=5?"✓ BET — POSITIVE EV":ogGap>=3?"LEAN BET — THIN EDGE":ogGap>0?"MARGINAL — WAIT FOR BETTER ODDS":"SKIP — NEGATIVE EV"}
                  </div>
                </div>
              </div>
            )}

            {/* PHASE PROBABILITY */}
            {sub==="phase"&&pred&&(
              <div>
                <div style={{...card({marginBottom:10,padding:14})}}>
                  <div style={{fontSize:9,color:C.crimson,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>PP PHASE PROBABILITY</div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:12}}>Probability distribution around our PP prediction of <span style={{color:C.crimson,fontWeight:"bold"}}>{pred.pp}</span></div>
                  {pred.ppDist.map(({line,probOver,probUnder})=>(
                    <div key={line} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <div style={{width:36,fontSize:10,fontWeight:"bold",color:C.text,textAlign:"center"}}>{line}</div>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",height:20,borderRadius:4,overflow:"hidden"}}>
                          <div style={{width:probUnder+"%",background:C.red+"40",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:8,color:C.red,fontWeight:"bold"}}>{probUnder<20?"":probUnder+"%"}</span></div>
                          <div style={{width:probOver+"%",background:C.greenL+"40",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:8,color:C.greenL,fontWeight:"bold"}}>{probOver<20?"":probOver+"%"}</span></div>
                        </div>
                      </div>
                      <div style={{textAlign:"right",minWidth:70}}>
                        <div style={{fontSize:9,color:C.greenL,fontWeight:"bold"}}>OVER {probOver}%</div>
                        <div style={{fontSize:9,color:C.red}}>UNDER {probUnder}%</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{...card({padding:14})}}>
                  <div style={{fontSize:9,color:C.crimson,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>TOTAL PHASE PROBABILITY</div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:12}}>Distribution around predicted total of <span style={{color:C.crimson,fontWeight:"bold"}}>{pred.tot}</span></div>
                  {pred.totDist.map(({line,probOver,probUnder})=>(
                    <div key={line} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <div style={{width:36,fontSize:10,fontWeight:"bold",color:C.text,textAlign:"center"}}>{line}</div>
                      <div style={{flex:1}}><div style={{display:"flex",height:20,borderRadius:4,overflow:"hidden"}}><div style={{width:probUnder+"%",background:C.red+"40",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:8,color:C.red,fontWeight:"bold"}}>{probUnder<20?"":probUnder+"%"}</span></div><div style={{width:probOver+"%",background:C.greenL+"40",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:8,color:C.greenL,fontWeight:"bold"}}>{probOver<20?"":probOver+"%"}</span></div></div></div>
                      <div style={{textAlign:"right",minWidth:70}}><div style={{fontSize:9,color:C.greenL,fontWeight:"bold"}}>OVER {probOver}%</div><div style={{fontSize:9,color:C.red}}>UNDER {probUnder}%</div></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sub==="phase"&&!pred&&<div style={{...card({padding:20,textAlign:"center",color:C.dim})}}>Open a match and set conditions to see phase probabilities</div>}

            {/* BOWLERS */}
            {sub==="bowlers"&&(
              <div>
                <div style={{...card({marginBottom:10,padding:14})}}>
                  <div style={{fontSize:9,color:C.crimson,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>PP BOWLING ATTACK — {blTeam||match.t2}</div>
                  {(PP_BOWLERS[blTeam||match.t2]||[]).map((b,i)=>(
                    <div key={b.n} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid "+C.border}}>
                      <div><div style={{fontSize:11,color:C.text,fontWeight:"bold"}}>{i+1}. {b.n}</div><div style={{fontSize:8,color:C.dim,marginTop:2}}>Typically bowls overs {["1,4","2,3","5 or 6"][i]||"varies"}</div></div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:16,fontWeight:"bold",color:b.e<=7?C.greenL:b.e<=8.5?C.gold:C.red}}>{b.e}</div>
                        <div style={{fontSize:8,color:C.dim}}>PP econ</div>
                        <div style={{fontSize:8,color:b.e<=7?"#dc2626":C.dim,fontWeight:"bold"}}>{b.e<=7?"DANGER":b.e<=8?"GOOD":"BEATABLE"}</div>
                      </div>
                    </div>
                  ))}
                  {(PP_BOWLERS[blTeam||match.t2]||[]).length>0&&(
                    <div style={{marginTop:10,padding:10,background:C.bg,borderRadius:8}}>
                      <div style={{fontSize:8,color:C.dim,marginBottom:2}}>TEAM PP ECON AVG</div>
                      <div style={{fontSize:18,fontWeight:"bold",color:C.crimson}}>{getTeamPPEconFull(blTeam||match.t2).toFixed(2)}</div>
                      <div style={{fontSize:8,color:getTeamPPEconFull(blTeam||match.t2)<=7.5?C.red:getTeamPPEconFull(blTeam||match.t2)<=8.5?C.gold:C.greenL}}>{getTeamPPEconFull(blTeam||match.t2)<=7.5?"TIGHT ATTACK — expect low PP":getTeamPPEconFull(blTeam||match.t2)<=8.5?"AVERAGE ATTACK":"LEAKY — runs available in PP"}</div>
                    </div>
                  )}
                </div>
                <div style={{...card({padding:14})}}>
                  <div style={{fontSize:9,color:C.gold,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>TOSS INTELLIGENCE — {match.venue.split(",")[0]}</div>
                  {(()=>{const ti=TOSS_INTEL[match.venue]||{bat:50,field:50,note:"No data"};return(
                    <div>
                      <div style={{display:"flex",gap:8,marginBottom:10}}>
                        <div style={{flex:1,padding:12,borderRadius:10,background:ti.bat>ti.field?C.greenL+"10":C.bg,border:"1px solid "+(ti.bat>ti.field?C.greenL:C.border),textAlign:"center"}}><div style={{fontSize:9,fontWeight:"bold",color:C.text,marginBottom:4}}>BAT FIRST</div><div style={{fontSize:22,fontWeight:"bold",color:ti.bat>ti.field?C.greenL:C.muted}}>{ti.bat}%</div><div style={{fontSize:8,color:C.dim}}>win rate</div></div>
                        <div style={{flex:1,padding:12,borderRadius:10,background:ti.field>ti.bat?C.greenL+"10":C.bg,border:"1px solid "+(ti.field>ti.bat?C.greenL:C.border),textAlign:"center"}}><div style={{fontSize:9,fontWeight:"bold",color:C.text,marginBottom:4}}>FIELD FIRST</div><div style={{fontSize:22,fontWeight:"bold",color:ti.field>ti.bat?C.greenL:C.muted}}>{ti.field}%</div><div style={{fontSize:8,color:C.dim}}>win rate</div></div>
                      </div>
                      <div style={{padding:10,background:"#fffbeb",borderRadius:8,border:"1px solid "+C.goldL}}><div style={{fontSize:9,color:C.gold,fontWeight:"bold"}}>💡 {ti.note}</div></div>
                      <div style={{marginTop:10,padding:10,background:C.bg,borderRadius:8}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>YOUR CURRENT TOSS</div><div style={{fontSize:11,fontWeight:"bold",color:C.crimson}}>{battingFirst||match.t1} bats first → {toss==="batting"?"batting":"chasing"}</div><div style={{fontSize:8,color:toss==="batting"?ti.bat>50?C.greenL:C.red:ti.field>50?C.greenL:C.red,marginTop:2}}>{toss==="batting"?ti.bat>50?"✓ Toss-favoured situation":"⚠ Toss working against you":ti.field>50?"✓ Toss-favoured situation":"⚠ Toss working against you"}</div></div>
                    </div>
                  );})()}
                </div>
              </div>
            )}

            {/* LIVE */}
            {sub==="live"&&(
              <div>
                <div style={card()}>
                  <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:10,fontWeight:"bold"}}>LINE MOVEMENT TRACKER</div>
                  {BETS.filter(b=>!["winner"].includes(b.id)).map(bt=>{
                    const h=lineHist[bt.id]||[];const{val}=getBV(bt.id,pred)||{val:0};const line=lines[bt.id]||"";const v2=verdict(val,line);
                    return(
                      <div key={bt.id} style={{marginBottom:10,padding:10,background:C.bg,borderRadius:8,border:"1px solid "+C.border}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}><span style={{fontSize:11,color:C.text,fontWeight:"bold"}}>{bt.icon} {bt.label}</span>{v2&&<span style={{fontSize:10,fontWeight:"bold",color:v2.color}}>{v2.text}</span>}</div>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <div style={{flex:1}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>PRED: {val} ({pred?getBV(bt.id,pred).lo:0}–{pred?getBV(bt.id,pred).hi:0})</div><input type="number" value={line} onChange={e=>updateLine(bt.id,e.target.value,lO)} placeholder="Platform line" style={{width:"100%",background:C.panel,border:"1px solid "+C.border,color:C.text,borderRadius:6,padding:"6px 8px",fontFamily:"inherit",fontSize:14,fontWeight:"bold"}}/></div>
                          {h.length>0&&<div style={{textAlign:"center"}}><div style={{fontSize:7,color:C.dim,marginBottom:1}}>LAST</div><div style={{fontSize:11,color:C.sub}}>{h[h.length-1].line}</div></div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );})()}

        {/* ══ HEDGE ════════════════════════════════════════════ */}
        {tab==="hedge"&&(
          <div>
            <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>💹 HEDGE CALCULATOR</div>
            <div style={card()}>
              <div style={{fontSize:9,color:C.crimson,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>STEP 1 — ORIGINAL BET</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 16px 1fr",gap:6,alignItems:"center",marginBottom:10}}>
                <div><div style={{fontSize:8,color:C.greenL,marginBottom:3,fontWeight:"bold"}}>FAVOURITE (1st)</div><input value={hFav} onChange={e=>setHFav(e.target.value)} style={{...sel,textAlign:"center",fontWeight:"bold"}} placeholder="CSK"/></div>
                <div style={{textAlign:"center",color:C.dim,fontSize:9,marginTop:14}}>vs</div>
                <div><div style={{fontSize:8,color:C.gold,marginBottom:3,fontWeight:"bold"}}>UNDERDOG (2nd)</div><input value={hUnd} onChange={e=>setHUnd(e.target.value)} style={{...sel,textAlign:"center",fontWeight:"bold"}} placeholder="RR"/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                <div><div style={{fontSize:8,color:C.dim,marginBottom:3}}>{hFav} ODDS</div><input type="number" value={hFavOdds} onChange={e=>setHFavOdds(+e.target.value)} style={{...sel,fontSize:18,color:C.greenL,fontWeight:"bold",textAlign:"center"}}/><div style={{fontSize:8,color:C.dim,marginTop:2}}>₹100→₹{hFavOdds}</div></div>
                <div><div style={{fontSize:8,color:C.dim,marginBottom:3}}>{hUnd} ODDS</div><input type="number" value={hUndOdds} onChange={e=>setHUndOdds(+e.target.value)} style={{...sel,fontSize:18,color:C.gold,fontWeight:"bold",textAlign:"center"}}/><div style={{fontSize:8,color:C.dim,marginTop:2}}>₹{hUndOdds}→₹100</div></div>
              </div>
              <div style={{marginBottom:10}}><div style={{fontSize:8,color:C.dim,marginBottom:6,fontWeight:"bold"}}>YOU BET ON</div><div style={{display:"flex",gap:8}}><button onClick={()=>setHRole("fav")} style={{...tbtn(hRole==="fav",C.greenL),flex:1}}>{hFav||"FAV"}</button><button onClick={()=>setHRole("und")} style={{...tbtn(hRole==="und",C.gold),flex:1}}>{hUnd||"UND"}</button></div></div>
              <div><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>YOUR STAKE (₹)</div><input type="number" value={hStake} onChange={e=>setHStake(+e.target.value)} style={{...sel,fontSize:22,color:C.crimson,fontWeight:"bold",textAlign:"center"}}/></div>
              <div style={{marginTop:8,padding:10,background:C.bg,borderRadius:8,border:"1px solid "+C.border}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>POTENTIAL PROFIT → hedge stake (no extra cash)</div><div style={{fontSize:22,fontWeight:"bold",color:C.crimson}}>₹{Math.round(hRole==="fav"?hStake*hFavOdds/100:hStake/hUndOdds*100).toLocaleString("en-IN")}</div></div>
            </div>
            <div style={card()}>
              <div style={{fontSize:9,color:C.crimson,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>STEP 2 — SHIFTED ODDS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                <div><div style={{fontSize:8,color:C.dim,marginBottom:3}}>NEW {hFav} ODDS</div><input type="number" value={hNewFav} onChange={e=>setHNewFav(+e.target.value)} style={{...sel,fontSize:18,color:C.greenL,fontWeight:"bold",textAlign:"center"}}/></div>
                <div><div style={{fontSize:8,color:C.dim,marginBottom:3}}>NEW {hUnd} ODDS</div><input type="number" value={hNewUnd} onChange={e=>setHNewUnd(+e.target.value)} style={{...sel,fontSize:18,color:C.gold,fontWeight:"bold",textAlign:"center"}}/></div>
              </div>
              <div style={{marginBottom:12}}><div style={{fontSize:8,color:C.dim,marginBottom:6,fontWeight:"bold"}}>HEDGE ON</div><div style={{display:"flex",gap:8}}><button onClick={()=>setHOn("fav")} style={{...tbtn(hOn==="fav",C.greenL),flex:1}}>{hFav}</button><button onClick={()=>setHOn("und")} style={{...tbtn(hOn==="und",C.gold),flex:1}}>{hUnd}</button></div></div>
              <button onClick={calcHedge} style={{width:"100%",padding:"13px 0",borderRadius:8,fontSize:11,letterSpacing:2,background:"linear-gradient(135deg,"+C.crimson+","+C.goldL+")",border:"none",color:C.white,cursor:"pointer",fontFamily:"inherit",fontWeight:"bold"}}>📊 CALCULATE TRADE</button>
            </div>
            {hRes&&<div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}><div style={{...card({textAlign:"center",background:"#fffbeb",border:"1.5px solid "+C.goldL})}}><div style={{fontSize:8,color:C.dim,marginBottom:4,fontWeight:"bold"}}>IF {hRole==="fav"?hFav:hUnd} WINS</div><div style={{fontSize:26,fontWeight:"bold",color:C.gold}}>₹0</div><div style={{fontSize:9,color:C.muted}}>Break even</div></div><div style={{...card({textAlign:"center",background:hRes.ifHW>=0?"#f0fdf4":"#fff1f0",border:"1.5px solid "+(hRes.ifHW>=0?C.greenL:C.red)})}}><div style={{fontSize:8,color:C.dim,marginBottom:4,fontWeight:"bold"}}>IF {hOn==="fav"?hFav:hUnd} WINS</div><div style={{fontSize:26,fontWeight:"bold",color:hRes.ifHW>=0?C.greenL:C.red}}>{hRes.ifHW>=0?"+":""}₹{Math.round(Math.abs(hRes.ifHW)).toLocaleString("en-IN")}</div></div></div><div style={{...card({background:hRes.ifHW>500?"#f0fdf4":hRes.ifHW>0?"#fffbeb":"#fff1f0",border:"2px solid "+hRes.vc})}}><div style={{fontSize:13,fontWeight:"bold",color:hRes.vc,letterSpacing:2,marginBottom:6}}>{hRes.vt}</div><div style={{fontSize:10,color:C.muted,lineHeight:1.6}}>{hRes.ifHW>=0?"Hedge ₹"+Math.round(hRes.hStake).toLocaleString("en-IN")+". Guaranteed +₹"+Math.round(hRes.ifHW).toLocaleString("en-IN")+" if hedge wins.":"Min odds needed: "+Math.round(hRes.minOdds)+". Wait."}</div><div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid "+C.border,marginTop:8}}><span style={{fontSize:10,color:C.muted}}>Break-even odds</span><span style={{fontSize:10,color:hRes.ok?C.greenL:C.red,fontWeight:"bold"}}>{Math.round(hRes.minOdds)} {hRes.ok?"✓":"✗"}</span></div></div></div>}
          </div>
        )}

        {/* ══ INTEL TAB ════════════════════════════════════════ */}
        {tab==="intel"&&match&&(()=>{
          const intel=realIntelScore(match,toss,v2026);
          const h=getH2H(match.t1,match.t2);
          const ti=TOSS_INTEL[match.venue]||{bat:50,field:50,note:"No data"};
          return(
          <div>
            <div style={{...card({marginBottom:10,background:intel.verdict==="BET"?"#f0fdf4":intel.verdict==="WATCH"?"#fffbeb":"#fff1f0",border:"1.5px solid "+intel.col})}}>
              <div style={{fontSize:9,color:intel.col,letterSpacing:3,marginBottom:8,fontWeight:"bold"}}>MATCH INTELLIGENCE — {match.t1} vs {match.t2}</div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontSize:40,fontWeight:"bold",color:intel.col}}>{intel.verdict}</div><div style={{textAlign:"center"}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>SCORE</div><div style={{fontSize:32,fontWeight:"bold",color:intel.col}}>{intel.score}</div></div></div>
              {intel.details.map(({l,v:dv,max,note})=>(
                <div key={l} style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:10,color:C.sub}}>{l}</span><span style={{fontSize:10,color:intel.col,fontWeight:"bold"}}>{dv}/{max}</span></div><div style={{height:4,background:C.border,borderRadius:2}}><div style={{height:"100%",width:(dv/max*100)+"%",background:intel.col,borderRadius:2,transition:"width 0.5s"}}/></div><div style={{fontSize:8,color:C.dim,marginTop:2}}>{note}</div></div>
              ))}
            </div>
            {/* H2H */}
            <div style={{...card({marginBottom:10,padding:14})}}>
              <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>HEAD-TO-HEAD RECORD</div>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                <div style={{flex:1,padding:12,borderRadius:10,background:C.crimson+"08",border:"1px solid "+C.crimson+"30",textAlign:"center"}}><div style={{fontSize:8,color:C.dim,marginBottom:4}}>{match.t1}</div><div style={{fontSize:28,fontWeight:"bold",color:C.crimson}}>{h.t1wins}</div><div style={{fontSize:8,color:C.dim}}>wins</div></div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}><div style={{fontSize:8,color:C.dim}}>of</div><div style={{fontSize:14,fontWeight:"bold",color:C.text}}>{h.total}</div></div>
                <div style={{flex:1,padding:12,borderRadius:10,background:C.gold+"08",border:"1px solid "+C.goldL+"30",textAlign:"center"}}><div style={{fontSize:8,color:C.dim,marginBottom:4}}>{match.t2}</div><div style={{fontSize:28,fontWeight:"bold",color:C.gold}}>{h.total-h.t1wins}</div><div style={{fontSize:8,color:C.dim}}>wins</div></div>
              </div>
              <div style={{marginBottom:10}}><div style={{fontSize:8,color:C.dim,marginBottom:6,fontWeight:"bold"}}>LAST 5 MATCHES</div><div style={{display:"flex",gap:6}}>{h.last5.map((r,i)=><div key={i} style={{flex:1,height:28,borderRadius:6,background:r===1?C.crimson+"20":C.gold+"20",border:"1px solid "+(r===1?C.crimson+"40":C.goldL+"40"),display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:11,fontWeight:"bold",color:r===1?C.crimson:C.gold}}>{r===1?match.t1.slice(0,2):match.t2.slice(0,2)}</span></div>)}</div></div>
              {h.total>0&&<div style={{padding:8,background:C.bg,borderRadius:8,border:"1px solid "+C.border}}><div style={{fontSize:9,color:C.crimson,fontWeight:"bold"}}>{match.t1} wins {Math.round(h.t1wins/h.total*100)}% of all-time H2H</div><div style={{fontSize:8,color:C.muted,marginTop:2}}>Recent form (last 5): {h.last5.filter(r=>r===1).length}-{h.last5.filter(r=>r===0).length} to {match.t1}</div></div>}
            </div>
            {/* PP matchup */}
            <div style={{...card({padding:14})}}>
              <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:10,fontWeight:"bold"}}>TEAM PP MATCHUP</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{background:C.bg,borderRadius:8,padding:10}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>{bTeam||match.t1} PP SR</div><div style={{fontSize:22,fontWeight:"bold",color:C.crimson}}>{Math.round(getTeamPPSR(bTeam||match.t1))}</div><div style={{fontSize:8,color:C.dim,marginTop:2}}>Top 3 openers avg</div></div>
                <div style={{background:C.bg,borderRadius:8,padding:10}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>{blTeam||match.t2} PP Econ</div><div style={{fontSize:22,fontWeight:"bold",color:getTeamPPEconFull(blTeam||match.t2)<=7.5?C.red:getTeamPPEconFull(blTeam||match.t2)<=8.5?C.gold:C.greenL}}>{getTeamPPEconFull(blTeam||match.t2).toFixed(1)}</div><div style={{fontSize:8,color:C.dim,marginTop:2}}>Top 3 PP bowlers avg</div></div>
              </div>
              {v2026[match.venue]&&<div style={{marginTop:10,padding:10,background:C.bg,borderRadius:8}}><div style={{fontSize:8,color:C.gold,fontWeight:"bold",marginBottom:4}}>2026 SEASON DATA</div><div style={{display:"flex",gap:16}}><div><div style={{fontSize:8,color:C.dim}}>PP AVG</div><div style={{fontSize:16,fontWeight:"bold",color:C.crimson}}>{v2026[match.venue].avgPP}</div></div><div><div style={{fontSize:8,color:C.dim}}>TOTAL AVG</div><div style={{fontSize:16,fontWeight:"bold",color:C.crimson}}>{v2026[match.venue].avgTotal}</div></div><div><div style={{fontSize:8,color:C.dim}}>MATCHES</div><div style={{fontSize:16,fontWeight:"bold",color:C.crimson}}>{v2026[match.venue].matches}</div></div></div></div>}
            </div>
          </div>
          );
        })()}
        {tab==="intel"&&!match&&<div style={{...card({padding:30,textAlign:"center",color:C.dim})}}>← Open a match from Home to see full intelligence</div>}

        {/* ══ LEARN ════════════════════════════════════════════ */}
        {tab==="learn"&&(
          <div>
            <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>🧠 POST-MATCH LEARNING</div>
            <button onClick={runSync} disabled={syncing} style={{width:"100%",padding:"12px",borderRadius:10,fontSize:11,fontWeight:"bold",cursor:syncing?"not-allowed":"pointer",background:syncing?C.bg:"linear-gradient(135deg,#1e40af,#3b82f6)",border:syncing?"1px solid "+C.border:"none",color:syncing?C.dim:C.white,fontFamily:"inherit",letterSpacing:2,marginBottom:12}}>
              {syncing?"⏳ SYNCING FROM CRICKETDATA...":"🔄 SYNC LAST MATCH — AUTO UPDATE"}
            </button>
            {lastSync&&<div style={{...card({marginBottom:12,padding:12,background:lastSync.success?"#f0fdf4":"#fff1f0",border:"1px solid "+(lastSync.success?C.greenL:"#fecaca")})}}>
              <div style={{fontSize:9,color:lastSync.success?C.greenL:C.red,fontWeight:"bold",marginBottom:6}}>{lastSync.success?"✅ SYNC COMPLETE — "+lastSync.matchName:"❌ "+lastSync.msg}</div>
              {lastSync.success&&lastSync.updates?.playersUpdated?.length>0&&<div style={{marginBottom:4}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>PLAYERS UPDATED:</div>{lastSync.updates.playersUpdated.map(p=><div key={p.name} style={{fontSize:9,color:C.text}}>{p.trend} {p.name}: {p.runs}runs SR{p.sr} → form×{p.formMult}</div>)}</div>}
              {lastSync.success&&lastSync.updates?.bowlersUpdated?.length>0&&<div style={{marginBottom:4}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>BOWLERS UPDATED:</div>{lastSync.updates.bowlersUpdated.map(b=><div key={b.name} style={{fontSize:9,color:C.text}}>{b.trend} {b.name}: econ {b.econ} form×{b.formMult}</div>)}</div>}
              {lastSync.success&&lastSync.updates?.venueUpdated&&<div style={{fontSize:9,color:C.sub,marginTop:4}}>📍 {lastSync.updates.venueUpdated.venue?.split(",")[0]}: PP {lastSync.updates.venueUpdated.newAvgPP} Total {lastSync.updates.venueUpdated.newAvgTotal} ({lastSync.updates.venueUpdated.matches}M)</div>}
              {lastSync.success&&lastSync.updates?.biasDetected?.map((b,i)=><div key={i} style={{fontSize:9,color:C.gold,fontWeight:"bold",marginTop:4}}>⚡ {b.msg}</div>)}
            </div>}
            <div style={{...card({marginBottom:12,padding:14})}}>
              <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:10,fontWeight:"bold"}}>ENGINE ACCURACY — REAL DATA</div>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                <div style={{fontSize:36,fontWeight:"bold",color:engAcc>=72?C.greenL:engAcc>=65?C.gold:C.crimson}}>{engAcc}%</div>
                <div style={{flex:1}}>
                  {[["PP Score",accuracy.pp],["Match Winner",accuracy.winner],["Total",accuracy.total]].map(([l,v])=>v!==null&&<div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:9,color:C.muted}}>{l}</span><span style={{fontSize:9,color:v>=65?C.greenL:v>=55?C.gold:C.red,fontWeight:"bold"}}>{v}%</span></div>)}
                  {accLog.length===0&&<div style={{fontSize:9,color:C.dim}}>Start logging to track real accuracy</div>}
                </div>
              </div>
              {accuracy.patterns?.map((p,i)=><div key={i} style={{fontSize:9,color:p.type==="good"?C.greenL:C.gold,fontWeight:"bold",marginTop:4}}>→ {p.msg}</div>)}
            </div>
            <div style={card()}>
              <div style={{fontSize:9,color:C.crimson,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>LOG MATCH RESULT</div>
              <div style={{marginBottom:8}}><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>VENUE</div><select value={lVenue} onChange={e=>setLVenue(e.target.value)} style={sel}>{Object.keys(VENUES_BASE).map(v=><option key={v}>{v}</option>)}</select></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                {[["Actual PP",lPP,setLPP],["Actual Total",lTotal,setLTotal],["My PP Pred",lPredPP,setLPredPP]].map(([l,v,fn])=>(
                  <div key={l}><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>{l}</div><input type="number" value={v} onChange={e=>fn(e.target.value)} placeholder="—" style={{...sel,fontSize:16,fontWeight:"bold",textAlign:"center"}}/></div>
                ))}
              </div>
              <div style={{marginBottom:12}}><div style={{fontSize:8,color:C.dim,marginBottom:4,fontWeight:"bold"}}>WINNER PREDICTION</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><div><div style={{fontSize:7,color:C.dim,marginBottom:3}}>ACTUAL</div><div style={{display:"flex",gap:4}}>{["Batting first","Chasing","No result"].map(w=><button key={w} onClick={()=>setLActualWinner(w)} style={{...tbtn(lActualWinner===w,C.crimson),flex:1,fontSize:7,padding:"6px 2px"}}>{w.split(" ")[0]}</button>)}</div></div><div><div style={{fontSize:7,color:C.dim,marginBottom:3}}>MY PRED</div><div style={{display:"flex",gap:4}}>{["Batting first","Chasing","No result"].map(w=><button key={w} onClick={()=>setLPredWinner(w)} style={{...tbtn(lPredWinner===w,C.gold),flex:1,fontSize:7,padding:"6px 2px"}}>{w.split(" ")[0]}</button>)}</div></div></div></div>
              <button onClick={submitLearn} disabled={!lPP||!lTotal} style={{width:"100%",padding:"13px 0",borderRadius:8,fontSize:11,letterSpacing:2,background:!lPP||!lTotal?"transparent":"linear-gradient(135deg,"+C.crimson+","+C.goldL+")",border:!lPP||!lTotal?"1px solid "+C.border:"none",color:!lPP||!lTotal?C.dim:C.white,cursor:!lPP||!lTotal?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:"bold"}}>🧠 SUBMIT & TRAIN ENGINE</button>
              {Object.keys(v2026).length>0&&<div style={{marginTop:12}}><div style={{fontSize:8,color:C.dim,marginBottom:6,fontWeight:"bold"}}>2026 CALIBRATED VENUES</div>{Object.entries(v2026).map(([venue,data])=><div key={venue} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid "+C.border}}><span style={{fontSize:9,color:C.sub}}>{venue.split(",")[0]}</span><span style={{fontSize:9,color:C.crimson,fontWeight:"bold"}}>PP:{data.avgPP} Tot:{data.avgTotal} ({data.matches}M)</span></div>)}</div>}
            </div>
          </div>
        )}

        {/* ══ CHAT ═════════════════════════════════════════════ */}
        {tab==="chat"&&(
          <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 200px)"}}>
            <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:8,fontWeight:"bold"}}>⚔ SHAKTI LIVE ANALYST</div>
            <div style={{flex:1,overflowY:"auto",marginBottom:10}}>
              {chatMsgs.map((m,i)=>(
                <div key={i} style={{marginBottom:10,display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
                  {m.role==="assistant"&&<div style={{fontSize:7,color:C.crimson,letterSpacing:2,marginBottom:2,fontWeight:"bold"}}>⚔ SHAKTI</div>}
                  <div style={{maxWidth:"88%",padding:"10px 12px",borderRadius:m.role==="user"?"12px 12px 2px 12px":"2px 12px 12px 12px",background:m.role==="user"?C.crimson+"10":C.card,border:"1px solid "+(m.role==="user"?C.crimson+"30":C.border),fontSize:11,lineHeight:1.75,color:C.text,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{m.content}</div>
                </div>
              ))}
              {chatBusy&&<div style={{display:"flex",gap:5,alignItems:"center",padding:"4px 0"}}>{[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:C.crimson,animation:"blink 1.2s infinite",animationDelay:i*0.2+"s",opacity:0.7}}/>)}<span style={{fontSize:9,color:C.dim,marginLeft:4}}>Thinking...</span></div>}
              <div ref={chatEnd}/>
            </div>
            <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:8,scrollbarWidth:"none"}}>
              {["BET or SKIP?","Odds gap analysis","Calculate EV","Hedge this bet","Win probability?","Season projection"].map(q=>(
                <button key={q} onClick={()=>setChatIn(q)} style={{flexShrink:0,padding:"5px 10px",borderRadius:16,fontSize:9,background:"transparent",border:"1px solid "+C.border,color:C.muted,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{q}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"flex-end",borderTop:"1px solid "+C.border,paddingTop:8}}>
              <textarea value={chatIn} onChange={e=>setChatIn(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}} placeholder="Ask SHAKTI anything..." rows={2} style={{flex:1,background:C.bg,border:"1px solid "+C.border,borderRadius:10,color:C.text,padding:"8px 10px",fontSize:11,fontFamily:"inherit",lineHeight:1.5}}/>
              <button onClick={sendChat} disabled={chatBusy||!chatIn.trim()} style={{padding:"10px 14px",borderRadius:8,fontSize:14,background:chatBusy||!chatIn.trim()?C.bg:C.crimson+"18",border:"1px solid "+(chatBusy||!chatIn.trim()?C.border:C.crimson),color:chatBusy||!chatIn.trim()?C.dim:C.crimson,cursor:chatBusy||!chatIn.trim()?"not-allowed":"pointer",flexShrink:0}}>⚔</button>
            </div>
          </div>
        )}

        {/* ══ LOG ══════════════════════════════════════════════ */}
        {tab==="log"&&(
          <div>
            <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>📋 BET LOG</div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              {[{l:"WINS",v:wins,c:C.greenL},{l:"LOSSES",v:losses,c:C.red},{l:"NET P&L",v:(pl>=0?"+":"")+"₹"+Math.abs(pl).toLocaleString("en-IN"),c:pl>=0?C.greenL:C.red}].map(({l,v,c})=>(
                <div key={l} style={{...card({flex:1,padding:"10px 8px",textAlign:"center"})}}><div style={{fontSize:8,color:C.dim,marginBottom:4,fontWeight:"bold"}}>{l}</div><div style={{fontSize:14,fontWeight:"bold",color:c}}>{v}</div></div>
              ))}
            </div>
            {matchPnL.length>0&&<div style={{...card({marginBottom:12,padding:14})}}><div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:8,fontWeight:"bold"}}>SEASON P&L BY MATCH</div><ResponsiveContainer width="100%" height={70}><AreaChart data={matchPnL}><XAxis hide/><YAxis hide/><Tooltip contentStyle={{background:C.panel,border:"1px solid "+C.border,borderRadius:6,fontSize:10}} formatter={v=>[(v>=0?"+":"")+"₹"+Math.abs(v).toLocaleString("en-IN"),"P&L"]}/><ReferenceLine y={0} stroke={C.border}/><Area type="monotone" dataKey="p" stroke={C.gold} fill={C.gold+"20"} strokeWidth={1.5} dot={false}/></AreaChart></ResponsiveContainer></div>}
            {bets.length===0?<div style={{textAlign:"center",padding:"50px 0",color:C.dim}}><div style={{fontSize:32,marginBottom:10}}>📋</div><div>No bets yet</div></div>:(
              [...bets].reverse().map(b=>{
                const bc=b.out==="WIN"?C.greenL:b.out==="LOSS"?C.red:C.gold;
                const bg=b.out==="WIN"?"#f0fdf4":b.out==="LOSS"?"#fff1f0":C.card;
                const bdr=b.out==="WIN"?"#86efac":b.out==="LOSS"?"#fecaca":C.border;
                return(
                  <div key={b.id} style={{background:bg,border:"1px solid "+bdr,borderLeft:"4px solid "+bc,borderRadius:12,padding:"11px 13px",marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:b.out==="PENDING"?10:0}}>
                      <div><div style={{fontSize:12,color:C.text,marginBottom:2,fontWeight:"bold"}}>{b.match}</div><div style={{fontSize:9,color:C.muted}}>{b.market} · S{b.stage} · T{b.tier}</div></div>
                      <div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:"bold",color:bc}}>{b.out==="WIN"?"+":b.out==="LOSS"?"-":""}₹{b.stake.toLocaleString("en-IN")}</div><div style={{fontSize:9,padding:"2px 8px",borderRadius:10,display:"inline-block",marginTop:2,background:bg,color:bc,fontWeight:"bold",border:"1px solid "+bdr}}>{b.out}</div></div>
                    </div>
                    {b.out==="PENDING"&&<div style={{display:"flex",gap:8}}><button onClick={()=>resolve(b.id,"WIN")} style={{flex:1,padding:9,borderRadius:8,fontSize:11,cursor:"pointer",background:"#f0fdf4",border:"1.5px solid "+C.greenL,color:C.green,fontFamily:"inherit",fontWeight:"bold"}}>✓ WIN</button><button onClick={()=>resolve(b.id,"LOSS")} style={{flex:1,padding:9,borderRadius:8,fontSize:11,cursor:"pointer",background:"#fff1f0",border:"1.5px solid #fca5a5",color:C.red,fontFamily:"inherit",fontWeight:"bold"}}>✗ LOSS</button></div>}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:C.panel,borderTop:"1px solid "+C.border,display:"flex",zIndex:50,boxShadow:"0 -2px 12px rgba(155,0,32,0.08)"}}>
        {TABS.map(([id,icon])=>(
          <button key={id} onClick={()=>{if(id!=="match"){setTab(id);}else if(match){setTab("match");}}} style={{flex:1,padding:"12px 0",background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:14,color:tab===id?C.crimson:C.dim,borderTop:"2px solid "+(tab===id?C.crimson:"transparent"),transition:"all 0.15s"}}>
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
