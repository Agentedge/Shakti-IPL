import { useState, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { VENUES_BASE, PLAYERS_BASE, BOWLERS_BASE, SQUADS, MATCHES } from "./shakti_db.js";

const C = {
  bg:"#fdf6ee", panel:"#fff8f2", card:"#ffffff", border:"#e8d5c0",
  borderS:"#c9a87c", crimson:"#9b0020", crimsonL:"#c0002a",
  gold:"#b8860b", goldL:"#d4a017", goldXL:"#f0b429",
  green:"#166534", greenL:"#16a34a", red:"#991b1b",
  blue:"#1e40af", dim:"#a08060", muted:"#78604a",
  text:"#2d1a0e", sub:"#6b4c30", white:"#ffffff",
};

const TEAM_COL = {
  CSK:"#c8941a",MI:"#004ba0",RCB:"#9b0020",KKR:"#5b21b6",
  SRH:"#c2410c",RR:"#1e3a8a",DC:"#1e40af",PBKS:"#9b1a1a",
  GT:"#1e3a5f",LSG:"#4d7c0f",
};

const INIT_BR = 10000;
const TARGET   = 300000;
const MILESTONES = [25000,50000,100000,150000,200000,250000,300000];

const BETS = [
  {id:"pp",     label:"Powerplay",   sub:"Runs 0-6",     icon:"⚡",tier:"A",acc:70,color:C.crimson},
  {id:"ov10",   label:"10 Overs",    sub:"Total at 10",  icon:"📍",tier:"B",acc:67,color:C.crimson},
  {id:"ov12",   label:"12 Overs",    sub:"Total at 12",  icon:"📍",tier:"B",acc:65,color:C.gold},
  {id:"ov15",   label:"15 Overs",    sub:"Total at 15",  icon:"📌",tier:"B",acc:63,color:C.gold},
  {id:"total",  label:"1st Innings", sub:"Full total",   icon:"🏏",tier:"B",acc:61,color:C.gold},
  {id:"winner", label:"Match Winner",sub:"Win prob",     icon:"🏆",tier:"A",acc:64,color:C.green},
  {id:"batsman",label:"Batsman Runs",sub:"Player total", icon:"👤",tier:"C",acc:52,color:C.muted},
  {id:"wicket", label:"Next Wicket", sub:"Until wicket", icon:"🎯",tier:"C",acc:54,color:C.muted},
  {id:"over",   label:"Over by Over",sub:"Next over",    icon:"🎲",tier:"C",acc:57,color:C.muted},
];

// ── Bankroll ──────────────────────────────────────────────────
function rawStake(br,stage,base,ks){
  if(stage===3) return Math.max(0,br-base);
  return Math.round(br*(ks?0.10:0.15));
}
function tStake(raw,tier){
  return Math.round(raw*(tier==="A"?1:tier==="B"?0.7:0.4));
}
function tierCol(t){ return t==="A"?C.crimson:t==="B"?C.gold:C.muted; }

// ── Learning engine ───────────────────────────────────────────
function calibratedVenue(venueName, v2025){
  const base = VENUES_BASE[venueName]||VENUES_BASE["Narendra Modi, Ahmedabad"];
  const cal  = v2025[venueName];
  if(!cal||cal.matches===0) return base;
  const w = Math.min(0.7, cal.matches*0.14);
  return {...base,
    pp:    Math.round(base.pp   *(1-w)+cal.avgPP   *w),
    total: Math.round(base.total*(1-w)+cal.avgTotal*w),
  };
}
function getEngineAcc(logged){ return Math.min(77,68+Math.floor(logged/5)); }

// ── Prediction ────────────────────────────────────────────────
function predict(cfg){
  const {venueName,striker,nonStriker,bowler,pitchType,weather,toss,lS,lW,lO,v2025,p2025,b2025}=cfg;
  const v   = calibratedVenue(venueName,v2025||{});
  const p1  = {...(PLAYERS_BASE[striker]||PLAYERS_BASE["Other Batsman"])};
  const p2  = {...(PLAYERS_BASE[nonStriker]||PLAYERS_BASE["Other Batsman"])};
  const bl  = BOWLERS_BASE[bowler]||BOWLERS_BASE["Average Bowler"];
  const pForm1 = p2025?.[striker]?.form||1.0;
  const pForm2 = p2025?.[nonStriker]?.form||1.0;
  const bForm  = b2025?.[bowler]?.form||1.0;
  p1.ppSR = Math.round(p1.ppSR*pForm1);
  p2.ppSR = Math.round(p2.ppSR*pForm2);
  const blEcon = bl.ppEcon*bForm;

  const avgPPAgg    = (p1.ppSR+p2.ppSR)/2/150;
  const avgMidAgg   = (p1.midSR+p2.midSR)/2/135;
  const avgDeathAgg = (p1.deathSR+p2.deathSR)/2/165;
  const pf = pitchType==="batting"?1.12:pitchType==="seaming"?0.88:pitchType==="turning"?0.85:pitchType==="slow"?0.82:1.0;
  const wf = weather==="dew"?0.93:weather==="overcast"?0.89:weather==="humid"?0.95:1.0;
  const tf = toss==="chasing"?1.06:0.96;
  const br = Math.max(0.5,Math.min(1.0,blEcon/10));
  const wp = Math.pow(0.91,lW||0);
  const vs = bl.type==="pace"?v.pacePen:v.spinPen;

  let pp;
  if(lS>0&&lO>0&&lO<6){
    pp=Math.round(lS+(lS/lO)*(6-lO)*(lO<3?1.02:0.98)*wp*pf);
  } else if(lO>=6){
    pp=lS>0?Math.min(lS,80):v.pp;
  } else {
    pp=Math.round(v.pp*0.25+v.pp*avgPPAgg*0.25+v.pp*(1.4-br)*0.20+v.pp*tf*0.10+v.pp*pf*0.10+v.pp*wf*0.05+v.pp*vs*0.05);
  }
  const sc=pp/v.pp;
  const mf=avgMidAgg*0.85*pf*wp;
  const df=avgDeathAgg*pf*wf;
  const db=(lW||0)<3?1.05:(lW||0)<6?1.0:0.92;
  const at10=lO>=10&&lS>0?lS:lO>6&&lS>0?Math.round(lS+(lS/lO)*(10-lO)*mf):Math.round(v.ov10*sc*mf);
  const at12=lO>=12&&lS>0?lS:Math.round(v.ov12*sc*mf*1.02);
  const at15=lO>=15&&lS>0?lS:Math.round(v.ov15*sc*mf*1.05);
  const tot =lO>15&&lS>0?Math.round(lS+(lS/lO)*df*db*(20-lO)*6):Math.round(v.total*sc*df*db*wf);
  const rpo2=lO>0?lS/lO:pp/6;
  const opf =lO<6?avgPPAgg:lO<15?avgMidAgg:avgDeathAgg;
  const nxt =Math.max(3,Math.round(rpo2*opf*pf*wp));
  const pm=lO>3?3:5,om=lO>8?5:9,om2=lO>10?6:11,om3=lO>13?7:13,tm=lO>15?10:20;
  return {
    pp,ppLo:pp-pm,ppHi:pp+pm,
    at10,at10Lo:at10-om,at10Hi:at10+om,
    at12,at12Lo:at12-om2,at12Hi:at12+om2,
    at15,at15Lo:at15-om3,at15Hi:at15+om3,
    tot,totLo:tot-tm,totHi:tot+tm,
    nxt,nxtLo:nxt-2,nxtHi:nxt+3,
    chaseWin:v.chase,
    isLive:lO>0,
    lb:lO>0?Math.min(12,Math.round(lO*1.5)):0,
  };
}

function getBV(id,pred){
  if(!pred) return {val:0,lo:0,hi:0};
  if(id==="pp")    return {val:pred.pp,   lo:pred.ppLo,  hi:pred.ppHi};
  if(id==="ov10")  return {val:pred.at10, lo:pred.at10Lo,hi:pred.at10Hi};
  if(id==="ov12")  return {val:pred.at12, lo:pred.at12Lo,hi:pred.at12Hi};
  if(id==="ov15")  return {val:pred.at15, lo:pred.at15Lo,hi:pred.at15Hi};
  if(id==="total") return {val:pred.tot,  lo:pred.totLo, hi:pred.totHi};
  if(id==="over")  return {val:pred.nxt,  lo:pred.nxtLo, hi:pred.nxtHi};
  return {val:pred.pp,lo:pred.ppLo,hi:pred.ppHi};
}

function verdict(val,line){
  if(!line||line==="") return null;
  const l=parseFloat(line); if(isNaN(l)||l<=0) return null;
  const e=val-l, ep=Math.round(Math.abs(e)/l*100);
  if(Math.abs(e)>=5) return {text:e>0?"BET OVER":"BET UNDER",color:C.greenL,bg:"#f0fdf4",bdr:"#86efac",conf:Math.min(88,62+ep*2),e,strong:true};
  if(Math.abs(e)>=3) return {text:e>0?"LEAN OVER":"LEAN UNDER",color:C.gold,bg:"#fffbeb",bdr:"#fcd34d",conf:50+ep*2,e,strong:false};
  return {text:"SKIP",color:C.dim,bg:C.panel,bdr:C.border,conf:30,e,strong:false};
}

// ── Live fetch ────────────────────────────────────────────────
async function fetchLive(t1,t2){
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:500,tools:[{type:"web_search_20250305",name:"web_search"}],
        system:'Return ONLY valid JSON: {"isLive":true,"battingTeam":"X","score":45,"wickets":1,"overs":3.4,"runRate":9.8,"lastOver":8,"recentBalls":"1 4 0 6 W 2","striker":"Name","nonStriker":"Name","bowler":"Name","target":null,"status":"text"}',
        messages:[{role:"user",content:"Live IPL score "+t1+" vs "+t2+" now. JSON only."}]})});
    const d=await r.json();
    return JSON.parse(d.content.filter(b=>b.type==="text").map(b=>b.text).join("").replace(/```json|```/g,"").trim());
  }catch(e){return null;}
}

async function claudeAsk(msg,ctx){
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,tools:[{type:"web_search_20250305",name:"web_search"}],
        system:"You are SHAKTI — elite IPL betting analyst. State: "+JSON.stringify(ctx)+". Platform: Favourite=1st number stake₹100 profit=odds. Underdog=2nd stake=odds profit₹100. Hedge=potential profit as stake no extra cash. Be direct, give numbers, BET/SKIP verdicts.",
        messages:[{role:"user",content:msg}]})});
    const d=await r.json();
    return d.content.filter(b=>b.type==="text").map(b=>b.text).join("").trim();
  }catch(e){return "Connection error.";}
}

// ── Intel score ───────────────────────────────────────────────
function intelScore(m,v2025){
  const vm=v2025[m.venue]?.matches||0;
  const vc=Math.min(40,20+vm*4);
  const tot=vc+20+20+(m.time.includes("7:30")?15:20);
  const verdict2=tot>=70?"BET":tot>=50?"WATCH":"SKIP";
  const col=verdict2==="BET"?C.greenL:verdict2==="WATCH"?C.gold:C.red;
  return {score:tot,verdict:verdict2,col,vc};
}

// ── Tilt detect ───────────────────────────────────────────────
function tiltSignals(bets,cLoss){
  const s=[];
  if(cLoss>=2) s.push("2 consecutive losses");
  const rec=bets.slice(-3);
  if(rec.length===3&&(rec[2].ts-rec[0].ts)<30*60*1000) s.push("Betting faster than usual");
  if(cLoss>=1&&rec.some(b=>b.tier==="C")) s.push("Tier C after a loss");
  return s;
}

// ── Spread advice ─────────────────────────────────────────────
function spreadAdvice(bets,match){
  if(!match) return {text:"Open a match to see spread advice.",warn:false,count:0};
  const mb=bets.filter(b=>b.match===match.t1+" vs "+match.t2);
  const phases={pp:"innings",ov10:"innings",ov12:"innings",ov15:"innings",total:"innings",winner:"full",batsman:"player",wicket:"player",over:"micro"};
  const up=mb.map(b=>phases[b.marketId]||"other");
  const ic=up.filter(p=>p==="innings").length;
  if(ic>=2) return {text:"⚠ Too many innings bets — correlated. Add Match Winner or Over-by-Over.",warn:true,count:mb.length};
  if(mb.length>=1&&!up.includes("full")) return {text:"Consider Match Winner — least correlated with innings markets.",warn:false,count:mb.length};
  return {text:"Good spread — low correlation.",warn:false,count:mb.length};
}

// ── Styles ────────────────────────────────────────────────────
const card=(x={})=>({background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:16,...x});
const tbtn=(on,col=C.crimson)=>({padding:"8px 10px",borderRadius:8,fontSize:10,cursor:"pointer",fontFamily:"inherit",border:"1.5px solid "+(on?col:C.border),background:on?col+"18":"transparent",color:on?col:C.dim,fontWeight:on?"bold":"normal"});
const sel={width:"100%",background:C.bg,border:"1px solid "+C.border,color:C.text,borderRadius:8,padding:"8px 10px",fontFamily:"inherit",fontSize:11,appearance:"none"};

// ── Match Card ────────────────────────────────────────────────
function MCard({m,onTap,intel,isLive}){
  const c1=TEAM_COL[m.t1]||C.crimson, c2=TEAM_COL[m.t2]||C.gold;
  return (
    <div onClick={()=>onTap(m)} style={{...card({padding:0,marginBottom:10,cursor:"pointer",overflow:"hidden",border:"1px solid "+(isLive?C.goldL:C.border)})}}>
      <div style={{height:4,background:"linear-gradient(90deg,"+c1+","+c2+")"}}/>
      <div style={{padding:"12px 14px"}}>
        {isLive&&<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}><div style={{width:6,height:6,borderRadius:"50%",background:C.crimsonL}}/><span style={{fontSize:9,color:C.crimsonL,letterSpacing:2,fontWeight:"bold"}}>LIVE</span></div>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20,fontWeight:"bold",color:c1}}>{m.t1}</span>
            <span style={{fontSize:9,color:C.dim}}>vs</span>
            <span style={{fontSize:20,fontWeight:"bold",color:c2}}>{m.t2}</span>
          </div>
          {intel&&<div style={{padding:"3px 10px",borderRadius:20,background:intel.col+"18",border:"1px solid "+intel.col+"40",fontSize:10,fontWeight:"bold",color:intel.col}}>{intel.verdict}</div>}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
          <span style={{fontSize:9,color:C.dim}}>{"📍 "+m.venue.split(",")[0]}</span>
          <span style={{fontSize:9,color:C.sub}}>{m.date+" · "+m.time}</span>
        </div>
        {intel&&<div style={{marginTop:6,height:3,background:C.border,borderRadius:2}}><div style={{height:"100%",width:intel.score+"%",background:"linear-gradient(90deg,"+C.crimson+","+intel.col+")",borderRadius:2}}/></div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
export default function Shakti(){
  const [tab,setTab]=useState("home");
  const [match,setMatch]=useState(null);
  const [sub,setSub]=useState("predict");

  // Bankroll
  const [br,setBr]=useState(INIT_BR);
  const [base,setBase]=useState(INIT_BR);
  const [stage,setStage]=useState(1);
  const [cLoss,setCLoss]=useState(0);
  const [dLoss,setDLoss]=useState(0);
  const [bets,setBets]=useState([]);
  const [skipNext,setSkipNext]=useState(false);

  // Learning
  const [v2025,setV2025]=useState({});
  const [p2025,setP2025]=useState({});
  const [b2025,setB2025]=useState({});
  const [accData,setAccData]=useState({pp:0,count:0});
  const [logged,setLogged]=useState(0);

  // Match conditions
  const [striker,setStriker]=useState("Other Batsman");
  const [nonStrike,setNonStrike]=useState("Other Batsman");
  const [bowler,setBowler]=useState("Average Bowler");
  const [pitch,setPitch]=useState("balanced");
  const [wx,setWx]=useState("clear");
  const [toss,setToss]=useState("batting");
  const [lines,setLines]=useState({});
  const [lineHist,setLineHist]=useState({});
  const [lineAlerts,setLineAlerts]=useState([]);
  const [liveData,setLiveData]=useState(null);
  const [fetching,setFetching]=useState(false);
  const [lastUpd,setLastUpd]=useState(null);
  const [showWkt,setShowWkt]=useState(false);
  const [prevWkts,setPrevWkts]=useState(0);

  // Hedge
  const [hFav,setHFav]=useState("CSK"); const [hUnd,setHUnd]=useState("RR");
  const [hFavOdds,setHFavOdds]=useState(60); const [hUndOdds,setHUndOdds]=useState(70);
  const [hStake,setHStake]=useState(1000); const [hRole,setHRole]=useState("fav");
  const [hNewFav,setHNewFav]=useState(40); const [hNewUnd,setHNewUnd]=useState(60);
  const [hOn,setHOn]=useState("und"); const [hRes,setHRes]=useState(null);

  // Learn form
  const [lVenue,setLVenue]=useState(Object.keys(VENUES_BASE)[0]);
  const [lPP,setLPP]=useState(""); const [lTotal,setLTotal]=useState("");
  const [lPredPP,setLPredPP]=useState(""); const [lWinner,setLWinner]=useState("");

  // Chat
  const [chatMsgs,setChatMsgs]=useState([{role:"assistant",content:"⚔ SHAKTI ready. Ask me anything about the match, odds, or your next bet.",ts:Date.now()}]);
  const [chatIn,setChatIn]=useState(""); const [chatBusy,setChatBusy]=useState(false);
  const chatEnd=useRef(null); const timerRef=useRef(null);

  // Derived
  const ks=br<4000, tilt=cLoss>=2, stop=dLoss>=2;
  const raw=rawStake(br,stage,base,ks);
  const pl=br-INIT_BR;
  const wins=bets.filter(b=>b.out==="WIN").length;
  const losses=bets.filter(b=>b.out==="LOSS").length;
  const wr=bets.length>0?Math.round(wins/bets.length*100):null;
  const engAcc=getEngineAcc(logged);
  const tSigs=tiltSignals(bets,cLoss);
  const lS=liveData?.isLive?liveData.score:0;
  const lW=liveData?.isLive?liveData.wickets:0;
  const lO=liveData?.isLive?liveData.overs:0;
  const pred=match?predict({venueName:match.venue,striker,nonStriker:nonStrike,bowler,pitchType:pitch,weather:wx,toss,lS,lW,lO,v2025,p2025,b2025}):null;
  const nextMS=MILESTONES.find(m=>m>br)||TARGET;
  const sa=spreadAdvice(bets,match);

  const chartData=(()=>{let r=INIT_BR;const pts=[{n:0,v:INIT_BR}];bets.filter(b=>b.out!=="PENDING").forEach((b,i)=>{r+=b.out==="WIN"?b.stake:-b.stake;pts.push({n:i+1,v:r});});return pts;})();
  const matchPnL=(()=>{const map={};bets.forEach(b=>{if(!map[b.match])map[b.match]={m:b.match,p:0};if(b.out==="WIN")map[b.match].p+=b.stake;if(b.out==="LOSS")map[b.match].p-=b.stake;});return Object.values(map);})();

  const doFetch=useCallback(async()=>{
    if(!match)return; setFetching(true);
    const d=await fetchLive(match.t1,match.t2);
    if(d){setLiveData(d);const now=new Date();setLastUpd(now.getHours()+":"+String(now.getMinutes()).padStart(2,"0"));
      if(d.isLive){
        if(PLAYERS_BASE[d.striker])setStriker(d.striker);
        if(PLAYERS_BASE[d.nonStriker])setNonStrike(d.nonStriker);
        if(BOWLERS_BASE[d.bowler])setBowler(d.bowler);
        if((d.wickets||0)>prevWkts)setShowWkt(true);
        setPrevWkts(d.wickets||0);
      }}
    setFetching(false);
  },[match,prevWkts]);

  useEffect(()=>{
    if(tab==="match"&&match){setLiveData(null);setPrevWkts(0);doFetch();timerRef.current=setInterval(doFetch,60000);}
    return()=>clearInterval(timerRef.current);
  },[tab,match]);

  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:"smooth"});},[chatMsgs]);

  function updateLine(id,val,ov){
    const h=lineHist[id]||[];
    const u=[...h,{ov:ov||lO,line:parseFloat(val),ts:Date.now()}];
    setLineHist(p=>({...p,[id]:u}));
    setLines(p=>({...p,[id]:val}));
    if(u.length>=2){
      const prev2=u[u.length-2],curr2=u[u.length-1];
      const {val:pv}=getBV(id,pred)||{val:0};
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
    if(!lPP||!lTotal) return;
    const pp2=parseFloat(lPP),tot2=parseFloat(lTotal);
    setV2025(prev=>{const e=prev[lVenue]||{matches:0,avgPP:VENUES_BASE[lVenue]?.pp||50,avgTotal:VENUES_BASE[lVenue]?.total||170};const n=e.matches+1;return {...prev,[lVenue]:{matches:n,avgPP:Math.round((e.avgPP*(n-1)+pp2)/n),avgTotal:Math.round((e.avgTotal*(n-1)+tot2)/n)}};});
    if(lPredPP){const hit=Math.abs(parseFloat(lPredPP)-pp2)<=5?1:0;setAccData(p=>({pp:Math.round((p.pp*p.count+hit*100)/(p.count+1)),count:p.count+1}));}
    setLogged(p=>p+1);
    setLPP("");setLTotal("");setLPredPP("");setLWinner("");
  }

  function placeBet(bt,stake){
    if(tilt||stop||skipNext)return;
    setBets(p=>[...p,{id:Date.now(),match:match.t1+" vs "+match.t2,marketId:bt.id,market:bt.label,tier:bt.tier,stake,stage,out:"PENDING",ts:Date.now()}]);
  }

  function resolve(id,out){
    const b=bets.find(b=>b.id===id);if(!b)return;
    const nb=out==="WIN"?br+b.stake:br-b.stake;
    setBr(nb);
    if(out==="WIN"){setCLoss(0);setSkipNext(false);if(stage===3){setBase(nb);setStage(1);setSkipNext(true);}else setStage(s=>s+1);}
    else{setCLoss(p=>p+1);setDLoss(p=>p+1);if(stage===3){setBr(base);setSkipNext(true);}else if(stage>1)setStage(1);}
    setBets(p=>p.map(b=>b.id===id?{...b,out}:b));
  }

  async function sendChat(){
    if(!chatIn.trim()||chatBusy)return;
    const msg=chatIn.trim();
    setChatMsgs(p=>[...p,{role:"user",content:msg,ts:Date.now()}]);
    setChatIn("");setChatBusy(true);
    const ctx={br,stage,base,wr,cLoss,match:match?match.t1+" vs "+match.t2:"none",lS,lO,lW,engAcc};
    const reply=await claudeAsk(msg,ctx);
    setChatMsgs(p=>[...p,{role:"assistant",content:reply,ts:Date.now()}]);
    setChatBusy(false);
  }

  function openMatch(m){setMatch(m);setLines({});setLineHist({});setLineAlerts([]);setStriker("Other Batsman");setNonStrike("Other Batsman");setBowler("Average Bowler");setSub("predict");setTab("match");}

  const squad=match?(SQUADS[match.t1]||[]):[];
  const TABS=[["home","🏠"],["match","📊"],["hedge","💹"],["learn","🧠"],["chat","⚔"],["log","📋"]];

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'DM Mono',monospace",maxWidth:480,margin:"0 auto"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        *{box-sizing:border-box;} input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
        input,textarea{outline:none;} select{appearance:none;}
        ::-webkit-scrollbar{width:3px;} ::-webkit-scrollbar-thumb{background:${C.border};}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes blink{0%,100%{opacity:.3}50%{opacity:1}}
        textarea{resize:none;}
      `}</style>

      {/* Wicket popup */}
      {showWkt&&match&&(
        <div style={{position:"fixed",inset:0,background:"rgba(45,26,14,0.65)",zIndex:200,display:"flex",alignItems:"flex-end"}}>
          <div style={{width:"100%",maxWidth:480,margin:"0 auto",background:C.card,borderTop:"3px solid "+C.crimson,borderRadius:"18px 18px 0 0",padding:"20px 16px 36px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
              <div><div style={{fontSize:9,color:C.crimson,letterSpacing:3,fontWeight:"bold",marginBottom:3}}>WICKET FELL</div><div style={{fontSize:15,color:C.text,fontWeight:"bold"}}>Who came in?</div></div>
              <button onClick={()=>setShowWkt(false)} style={{background:"none",border:"none",color:C.muted,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {squad.slice(0,8).map(p=>(
                <button key={p} onClick={()=>{setStriker(p);setShowWkt(false);}} style={{padding:"12px 10px",borderRadius:10,fontSize:11,background:C.bg,border:"1px solid "+C.border,color:C.text,cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>{p}</button>
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
            <div style={{fontSize:7,color:C.crimsonL,letterSpacing:6,fontWeight:"bold"}}>IPL 2025</div>
            <div style={{fontSize:19,fontWeight:"bold",letterSpacing:3,color:C.crimson}}>SHAKTI<span style={{color:C.goldL}}>.</span></div>
          </div>
        </div>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <div style={{textAlign:"center"}}><div style={{fontSize:7,color:C.dim,letterSpacing:2}}>BANKROLL</div><div style={{fontSize:14,fontWeight:"bold",color:br>=INIT_BR?C.crimson:C.red}}>₹{br.toLocaleString("en-IN")}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:7,color:C.dim,letterSpacing:2}}>S{stage}</div><div style={{fontSize:14,fontWeight:"bold",color:C.gold}}>{stage===1?"INIT":stage===2?"CONF":"ATK"}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:7,color:C.dim,letterSpacing:2}}>ENGINE</div><div style={{fontSize:12,fontWeight:"bold",color:engAcc>=74?C.greenL:engAcc>=70?C.gold:C.muted}}>{engAcc}%</div></div>
        </div>
      </div>

      {/* Alert bar */}
      {(tilt||stop||ks||skipNext||tSigs.length>0)&&(
        <div style={{background:"#fff1f0",borderBottom:"1px solid #fecaca",padding:"7px 16px"}}>
          {skipNext&&<div style={{fontSize:10,color:C.red,fontWeight:"bold"}}>⏸ MANDATORY SKIP — Stage 3 result. Rest this match.</div>}
          {ks&&<div style={{fontSize:10,color:C.red,fontWeight:"bold"}}>☠ KILL SWITCH — 10% stakes</div>}
          {tilt&&<div style={{fontSize:10,color:C.red,fontWeight:"bold"}}>⛔ TILT LOCK — Skip match</div>}
          {stop&&<div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:10,color:C.red,fontWeight:"bold"}}>🛑 DAILY STOP-LOSS</span><button onClick={()=>setDLoss(0)} style={{fontSize:9,background:"none",border:"1px solid "+C.red,color:C.red,padding:"2px 8px",cursor:"pointer",borderRadius:4,fontFamily:"inherit"}}>RESET</button></div>}
          {tSigs.length>0&&!tilt&&!stop&&<div style={{fontSize:9,color:C.gold,fontWeight:"bold"}}>{"⚡ TILT SIGNAL: "+tSigs[0]}</div>}
        </div>
      )}
      {lineAlerts.length>0&&(
        <div style={{background:"#fffbeb",borderBottom:"1px solid #fcd34d",padding:"7px 16px"}}>
          <div style={{fontSize:10,color:C.gold,fontWeight:"bold"}}>🎯 {lineAlerts[0].msg}</div>
        </div>
      )}

      <div style={{padding:16,paddingBottom:80}}>

        {/* HOME */}
        {tab==="home"&&(
          <div>
            {/* Stage visualiser */}
            <div style={{...card({marginBottom:14,padding:14})}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><span style={{fontSize:9,color:C.dim,letterSpacing:3,fontWeight:"bold"}}>STAGE PROGRESS</span><span style={{fontSize:9,color:tilt?"#ef4444":stop?"#ef4444":skipNext?"#f97316":C.greenL,fontWeight:"bold"}}>{skipNext?"SKIP ACTIVE":tilt?"TILT":stop?"STOPPED":"READY"}</span></div>
              <div style={{display:"flex",gap:6,marginBottom:10}}>
                {[1,2,3].map(s=>{const a=stage===s,d=stage>s,col=a?C.crimson:d?C.greenL:C.dim;return(
                  <div key={s} style={{flex:1,background:a?C.crimson+"10":d?C.greenL+"10":C.bg,border:"1.5px solid "+(a?C.crimson:d?C.greenL:C.border),borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                    <div style={{fontSize:8,color:col,letterSpacing:2,marginBottom:4,fontWeight:"bold"}}>S{s} {d?"✓":a?"◉":"○"}</div>
                    <div style={{fontSize:13,fontWeight:"bold",color:col}}>₹{tStake(rawStake(br,s,base,ks),"A").toLocaleString("en-IN")}</div>
                    <div style={{fontSize:8,color:C.dim,marginTop:3}}>{s<3?"15%":"profit"}</div>
                  </div>);})}
              </div>
              <div style={{display:"flex",gap:6}}>
                {["A","B","C"].map(t=>(
                  <div key={t} style={{flex:1,background:C.bg,borderRadius:8,padding:"8px 6px",textAlign:"center",border:"1px solid "+C.border}}>
                    <div style={{fontSize:8,color:tierCol(t),marginBottom:3,fontWeight:"bold"}}>T{t}</div>
                    <div style={{fontSize:13,fontWeight:"bold",color:tierCol(t)}}>₹{tStake(raw,t).toLocaleString("en-IN")}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Milestone */}
            <div style={{...card({marginBottom:14,padding:14})}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{fontSize:9,color:C.dim,letterSpacing:3,fontWeight:"bold"}}>TARGET ₹3,00,000</span><span style={{fontSize:9,color:C.crimson,fontWeight:"bold"}}>{Math.round(br/TARGET*100)}%</span></div>
              <div style={{height:8,background:C.border,borderRadius:4,marginBottom:8,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,br/TARGET*100)+"%",background:"linear-gradient(90deg,"+C.crimson+","+C.goldL+")",borderRadius:4,transition:"width 0.5s"}}/></div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                {MILESTONES.map(m=>(
                  <div key={m} style={{textAlign:"center"}}>
                    <div style={{width:7,height:7,borderRadius:"50%",background:br>=m?C.crimson:C.border,margin:"0 auto 2px"}}/>
                    <div style={{fontSize:7,color:br>=m?C.crimson:C.dim}}>₹{(m/1000).toFixed(0)}k</div>
                  </div>
                ))}
              </div>
              <div style={{padding:"7px 10px",background:C.bg,borderRadius:8,border:"1px solid "+C.border}}>
                <span style={{fontSize:9,color:C.sub}}>Next: <span style={{color:C.crimson,fontWeight:"bold"}}>₹{nextMS.toLocaleString("en-IN")}</span> — need ₹{(nextMS-br).toLocaleString("en-IN")} more</span>
              </div>
            </div>

            {/* Bankroll chart */}
            <div style={{...card({marginBottom:14,padding:14})}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><span style={{fontSize:9,color:C.dim,letterSpacing:3,fontWeight:"bold"}}>BANKROLL GROWTH</span><span style={{fontSize:10,color:pl>=0?C.greenL:C.red,fontWeight:"bold"}}>{pl>=0?"+":""}₹{Math.abs(pl).toLocaleString("en-IN")}</span></div>
              {chartData.length>1?(
                <ResponsiveContainer width="100%" height={110}>
                  <AreaChart data={chartData}>
                    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.crimson} stopOpacity={0.2}/><stop offset="95%" stopColor={C.crimson} stopOpacity={0}/></linearGradient></defs>
                    <XAxis dataKey="n" tick={{fill:C.dim,fontSize:8}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:C.dim,fontSize:8}} axisLine={false} tickLine={false} width={46} tickFormatter={v=>"₹"+(v/1000).toFixed(0)+"k"}/>
                    <Tooltip contentStyle={{background:C.panel,border:"1px solid "+C.border,borderRadius:6,fontSize:10}} formatter={v=>["₹"+Number(v).toLocaleString("en-IN")]} labelFormatter={l=>"Bet #"+l}/>
                    <ReferenceLine y={INIT_BR} stroke={C.border} strokeDasharray="3 3"/>
                    <Area type="monotone" dataKey="v" stroke={C.crimson} fill="url(#bg)" strokeWidth={2} dot={false}/>
                  </AreaChart>
                </ResponsiveContainer>
              ):<div style={{height:110,display:"flex",alignItems:"center",justifyContent:"center",color:C.dim,fontSize:11}}>Place your first bet</div>}
            </div>

            {/* Season P&L */}
            {matchPnL.length>0&&(
              <div style={{...card({marginBottom:14,padding:14})}}>
                <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:8,fontWeight:"bold"}}>SEASON P&L BY MATCH</div>
                <ResponsiveContainer width="100%" height={70}>
                  <AreaChart data={matchPnL}>
                    <XAxis hide/><YAxis hide/>
                    <Tooltip contentStyle={{background:C.panel,border:"1px solid "+C.border,borderRadius:6,fontSize:10}} formatter={v=>[(v>=0?"+":"")+"₹"+Math.abs(v).toLocaleString("en-IN"),"P&L"]}/>
                    <ReferenceLine y={0} stroke={C.border}/>
                    <Area type="monotone" dataKey="p" stroke={C.gold} fill={C.gold+"20"} strokeWidth={1.5} dot={false}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Engine accuracy */}
            <div style={{...card({marginBottom:14,padding:14})}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:9,color:C.dim,letterSpacing:3,fontWeight:"bold"}}>ENGINE ACCURACY</span><span style={{fontSize:9,color:C.muted}}>{logged} matches logged</span></div>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:6}}>
                <div style={{fontSize:30,fontWeight:"bold",color:engAcc>=74?C.greenL:engAcc>=70?C.gold:C.crimson}}>{engAcc}%</div>
                <div><div style={{fontSize:10,color:C.sub}}>Improves with every match logged</div><div style={{fontSize:9,color:C.dim}}>68% → 77% end of season</div></div>
              </div>
              <div style={{height:5,background:C.border,borderRadius:3}}><div style={{height:"100%",width:((engAcc-68)/9*100)+"%",background:"linear-gradient(90deg,"+C.crimson+","+C.goldL+")",borderRadius:3}}/></div>
            </div>

            {/* Stats */}
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              {[{l:"WIN RATE",v:wr!==null?wr+"%":"—",c:wr>=67?C.greenL:wr>=55?C.gold:C.red},{l:"WINS",v:wins,c:C.greenL},{l:"LOSSES",v:losses,c:C.red}].map(({l,v,c})=>(
                <div key={l} style={{...card({flex:1,padding:"10px 8px",textAlign:"center"})}}>
                  <div style={{fontSize:8,color:C.dim,letterSpacing:2,marginBottom:4,fontWeight:"bold"}}>{l}</div>
                  <div style={{fontSize:15,fontWeight:"bold",color:c}}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{fontSize:9,color:C.gold,letterSpacing:3,marginBottom:10,fontWeight:"bold"}}>TODAY'S MATCHES</div>
            {MATCHES.slice(0,2).map(m=><MCard key={m.id} m={m} onTap={openMatch} intel={intelScore(m,v2025)}/>)}
            <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:10,marginTop:8,fontWeight:"bold"}}>UPCOMING</div>
            {MATCHES.slice(2).map(m=>(
              <div key={m.id} onClick={()=>openMatch(m)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",...card({marginBottom:8,cursor:"pointer"})}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:14,fontWeight:"bold",color:TEAM_COL[m.t1]||C.crimson}}>{m.t1}</span><span style={{fontSize:9,color:C.dim}}>vs</span><span style={{fontSize:14,fontWeight:"bold",color:TEAM_COL[m.t2]||C.gold}}>{m.t2}</span></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:9,color:C.sub}}>{m.date+" · "+m.time}</div><div style={{fontSize:8,color:C.dim}}>{m.venue.split(",")[0]}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* MATCH */}
        {tab==="match"&&match&&(
          <div>
            {/* Header */}
            <div style={{...card({marginBottom:10,padding:0,overflow:"hidden"})}}>
              <div style={{height:4,background:"linear-gradient(90deg,"+(TEAM_COL[match.t1]||C.crimson)+","+(TEAM_COL[match.t2]||C.gold)+")"}}/>
              <div style={{padding:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:22,fontWeight:"bold",color:TEAM_COL[match.t1]||C.crimson}}>{match.t1}</span><span style={{fontSize:9,color:C.dim}}>vs</span><span style={{fontSize:22,fontWeight:"bold",color:TEAM_COL[match.t2]||C.gold}}>{match.t2}</span></div>
                  {(()=>{const is=intelScore(match,v2025);return <div style={{padding:"3px 10px",borderRadius:20,background:is.col+"18",border:"1px solid "+is.col+"40",fontSize:10,fontWeight:"bold",color:is.col}}>{is.verdict}</div>})()}
                </div>
                <div style={{fontSize:9,color:C.dim}}>{"📍 "+match.venue+" · "+match.time}</div>
                <div style={{display:"flex",gap:5,marginTop:8}}>
                  {[["PP",(VENUES_BASE[match.venue]||{}).pp],["10ov",(VENUES_BASE[match.venue]||{}).ov10],["15ov",(VENUES_BASE[match.venue]||{}).ov15],["TOT",(VENUES_BASE[match.venue]||{}).total],["CHS",((VENUES_BASE[match.venue]||{}).chase||50)+"%"]].map(([l,v])=>(
                    <div key={l} style={{flex:1,background:C.bg,borderRadius:6,padding:"5px 3px",textAlign:"center",border:"1px solid "+C.border}}>
                      <div style={{fontSize:7,color:C.dim,marginBottom:1}}>{l}</div>
                      <div style={{fontSize:11,color:C.crimson,fontWeight:"bold"}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sub tabs */}
            <div style={{display:"flex",gap:6,marginBottom:10,overflowX:"auto",scrollbarWidth:"none"}}>
              {[["predict","📊"],["intel","🎯"],["spread","🔀"],["live","📡"]].map(([id,icon])=>(
                <button key={id} onClick={()=>setSub(id)} style={{...tbtn(sub===id),flexShrink:0,padding:"7px 14px",fontSize:11}}>{icon} {id.toUpperCase()}</button>
              ))}
            </div>

            {/* PREDICT */}
            {sub==="predict"&&(
              <div>
                {/* Live score card */}
                {fetching&&!liveData&&(
                  <div style={{...card({marginBottom:10,display:"flex",alignItems:"center",gap:10,padding:"10px 14px"})}}>
                    <div style={{width:12,height:12,border:"2px solid "+C.crimson,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
                    <span style={{fontSize:10,color:C.muted}}>Fetching live score...</span>
                  </div>
                )}
                {liveData&&liveData.isLive&&(
                  <div style={{...card({marginBottom:10,background:"#fff8f0",border:"1.5px solid "+C.goldL,padding:12})}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:6,height:6,borderRadius:"50%",background:C.crimsonL,animation:"blink 1.5s infinite"}}/><span style={{fontSize:9,color:C.crimsonL,letterSpacing:2,fontWeight:"bold"}}>LIVE</span><span style={{fontSize:9,color:C.muted}}>{liveData.battingTeam}</span></div>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>{lastUpd&&<span style={{fontSize:8,color:C.dim}}>{lastUpd}</span>}<button onClick={doFetch} disabled={fetching} style={{...tbtn(true,C.crimson),padding:"2px 8px",fontSize:9}}>{fetching?"⟳":"↻"}</button></div>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:8}}>
                      <div><div style={{fontSize:34,fontWeight:"bold",color:C.text,lineHeight:1}}>{liveData.score+"/"+liveData.wickets}</div><div style={{fontSize:11,color:C.muted,marginTop:3}}>{liveData.overs+" ov · CRR "+liveData.runRate}</div></div>
                      {liveData.target&&<div style={{textAlign:"right"}}><div style={{fontSize:8,color:C.dim}}>TARGET</div><div style={{fontSize:22,fontWeight:"bold",color:C.crimson}}>{liveData.target}</div></div>}
                    </div>
                    {liveData.recentBalls&&(
                      <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
                        <span style={{fontSize:8,color:C.dim}}>Last:</span>
                        {liveData.recentBalls.split(" ").map((b,i)=>{const col=b==="W"?C.red:b==="6"?C.crimson:b==="4"?C.gold:C.dim;return <div key={i} style={{width:22,height:22,borderRadius:"50%",background:col+"15",border:"1.5px solid "+col,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:"bold",color:col}}>{b}</div>;})}
                      </div>
                    )}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                      <div style={{background:C.bg,borderRadius:6,padding:"6px 8px",border:"1px solid "+C.border}}><div style={{fontSize:7,color:C.dim,marginBottom:2}}>BATTING</div><div style={{fontSize:10,fontWeight:"bold",color:C.text}}>{liveData.striker||"—"}</div><div style={{fontSize:9,color:C.muted}}>{liveData.nonStriker||"—"}</div></div>
                      <div style={{background:C.bg,borderRadius:6,padding:"6px 8px",border:"1px solid "+C.border}}><div style={{fontSize:7,color:C.dim,marginBottom:2}}>BOWLING</div><div style={{fontSize:10,fontWeight:"bold",color:C.text}}>{liveData.bowler||"—"}</div><div style={{fontSize:9,color:C.muted}}>Last: {liveData.lastOver||"—"}</div></div>
                    </div>
                    <div style={{marginTop:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:8,color:lO<=6?C.goldL:lO<=15?C.gold:C.crimsonL,fontWeight:"bold"}}>{lO<=6?"POWERPLAY":lO<=15?"MIDDLE":"DEATH"}</span><span style={{fontSize:8,color:C.dim}}>{lO+"/20 overs"}</span></div>
                      <div style={{height:3,background:C.border,borderRadius:2}}><div style={{height:"100%",width:Math.min(100,lO/20*100)+"%",background:"linear-gradient(90deg,"+C.crimson+","+C.goldL+")",borderRadius:2}}/></div>
                    </div>
                  </div>
                )}

                {/* Conditions */}
                <div style={{...card({marginBottom:10,padding:12})}}>
                  <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:10,fontWeight:"bold"}}>CONDITIONS</div>
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:9,color:C.sub,marginBottom:4,fontWeight:"bold"}}>Batsmen</div>
                    <div style={{display:"flex",gap:6,marginBottom:6}}>
                      <select value={striker} onChange={e=>setStriker(e.target.value)} style={{...sel,flex:1}}>{squad.concat(Object.keys(PLAYERS_BASE)).filter((v,i,a)=>a.indexOf(v)===i).map(p=><option key={p}>{p}</option>)}</select>
                      <select value={nonStrike} onChange={e=>setNonStrike(e.target.value)} style={{...sel,flex:1}}>{squad.concat(Object.keys(PLAYERS_BASE)).filter((v,i,a)=>a.indexOf(v)===i).map(p=><option key={p}>{p}</option>)}</select>
                    </div>
                    <button onClick={()=>setShowWkt(true)} style={{...tbtn(false,C.crimson),width:"100%",padding:"7px 0",fontSize:9,border:"1.5px dashed "+C.border}}>🏏 WICKET FELL</button>
                  </div>
                  <div style={{marginBottom:8}}><div style={{fontSize:9,color:C.sub,marginBottom:4,fontWeight:"bold"}}>Bowler</div><select value={bowler} onChange={e=>setBowler(e.target.value)} style={sel}>{Object.keys(BOWLERS_BASE).map(b=><option key={b}>{b}</option>)}</select></div>
                  <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                    {[["Batting","batting"],["Balanced","balanced"],["Seaming","seaming"],["Turning","turning"]].map(([l,v])=>(
                      <button key={v} onClick={()=>setPitch(v)} style={{...tbtn(pitch===v,C.crimson),flex:1,fontSize:9}}>{l}</button>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div><div style={{fontSize:8,color:C.dim,marginBottom:4}}>Toss</div>{[["Bat First","batting"],["Chasing","chasing"]].map(([l,v])=><button key={v} onClick={()=>setToss(v)} style={{...tbtn(toss===v,C.gold),display:"block",width:"100%",marginBottom:4,fontSize:9,padding:"7px 8px",textAlign:"left"}}>{l}</button>)}</div>
                    <div><div style={{fontSize:8,color:C.dim,marginBottom:4}}>Weather</div>{[["Clear","clear"],["Dew","dew"],["Overcast","overcast"],["Humid","humid"]].map(([l,v])=><button key={v} onClick={()=>setWx(v)} style={{...tbtn(wx===v,C.blue),display:"block",width:"100%",marginBottom:4,fontSize:9,padding:"7px 8px",textAlign:"left"}}>{l}</button>)}</div>
                  </div>
                </div>

                {/* Spread advice banner */}
                {sa.count>0&&(
                  <div style={{padding:"8px 12px",borderRadius:8,background:sa.warn?"#fffbeb":"#f0fdf4",border:"1px solid "+(sa.warn?C.gold:C.greenL),marginBottom:10}}>
                    <div style={{fontSize:10,color:sa.warn?C.gold:C.greenL,fontWeight:"bold"}}>{sa.text}</div>
                  </div>
                )}

                {/* Markets */}
                {pred&&(
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontSize:9,color:C.dim,letterSpacing:3,fontWeight:"bold"}}>ALL MARKETS</div>{pred.isLive&&<div style={{fontSize:9,color:C.gold,fontWeight:"bold"}}>● LIVE +{pred.lb}%</div>}</div>
                    {BETS.map(bt=>{
                      const {val,lo,hi}=getBV(bt.id,pred);
                      const line=lines[bt.id]||"";
                      const stake=tStake(raw,bt.tier);
                      const tc=tierCol(bt.tier);
                      const sp=bt.id==="winner"||bt.id==="batsman"||bt.id==="wicket";
                      const v=sp?null:verdict(val,line);
                      return (
                        <div key={bt.id} style={{...card({marginBottom:8,borderLeft:"4px solid "+bt.color,padding:"11px 12px"}),border:"1px solid "+(v&&v.strong?v.bdr:C.border)}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <div style={{display:"flex",alignItems:"center",gap:7}}><span style={{fontSize:16}}>{bt.icon}</span><div><div style={{fontSize:12,color:C.text,fontWeight:"bold"}}>{bt.label}</div><div style={{fontSize:8,color:C.dim}}>{bt.sub}</div></div></div>
                            <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:8,padding:"2px 7px",borderRadius:10,border:"1px solid "+tc+"50",background:tc+"15",color:tc,fontWeight:"bold"}}>T{bt.tier}</span><span style={{fontSize:9,color:C.dim}}>{bt.acc+(pred.lb||0)}%</span></div>
                          </div>
                          {bt.id==="winner"?(
                            <div style={{display:"flex",gap:6}}>
                              <div style={{flex:1,background:C.bg,borderRadius:8,padding:"8px 6px",textAlign:"center",border:"1px solid "+C.border}}><div style={{fontSize:7,color:C.dim,marginBottom:2}}>CHASE WIN</div><div style={{fontSize:22,fontWeight:"bold",color:pred.chaseWin>=52?C.greenL:C.red}}>{pred.chaseWin}%</div></div>
                              <div style={{flex:1,background:C.bg,borderRadius:8,padding:"8px 6px",textAlign:"center",border:"1px solid "+C.border}}><div style={{fontSize:7,color:C.dim,marginBottom:2}}>BAT FIRST</div><div style={{fontSize:22,fontWeight:"bold",color:(100-pred.chaseWin)>=52?C.greenL:C.red}}>{100-pred.chaseWin}%</div></div>
                            </div>
                          ):bt.id==="batsman"||bt.id==="wicket"?(
                            <div style={{background:C.bg,borderRadius:8,padding:"8px 10px",border:"1px solid "+C.border}}><div style={{fontSize:9,color:C.muted}}>{bt.id==="batsman"?"Striker: "+striker+". Enter platform line.":"Live RPO-based. Updates automatically."}</div></div>
                          ):(
                            <div style={{display:"flex",gap:6,marginBottom:v?6:0}}>
                              <div style={{flex:1,background:C.bg,borderRadius:8,padding:"8px",border:"1px solid "+C.border}}><div style={{fontSize:7,color:C.dim,letterSpacing:2,marginBottom:3,fontWeight:"bold"}}>MY PRED</div><div style={{fontSize:28,fontWeight:"bold",color:bt.color,lineHeight:1}}>{val}</div><div style={{fontSize:8,color:C.dim,marginTop:2}}>{lo+"–"+hi}</div></div>
                              <div style={{flex:1,background:v?v.bg:C.bg,borderRadius:8,padding:"8px",border:"1px solid "+(v?v.bdr:C.border)}}><div style={{fontSize:7,color:C.dim,letterSpacing:2,marginBottom:3,fontWeight:"bold"}}>YOUR LINE</div><input type="number" value={line} onChange={e=>updateLine(bt.id,e.target.value,lO)} placeholder="—" style={{background:"transparent",border:"none",color:C.text,fontSize:28,fontWeight:"bold",width:"100%",fontFamily:"inherit",padding:0}}/><div style={{fontSize:8,color:C.dim,marginTop:2}}>Bookmaker</div></div>
                            </div>
                          )}
                          {v&&(
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",borderRadius:8,background:v.bg,border:"1px solid "+v.bdr}}>
                              <div><div style={{fontSize:13,fontWeight:"bold",color:v.color,letterSpacing:2}}>{v.text}</div><div style={{fontSize:8,color:C.muted}}>Edge {v.e>0?"+":""}{v.e} · Conf {v.conf}%</div></div>
                              {v.strong&&!tilt&&!stop&&!skipNext&&(
                                <button onClick={()=>placeBet(bt,stake)} style={{padding:"9px 14px",borderRadius:8,fontSize:10,cursor:"pointer",background:"linear-gradient(135deg,"+C.crimson+","+C.goldL+")",border:"none",color:C.white,fontFamily:"inherit",fontWeight:"bold",boxShadow:"0 2px 8px "+C.crimson+"40"}}>
                                  BET ₹{stake.toLocaleString("en-IN")}
                                </button>
                              )}
                            </div>
                          )}
                          <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}><span style={{fontSize:8,color:C.dim}}>Max · T{bt.tier}</span><span style={{fontSize:8,color:tc,fontWeight:"bold"}}>₹{stake.toLocaleString("en-IN")}</span></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* INTEL */}
            {sub==="intel"&&(()=>{
              const is=intelScore(match,v2025);
              return (
                <div>
                  <div style={{...card({marginBottom:10,background:is.verdict==="BET"?"#f0fdf4":is.verdict==="WATCH"?"#fffbeb":"#fff1f0",border:"1.5px solid "+is.col})}}>
                    <div style={{fontSize:9,color:is.col,letterSpacing:3,marginBottom:8,fontWeight:"bold"}}>MATCH INTELLIGENCE</div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontSize:36,fontWeight:"bold",color:is.col}}>{is.verdict}</div><div style={{textAlign:"center"}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>CONFIDENCE</div><div style={{fontSize:28,fontWeight:"bold",color:is.col}}>{is.score}%</div></div></div>
                    {[{l:"Venue data quality",v:is.vc,max:40},{l:"Lineup certainty",v:20,max:20},{l:"Weather clarity",v:20,max:20},{l:"Time factor",v:match.time.includes("7:30")?15:20,max:20}].map(({l,v,max})=>(
                      <div key={l} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:10,color:C.sub}}>{l}</span><span style={{fontSize:10,color:is.col,fontWeight:"bold"}}>{v}/{max}</span></div><div style={{height:4,background:C.border,borderRadius:2}}><div style={{height:"100%",width:(v/max*100)+"%",background:is.col,borderRadius:2}}/></div></div>
                    ))}
                  </div>
                  {v2025[match.venue]&&(
                    <div style={card()}>
                      <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:10,fontWeight:"bold"}}>2025 CALIBRATED DATA</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        <div style={{background:C.bg,borderRadius:8,padding:10}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>2025 PP AVG</div><div style={{fontSize:20,fontWeight:"bold",color:C.crimson}}>{v2025[match.venue].avgPP}</div><div style={{fontSize:8,color:C.dim}}>Historical: {VENUES_BASE[match.venue]?.pp}</div></div>
                        <div style={{background:C.bg,borderRadius:8,padding:10}}><div style={{fontSize:8,color:C.dim,marginBottom:2}}>2025 TOTAL AVG</div><div style={{fontSize:20,fontWeight:"bold",color:C.crimson}}>{v2025[match.venue].avgTotal}</div><div style={{fontSize:8,color:C.dim}}>{v2025[match.venue].matches} matches logged</div></div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* SPREAD */}
            {sub==="spread"&&(
              <div>
                <div style={{...card({marginBottom:10,background:sa.warn?"#fffbeb":"#f0fdf4",border:"1.5px solid "+(sa.warn?C.gold:C.greenL)})}}>
                  <div style={{fontSize:9,color:sa.warn?C.gold:C.greenL,letterSpacing:3,marginBottom:8,fontWeight:"bold"}}>BET SPREAD ADVISOR</div>
                  <div style={{fontSize:12,color:C.text,marginBottom:6}}>{sa.text}</div>
                  <div style={{fontSize:10,color:C.muted}}>Bets this match: {sa.count}/3</div>
                </div>
                <div style={card()}>
                  <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>IDEAL LOW-CORRELATION SPREAD</div>
                  {[{n:1,m:"Powerplay / 10-ov",ph:"INNINGS PHASE",col:C.crimson,d:"PP score dependent. Avoid stacking with other innings markets."},{n:2,m:"Match Winner",ph:"FULL GAME",col:C.gold,d:"Less correlated with innings phase markets."},{n:3,m:"Over by Over",ph:"MICRO EVENT",col:C.muted,d:"Most independent — single over result."}].map(({n,m,ph,col,d})=>(
                    <div key={n} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:12,paddingBottom:12,borderBottom:"1px solid "+C.border}}>
                      <div style={{width:26,height:26,borderRadius:"50%",background:col+"18",border:"1.5px solid "+col,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:"bold",color:col,flexShrink:0}}>{n}</div>
                      <div><div style={{fontSize:12,fontWeight:"bold",color:C.text}}>{m}</div><div style={{fontSize:9,color:col,fontWeight:"bold",marginBottom:2}}>{ph}</div><div style={{fontSize:9,color:C.muted}}>{d}</div></div>
                    </div>
                  ))}
                  <div style={{padding:10,background:"#fffbeb",borderRadius:8,border:"1px solid "+C.goldL}}><div style={{fontSize:9,color:C.gold,fontWeight:"bold"}}>⚠ NEVER: PP + 10-ov + 15-ov together</div><div style={{fontSize:9,color:C.muted,marginTop:2}}>Fully correlated. One bad innings wipes all 3.</div></div>
                </div>
              </div>
            )}

            {/* LIVE LINE MOVEMENT */}
            {sub==="live"&&(
              <div>
                <div style={card()}>
                  <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:10,fontWeight:"bold"}}>LINE MOVEMENT TRACKER</div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:12}}>Update platform line each over. SHAKTI detects stale bookmaker lines.</div>
                  {BETS.filter(b=>!["winner","batsman","wicket"].includes(b.id)).map(bt=>{
                    const h=lineHist[bt.id]||[];
                    const {val}=getBV(bt.id,pred)||{val:0};
                    const line=lines[bt.id]||"";
                    const v=verdict(val,line);
                    return (
                      <div key={bt.id} style={{marginBottom:10,padding:10,background:C.bg,borderRadius:8,border:"1px solid "+C.border}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}><span style={{fontSize:11,color:C.text,fontWeight:"bold"}}>{bt.icon} {bt.label}</span>{v&&<span style={{fontSize:10,fontWeight:"bold",color:v.color}}>{v.text}</span>}</div>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <div style={{flex:1}}>
                            <div style={{fontSize:8,color:C.dim,marginBottom:2}}>PRED: {val}</div>
                            <input type="number" value={line} onChange={e=>updateLine(bt.id,e.target.value,lO)} placeholder="Platform line" style={{width:"100%",background:C.panel,border:"1px solid "+C.border,color:C.text,borderRadius:6,padding:"6px 8px",fontFamily:"inherit",fontSize:14,fontWeight:"bold"}}/>
                          </div>
                          {h.length>0&&<div style={{textAlign:"center"}}><div style={{fontSize:7,color:C.dim,marginBottom:1}}>LAST</div><div style={{fontSize:11,color:C.sub}}>{h[h.length-1].line}</div></div>}
                        </div>
                        {h.length>=2&&<div style={{fontSize:8,color:C.muted,marginTop:3}}>Movement: {h[0].line}→{h[h.length-1].line} ({h[h.length-1].line>=h[0].line?"+":""}{(h[h.length-1].line-h[0].line).toFixed(1)})</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* HEDGE */}
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
              <div style={{marginBottom:10}}>
                <div style={{fontSize:8,color:C.dim,marginBottom:6,fontWeight:"bold"}}>YOU BET ON</div>
                <div style={{display:"flex",gap:8}}><button onClick={()=>setHRole("fav")} style={{...tbtn(hRole==="fav",C.greenL),flex:1}}>{hFav||"FAVOURITE"}</button><button onClick={()=>setHRole("und")} style={{...tbtn(hRole==="und",C.gold),flex:1}}>{hUnd||"UNDERDOG"}</button></div>
              </div>
              <div><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>YOUR STAKE (₹)</div><input type="number" value={hStake} onChange={e=>setHStake(+e.target.value)} style={{...sel,fontSize:22,color:C.crimson,fontWeight:"bold",textAlign:"center"}}/></div>
              <div style={{marginTop:8,padding:10,background:C.bg,borderRadius:8,border:"1px solid "+C.border}}>
                <div style={{fontSize:8,color:C.dim,marginBottom:2}}>POTENTIAL PROFIT → hedge stake</div>
                <div style={{fontSize:22,fontWeight:"bold",color:C.crimson}}>₹{Math.round(hRole==="fav"?hStake*hFavOdds/100:hStake/hUndOdds*100).toLocaleString("en-IN")}</div>
              </div>
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
            {hRes&&(
              <div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                  <div style={{...card({textAlign:"center",background:"#fffbeb",border:"1.5px solid "+C.goldL})}}><div style={{fontSize:8,color:C.dim,marginBottom:4,fontWeight:"bold"}}>IF {(hRole==="fav"?hFav:hUnd)||"ORIG"} WINS</div><div style={{fontSize:26,fontWeight:"bold",color:C.gold}}>₹0</div><div style={{fontSize:9,color:C.muted}}>Break even</div></div>
                  <div style={{...card({textAlign:"center",background:hRes.ifHW>=0?"#f0fdf4":"#fff1f0",border:"1.5px solid "+(hRes.ifHW>=0?C.greenL:C.red)})}}><div style={{fontSize:8,color:C.dim,marginBottom:4,fontWeight:"bold"}}>IF {(hOn==="fav"?hFav:hUnd)||"HEDGE"} WINS</div><div style={{fontSize:26,fontWeight:"bold",color:hRes.ifHW>=0?C.greenL:C.red}}>{hRes.ifHW>=0?"+":""}₹{Math.round(Math.abs(hRes.ifHW)).toLocaleString("en-IN")}</div><div style={{fontSize:9,color:C.muted}}>{hRes.ifHW>=0?"Guaranteed profit":"Loss scenario"}</div></div>
                </div>
                <div style={{...card({background:hRes.ifHW>500?"#f0fdf4":hRes.ifHW>0?"#fffbeb":"#fff1f0",border:"2px solid "+hRes.vc})}}>
                  <div style={{fontSize:13,fontWeight:"bold",color:hRes.vc,letterSpacing:2,marginBottom:6}}>{hRes.vt}</div>
                  <div style={{fontSize:10,color:C.muted,lineHeight:1.6}}>{hRes.ifHW>=0?"Hedge ₹"+Math.round(hRes.hStake).toLocaleString("en-IN")+". Guaranteed +₹"+Math.round(hRes.ifHW).toLocaleString("en-IN")+" if hedge wins. Zero loss if original wins.":"Min odds needed: "+Math.round(hRes.minOdds)+". Current too low. Wait."}</div>
                  <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid "+C.border,marginTop:8}}><span style={{fontSize:10,color:C.muted}}>Min break-even odds</span><span style={{fontSize:10,color:hRes.ok?C.greenL:C.red,fontWeight:"bold"}}>{Math.round(hRes.minOdds)} {hRes.ok?"✓ ABOVE":"✗ BELOW"}</span></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* LEARN */}
        {tab==="learn"&&(
          <div>
            <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>🧠 POST-MATCH LEARNING</div>
            <div style={{...card({marginBottom:12,padding:14})}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:9,color:C.dim,letterSpacing:3,fontWeight:"bold"}}>ENGINE ACCURACY</span><span style={{fontSize:9,color:C.muted}}>{logged} matches</span></div>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:6}}><div style={{fontSize:30,fontWeight:"bold",color:engAcc>=74?C.greenL:engAcc>=70?C.gold:C.crimson}}>{engAcc}%</div><div><div style={{fontSize:10,color:C.sub}}>Self-improves with every match</div><div style={{fontSize:9,color:C.dim}}>68% base → 77% end of season</div></div></div>
              <div style={{height:5,background:C.border,borderRadius:3}}><div style={{height:"100%",width:((engAcc-68)/9*100)+"%",background:"linear-gradient(90deg,"+C.crimson+","+C.goldL+")",borderRadius:3}}/></div>
              {accData.count>0&&<div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:9,color:C.sub}}>PP accuracy:</span><span style={{fontSize:14,fontWeight:"bold",color:C.crimson}}>{accData.pp}%</span></div>}
            </div>

            <div style={card()}>
              <div style={{fontSize:9,color:C.crimson,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>LOG MATCH — 30 SECONDS</div>
              <div style={{marginBottom:8}}><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>VENUE</div><select value={lVenue} onChange={e=>setLVenue(e.target.value)} style={sel}>{Object.keys(VENUES_BASE).map(v=><option key={v}>{v}</option>)}</select></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                {[["Actual PP",lPP,setLPP],["Actual Total",lTotal,setLTotal],["My PP Prediction",lPredPP,setLPredPP],["10-ov Score","","()=>{}"]].map(([l,v,fn],i)=>{
                  if(i===3) return null;
                  return <div key={l}><div style={{fontSize:8,color:C.dim,marginBottom:3,fontWeight:"bold"}}>{l}</div><input type="number" value={v} onChange={e=>fn(e.target.value)} placeholder="—" style={{...sel,fontSize:16,fontWeight:"bold",textAlign:"center"}}/></div>;
                })}
              </div>
              <div style={{marginBottom:12}}><div style={{fontSize:8,color:C.dim,marginBottom:6,fontWeight:"bold"}}>MATCH WINNER</div><div style={{display:"flex",gap:6}}>{["Batting first","Chasing","No result"].map(w=><button key={w} onClick={()=>setLWinner(w)} style={{...tbtn(lWinner===w,C.crimson),flex:1,fontSize:8,padding:"7px 4px"}}>{w}</button>)}</div></div>
              <button onClick={submitLearn} disabled={!lPP||!lTotal} style={{width:"100%",padding:"13px 0",borderRadius:8,fontSize:11,letterSpacing:2,background:!lPP||!lTotal?"transparent":"linear-gradient(135deg,"+C.crimson+","+C.goldL+")",border:!lPP||!lTotal?"1px solid "+C.border:"none",color:!lPP||!lTotal?C.dim:C.white,cursor:!lPP||!lTotal?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:"bold"}}>
                🧠 SUBMIT & TRAIN ENGINE
              </button>
              {Object.keys(v2025).length>0&&(
                <div style={{marginTop:12}}>
                  <div style={{fontSize:8,color:C.dim,marginBottom:6,fontWeight:"bold"}}>CALIBRATED THIS SEASON</div>
                  {Object.entries(v2025).map(([venue,data])=>(
                    <div key={venue} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid "+C.border}}>
                      <span style={{fontSize:9,color:C.sub}}>{venue.split(",")[0]}</span>
                      <span style={{fontSize:9,color:C.crimson,fontWeight:"bold"}}>PP:{data.avgPP} ({data.matches}M)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* CHAT */}
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
              {["How much can I risk?","Analyse this match","BET or SKIP?","Calculate hedge","Best market now?"].map(q=>(
                <button key={q} onClick={()=>setChatIn(q)} style={{flexShrink:0,padding:"5px 10px",borderRadius:16,fontSize:9,background:"transparent",border:"1px solid "+C.border,color:C.muted,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{q}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"flex-end",borderTop:"1px solid "+C.border,paddingTop:8}}>
              <textarea value={chatIn} onChange={e=>setChatIn(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}} placeholder="Ask SHAKTI anything..." rows={2} style={{flex:1,background:C.bg,border:"1px solid "+C.border,borderRadius:10,color:C.text,padding:"8px 10px",fontSize:11,fontFamily:"inherit",lineHeight:1.5}}/>
              <button onClick={sendChat} disabled={chatBusy||!chatIn.trim()} style={{padding:"10px 14px",borderRadius:8,fontSize:14,background:chatBusy||!chatIn.trim()?C.bg:C.crimson+"18",border:"1px solid "+(chatBusy||!chatIn.trim()?C.border:C.crimson),color:chatBusy||!chatIn.trim()?C.dim:C.crimson,cursor:chatBusy||!chatIn.trim()?"not-allowed":"pointer",flexShrink:0}}>⚔</button>
            </div>
          </div>
        )}

        {/* LOG */}
        {tab==="log"&&(
          <div>
            <div style={{fontSize:9,color:C.dim,letterSpacing:3,marginBottom:12,fontWeight:"bold"}}>📋 BET LOG</div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              {[{l:"WINS",v:wins,c:C.greenL},{l:"LOSSES",v:losses,c:C.red},{l:"NET P&L",v:(pl>=0?"+":"")+"₹"+Math.abs(pl).toLocaleString("en-IN"),c:pl>=0?C.greenL:C.red}].map(({l,v,c})=>(
                <div key={l} style={{...card({flex:1,padding:"10px 8px",textAlign:"center"})}}>
                  <div style={{fontSize:8,color:C.dim,marginBottom:4,fontWeight:"bold"}}>{l}</div>
                  <div style={{fontSize:14,fontWeight:"bold",color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {bets.length===0?(
              <div style={{textAlign:"center",padding:"50px 0",color:C.dim}}><div style={{fontSize:32,marginBottom:10}}>📋</div><div style={{fontSize:13}}>No bets yet</div></div>
            ):(
              [...bets].reverse().map(b=>{
                const bc=b.out==="WIN"?C.greenL:b.out==="LOSS"?C.red:C.gold;
                const bg=b.out==="WIN"?"#f0fdf4":b.out==="LOSS"?"#fff1f0":C.card;
                const bdr=b.out==="WIN"?"#86efac":b.out==="LOSS"?"#fecaca":C.border;
                return (
                  <div key={b.id} style={{background:bg,border:"1px solid "+bdr,borderLeft:"4px solid "+bc,borderRadius:12,padding:"11px 13px",marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:b.out==="PENDING"?10:0}}>
                      <div><div style={{fontSize:12,color:C.text,marginBottom:2,fontWeight:"bold"}}>{b.match}</div><div style={{fontSize:9,color:C.muted}}>{b.market+" · S"+b.stage+" · T"+b.tier}</div></div>
                      <div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:"bold",color:bc}}>{b.out==="WIN"?"+":b.out==="LOSS"?"-":""}₹{b.stake.toLocaleString("en-IN")}</div><div style={{fontSize:9,padding:"2px 8px",borderRadius:10,display:"inline-block",marginTop:2,background:bg,color:bc,fontWeight:"bold",border:"1px solid "+bdr}}>{b.out}</div></div>
                    </div>
                    {b.out==="PENDING"&&(
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>resolve(b.id,"WIN")} style={{flex:1,padding:"9px",borderRadius:8,fontSize:11,cursor:"pointer",background:"#f0fdf4",border:"1.5px solid "+C.greenL,color:C.green,fontFamily:"inherit",fontWeight:"bold"}}>✓ WIN</button>
                        <button onClick={()=>resolve(b.id,"LOSS")} style={{flex:1,padding:"9px",borderRadius:8,fontSize:11,cursor:"pointer",background:"#fff1f0",border:"1.5px solid #fca5a5",color:C.red,fontFamily:"inherit",fontWeight:"bold"}}>✗ LOSS</button>
                      </div>
                    )}
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
          <button key={id} onClick={()=>{if(id!=="match"){setTab(id);}else if(match){setTab("match");}}} style={{flex:1,padding:"12px 0",background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:16,color:tab===id?C.crimson:C.dim,borderTop:"2px solid "+(tab===id?C.crimson:"transparent"),transition:"all 0.15s"}}>
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
