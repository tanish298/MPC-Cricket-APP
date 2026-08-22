import React, { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft, Plus, Users, Trophy, X, Undo2, Target,
  Play, Check, ChevronRight, Flag, Circle as CircleIcon, Shield, Calendar, MapPin, BarChart3, Award
} from "lucide-react";

/* ---------------------------------- THEME ---------------------------------- */

const C = {
  cream: "#F6F1E4",
  paper: "#FBF8F0",
  ink: "#211E18",
  inkSoft: "#5A5548",
  pitch: "#1C4B3B",
  pitchDark: "#0F3126",
  ball: "#B23A2E",
  gold: "#B8892B",
  line: "#DCD2B8",
};

const TEAM_SWATCHES = ["#1C4B3B", "#B23A2E", "#8B6D3F", "#2B4C6F", "#6B3F5C", "#4A6B2A"];

const FONTS = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
    .f-display { font-family: 'Fraunces', serif; }
    .f-mono { font-family: 'JetBrains Mono', monospace; }
    .f-ui { font-family: 'Inter', sans-serif; }
    .ledger-edge {
      border-top: 2px dashed ${C.line};
    }
    .stamp-btn:active { transform: scale(0.96); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
  `}</style>
);

/* ---------------------------------- STORAGE ---------------------------------- */
/* Backed by Supabase (shared cloud storage) instead of the Claude artifact's window.storage */

import { loadKey, saveKey } from "./storage";

const uid = () => Math.random().toString(36).slice(2, 10);

const REGULAR_PLAYER_NAMES = [
  "Ajay Thakur", "Akshay Salunke", "Ashish Bhai", "Bajrang Goyal", "Bikramjit Singh",
  "Chetan C Shivabushan", "Darshan bhatol", "Dikshit Luthra", "Hitesh Goel", "Harish Thathi Reddy",
  "Jasbinder singh", "Jaspreet Singh", "Jenil Patel", "Karamjit Singh", "Karthik Saravanan",
  "Khalid Anwar", "Loknath", "Manpreet Maan", "Madan K Shiva Kumar", "Maulesh Bhimani",
  "Mintu Manvar", "Paras Dewan", "Prakash Mahajan", "Rashpal Singh", "Saumil Trivedi",
  "Siju Manalikatil", "Simranjit Singh Gill", "Sujay Bhagwat", "Tanish Desai", "Uttamkumar R Patel",
  "Velmurugan Shanmugan", "Vibhor patel", "Vikas Ganavi", "Vishal bhikule", "Yash sherathia", "Yash",
];
const buildDefaultPool = () => REGULAR_PLAYER_NAMES.map((name) => ({ id: uid(), name }));

/* ---------------------------------- CRICKET LOGIC ---------------------------------- */

function computeInningsState(innings, squadLen, oversLimit, target) {
  let striker = innings.openers.striker;
  let nonStriker = innings.openers.nonStriker;
  let bowler = innings.openers.bowler;
  let lastOverBowler = null;
  let legalBalls = 0, totalRuns = 0, wickets = 0;
  let batsmanStats = {}, bowlerStats = {}, outPlayers = [], battingOrder = [], retiredPlayers = [];
  let extras = { wide: 0, noball: 0, bye: 0, legbye: 0, overthrow: 0 };
  let fieldingCredits = {}; // fielderId -> { catches, runouts, stumpings }
  let maidens = {}; // bowlerId -> count
  let overRunsAcc = 0;
  let partnerships = []; // { batsman1, batsman2, runs, wicketNumber, unbeaten }
  let fallOfWickets = []; // { wicketNumber, score, oversStr, batsmanId }
  let partnerRuns = 0;
  let currentPair = (striker && nonStriker) ? [striker, nonStriker] : null;
  let overBalls = [];
  let awaitingBowler = false, awaitingBatsman = false, complete = false, completeReason = "";
  let freeHit = false;
  const maxWickets = Math.max(squadLen - 1, 1);
  let overStartEventIndex = [0]; // overStartEventIndex[N] = event index where over N began

  const ensureBat = (id) => { if (id && !batsmanStats[id]) batsmanStats[id] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, howOut: null, fielder: null }; };
  const ensureBowl = (id) => { if (id && !bowlerStats[id]) bowlerStats[id] = { balls: 0, runs: 0, wickets: 0 }; };

  if (striker) { ensureBat(striker); battingOrder.push(striker); }
  if (nonStriker) { ensureBat(nonStriker); battingOrder.push(nonStriker); }
  ensureBowl(bowler);

  let evIdx = -1;
  for (const ev of innings.events) {
    evIdx++;
    if (complete) break;
    if (ev.type === "newBowler") {
      bowler = ev.playerId; ensureBowl(bowler); awaitingBowler = false; overBalls = []; overRunsAcc = 0;
      continue;
    }
    if (ev.type === "newBatsman") {
      if (ev.replacingEnd === "striker") striker = ev.playerId; else nonStriker = ev.playerId;
      ensureBat(ev.playerId);
      if (!battingOrder.includes(ev.playerId)) battingOrder.push(ev.playerId);
      retiredPlayers = retiredPlayers.filter((id) => id !== ev.playerId);
      awaitingBatsman = false;
      currentPair = [striker, nonStriker]; partnerRuns = 0;
      continue;
    }
    if (ev.type === "retire") {
      retiredPlayers.push(ev.playerId);
      awaitingBatsman = true;
      if (currentPair) partnerships.push({ batsman1: currentPair[0], batsman2: currentPair[1], runs: partnerRuns, wicketNumber: wickets, unbeaten: false });
      currentPair = null; partnerRuns = 0;
      continue;
    }
    if (ev.type === "callback") {
      retiredPlayers = retiredPlayers.filter((id) => id !== ev.returningId);
      retiredPlayers.push(ev.outgoingId);
      ensureBat(ev.returningId);
      if (currentPair) partnerships.push({ batsman1: currentPair[0], batsman2: currentPair[1], runs: partnerRuns, wicketNumber: wickets, unbeaten: false });
      if (ev.end === "striker") striker = ev.returningId; else nonStriker = ev.returningId;
      currentPair = [striker, nonStriker]; partnerRuns = 0;
      continue;
    }
    if (ev.type === "ball") {
      ensureBat(striker); ensureBowl(bowler);
      const runsBat = ev.runsBat || 0;
      const extraType = ev.extraType || null;
      const extraRuns = ev.extraRuns || 0;
      const isLegal = !(extraType === "wide" || extraType === "noball" || extraType === "deadball");

      totalRuns += runsBat + extraRuns;
      partnerRuns += runsBat + extraRuns;
      if (extraType !== "wide" && extraType !== "deadball") batsmanStats[striker].balls++;
      batsmanStats[striker].runs += runsBat;
      if (runsBat === 4) batsmanStats[striker].fours++;
      if (runsBat === 6) batsmanStats[striker].sixes++;

      let bowlerRuns = runsBat;
      if (extraType === "wide" || extraType === "noball" || extraType === "overthrow") bowlerRuns += extraRuns;
      bowlerStats[bowler].runs += bowlerRuns;
      overRunsAcc += bowlerRuns;
      if (isLegal) bowlerStats[bowler].balls++;
      if (isLegal) legalBalls++;

      if (extraType === "wide") extras.wide += extraRuns;
      else if (extraType === "noball") extras.noball += extraRuns;
      else if (extraType === "bye") extras.bye += extraRuns;
      else if (extraType === "legbye") extras.legbye += extraRuns;
      else if (extraType === "overthrow") extras.overthrow += extraRuns;

      let symbol;
      let wicketFlag = false;
      const voidedByFreeHit = ev.wicket && freeHit && ev.wicket.type !== "Run Out";
      if (ev.wicket && !voidedByFreeHit) {
        wickets++;
        const outId = ev.wicket.who === "nonstriker" ? nonStriker : striker;
        ensureBat(outId);
        batsmanStats[outId].out = true;
        batsmanStats[outId].howOut = ev.wicket.type;
        batsmanStats[outId].fielder = ev.wicket.fielder || null;
        if (ev.wicket.fielderId) {
          if (!fieldingCredits[ev.wicket.fielderId]) fieldingCredits[ev.wicket.fielderId] = { catches: 0, runouts: 0, stumpings: 0 };
          if (ev.wicket.type === "Caught") fieldingCredits[ev.wicket.fielderId].catches++;
          else if (ev.wicket.type === "Run Out") fieldingCredits[ev.wicket.fielderId].runouts++;
          else if (ev.wicket.type === "Stumped") fieldingCredits[ev.wicket.fielderId].stumpings++;
        }
        outPlayers.push(outId);
        if (ev.wicket.type !== "Run Out") bowlerStats[bowler].wickets++;
        wicketFlag = true;
        symbol = "W";
        fallOfWickets.push({ wicketNumber: wickets, score: totalRuns, oversStr: `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`, batsmanId: outId });
        if (currentPair) partnerships.push({ batsman1: currentPair[0], batsman2: currentPair[1], runs: partnerRuns, wicketNumber: wickets, unbeaten: false });
        currentPair = null; partnerRuns = 0;
      } else if (extraType === "wide") symbol = extraRuns > 1 ? `Wd+${extraRuns - 1}` : "Wd";
      else if (extraType === "noball") symbol = runsBat > 0 ? `Nb+${runsBat}` : "Nb";
      else if (extraType === "bye") symbol = `${extraRuns}b`;
      else if (extraType === "legbye") symbol = `${extraRuns}lb`;
      else if (extraType === "overthrow") symbol = `${extraRuns}ot`;
      else if (extraType === "deadball") symbol = "Db";
      else symbol = runsBat === 0 ? "•" : String(runsBat);
      overBalls.push(symbol);

      if (extraType === "noball") freeHit = true;
      else if (extraType !== "wide" && extraType !== "deadball") freeHit = false;

      const runsRun = runsBat + ((extraType === "bye" || extraType === "legbye" || extraType === "overthrow") ? extraRuns : 0);
      if (runsRun % 2 === 1) { const t = striker; striker = nonStriker; nonStriker = t; }
      if (isLegal && legalBalls % 6 === 0) {
        lastOverBowler = bowler;
        if (overRunsAcc === 0) maidens[bowler] = (maidens[bowler] || 0) + 1;
        overRunsAcc = 0;
        overStartEventIndex.push(evIdx + 1);
        const t = striker; striker = nonStriker; nonStriker = t;
      }

      if (wickets >= maxWickets) { complete = true; completeReason = "allout"; }
      else if (legalBalls >= oversLimit * 6) { complete = true; completeReason = "overs"; }
      else if (target !== null && totalRuns >= target) { complete = true; completeReason = "target"; }

      if (!complete) {
        if (wicketFlag) awaitingBatsman = true;
        if (isLegal && legalBalls % 6 === 0) awaitingBowler = true;
      }
    }
  }

  if (currentPair) {
    partnerships.push({ batsman1: currentPair[0], batsman2: currentPair[1], runs: partnerRuns, wicketNumber: wickets + 1, unbeaten: true });
  }

  const oversStr = `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
  // Undo is allowed back to the start of the over before the current one --
  // e.g. if we're partway through over 5, undo can reach back to the first
  // ball of over 4, but no further. Keeps a stray tap from wiping the innings.
  const undoBoundaryIndex = overStartEventIndex[Math.max(0, overStartEventIndex.length - 2)];
  return {
    striker, nonStriker, bowler, lastOverBowler, legalBalls, totalRuns, wickets,
    batsmanStats, bowlerStats, outPlayers, battingOrder, retiredPlayers, awaitingBowler, awaitingBatsman,
    complete, completeReason, oversStr, maxWickets, overBalls, nextBallFreeHit: freeHit, extras, fieldingCredits, maidens, partnerships, fallOfWickets, undoBoundaryIndex,
  };
}

function fmtEcon(runs, balls) {
  if (!balls) return "-";
  const overs = balls / 6;
  return (runs / overs).toFixed(2);
}
function fmtSR(runs, balls) {
  if (!balls) return "-";
  return ((runs / balls) * 100).toFixed(1);
}

const EXTRA_LABELS = { wide: "Wides", noball: "No Balls", bye: "Byes", legbye: "Leg Byes", overthrow: "Overthrows" };
const EXTRA_TIPS = {
  wide: "Lots of width or straying down leg — worth tightening bowling lines.",
  noball: "Front-foot no-balls are creeping in — check run-ups and footwork.",
  bye: "Byes are stacking up — keeper positioning and glovework could help.",
  legbye: "Leg byes are mostly incidental deflections — not much to fix here.",
  overthrow: "Runs leaking on the throw — sharpen fielding and hitting the right end.",
};
function extrasTotal(extras) {
  return (extras.wide || 0) + (extras.noball || 0) + (extras.bye || 0) + (extras.legbye || 0) + (extras.overthrow || 0);
}
function biggestExtra(extras) {
  let best = null, bestVal = 0;
  for (const k of ["wide", "noball", "bye", "legbye", "overthrow"]) {
    if ((extras[k] || 0) > bestVal) { bestVal = extras[k]; best = k; }
  }
  return best;
}

function ExtrasBreakdown({ extras }) {
  const total = extrasTotal(extras);
  const top = biggestExtra(extras);
  return (
    <div>
      <div className="rounded-lg overflow-hidden mb-3" style={{ border: `1.5px solid ${C.line}` }}>
        {["wide", "noball", "bye", "legbye", "overthrow"].map((k, i) => (
          <div key={k} className="flex items-center justify-between px-3 py-2 f-ui text-sm" style={{ background: k === top && extras[k] > 0 ? C.gold + "22" : C.paper, borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
            <span style={{ color: C.ink }}>{EXTRA_LABELS[k]}</span>
            <span className="f-mono font-semibold" style={{ color: C.pitch }}>{extras[k] || 0}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-3 py-2 f-ui text-sm font-bold" style={{ borderTop: `1.5px solid ${C.line}`, background: C.pitch, color: "#fff" }}>
          <span>Total extras</span>
          <span className="f-mono">{total}</span>
        </div>
      </div>
      {top && (
        <div className="f-ui text-xs px-3 py-2 rounded-md" style={{ background: C.gold + "22", color: C.inkSoft }}>
          <span className="font-bold" style={{ color: C.ink }}>Most extras from {EXTRA_LABELS[top]}. </span>
          {EXTRA_TIPS[top]}
        </div>
      )}
      {total === 0 && <div className="f-ui text-xs" style={{ color: C.inkSoft }}>No extras conceded yet — clean bowling and fielding so far.</div>}
    </div>
  );
}

function computeMatchAwards(match, teams) {
  const battingTotals = {};
  const bowlingTotals = {};
  const fieldingTotals = {};
  let bestPartnership = null;

  match.innings.forEach((inn) => {
    const bt = teams.find((t) => t.id === inn.battingTeamId);
    const bowlT = teams.find((t) => t.id === inn.bowlingTeamId);
    if (!bt || !bowlT) return;
    const st = computeInningsState(inn, bt.players.length, match.oversLimit, inn.target);

    Object.entries(st.batsmanStats).forEach(([pid, s]) => {
      const name = bt.players.find((p) => p.id === pid)?.name;
      if (!name) return;
      battingTotals[pid] = { runs: s.runs, balls: s.balls, fours: s.fours, sixes: s.sixes, teamId: bt.id, name };
    });
    Object.entries(st.bowlerStats).forEach(([pid, s]) => {
      const name = bowlT.players.find((p) => p.id === pid)?.name;
      if (!name) return;
      bowlingTotals[pid] = { balls: s.balls, runs: s.runs, wickets: s.wickets, maidens: st.maidens[pid] || 0, teamId: bowlT.id, name };
    });
    Object.entries(st.fieldingCredits).forEach(([pid, c]) => {
      const name = bowlT.players.find((p) => p.id === pid)?.name;
      if (!name) return;
      const prev = fieldingTotals[pid] || { catches: 0, runouts: 0, stumpings: 0, teamId: bowlT.id, name };
      fieldingTotals[pid] = { catches: prev.catches + c.catches, runouts: prev.runouts + c.runouts, stumpings: prev.stumpings + c.stumpings, teamId: bowlT.id, name };
    });
    st.partnerships.forEach((p) => {
      const n1 = bt.players.find((pl) => pl.id === p.batsman1)?.name;
      const n2 = bt.players.find((pl) => pl.id === p.batsman2)?.name;
      if (!n1 || !n2) return;
      if (!bestPartnership || p.runs > bestPartnership.runs) {
        bestPartnership = { runs: p.runs, name1: n1, name2: n2, teamId: bt.id, unbeaten: p.unbeaten, wicketNumber: p.wicketNumber };
      }
    });
  });

  let bestBatsman = null;
  Object.entries(battingTotals).forEach(([pid, s]) => {
    const sr = s.balls ? s.runs / s.balls : 0;
    if (!bestBatsman || s.runs > bestBatsman.runs || (s.runs === bestBatsman.runs && sr > bestBatsman.sr)) {
      bestBatsman = { id: pid, ...s, sr };
    }
  });

  let bestBowler = null;
  Object.entries(bowlingTotals).forEach(([pid, s]) => {
    if (s.wickets === 0) return;
    const econ = s.balls ? s.runs / (s.balls / 6) : 999;
    if (!bestBowler || s.wickets > bestBowler.wickets || (s.wickets === bestBowler.wickets && econ < bestBowler.econ)) {
      bestBowler = { id: pid, ...s, econ };
    }
  });

  let bestFielder = null;
  Object.entries(fieldingTotals).forEach(([pid, s]) => {
    const credits = s.catches + s.runouts + s.stumpings;
    if (credits === 0) return;
    if (!bestFielder || credits > bestFielder.credits) bestFielder = { id: pid, ...s, credits };
  });

  return { bestBatsman, bestBowler, bestFielder, bestPartnership };
}

function computeCareerStats(matches, teams, filterType, filterKey) {
  // filterType: 'month' | 'year' | 'all'. filterKey: 'YYYY-MM' for month, 'YYYY' for year, ignored for 'all'.
  const completed = matches.filter((m) => {
    if (m.status !== "completed") return false;
    if (filterType === "month") return (m.createdAt || "").slice(0, 7) === filterKey;
    if (filterType === "year") return (m.createdAt || "").slice(0, 4) === filterKey;
    return true;
  });
  const players = {};
  const ensure = (rawName) => {
    const name = rawName.trim();
    const key = name.toLowerCase();
    if (!players[key]) players[key] = {
      key, name,
      matchIds: new Set(),
      batting: { innings: 0, runs: 0, balls: 0, outs: 0, notOuts: 0, fours: 0, sixes: 0, fifties: 0, hundreds: 0, ducks: 0, highScore: 0, highScoreUnbeaten: false },
      bowling: { innings: 0, balls: 0, runs: 0, wickets: 0, maidens: 0, threeWkt: 0, fiveWkt: 0, bestWkt: 0, bestRuns: null },
      fielding: { catches: 0, runouts: 0, stumpings: 0 },
      awards: { motmBat: 0, motmBowl: 0, motmField: 0 },
      partnerships: [],
    };
    return players[key];
  };

  completed.forEach((match) => {
    const awards = computeMatchAwards(match, teams);
    match.innings.forEach((inn) => {
      const bt = teams.find((t) => t.id === inn.battingTeamId);
      const bowlT = teams.find((t) => t.id === inn.bowlingTeamId);
      if (!bt || !bowlT) return;
      const st = computeInningsState(inn, bt.players.length, match.oversLimit, inn.target);

      Object.entries(st.batsmanStats).forEach(([pid, s]) => {
        const name = bt.players.find((p) => p.id === pid)?.name;
        if (!name) return;
        const p = ensure(name);
        p.matchIds.add(match.id);
        p.batting.innings++;
        p.batting.runs += s.runs;
        p.batting.balls += s.balls;
        p.batting.fours += s.fours;
        p.batting.sixes += s.sixes;
        if (s.out) p.batting.outs++; else p.batting.notOuts++;
        if (s.out && s.runs === 0 && s.balls > 0) p.batting.ducks++;
        if (s.runs >= 100) p.batting.hundreds++;
        else if (s.runs >= 50) p.batting.fifties++;
        if (s.runs > p.batting.highScore || (s.runs === p.batting.highScore && !s.out)) {
          p.batting.highScore = s.runs; p.batting.highScoreUnbeaten = !s.out;
        }
      });

      Object.entries(st.bowlerStats).forEach(([pid, s]) => {
        const name = bowlT.players.find((p) => p.id === pid)?.name;
        if (!name) return;
        const p = ensure(name);
        p.matchIds.add(match.id);
        p.bowling.innings++;
        p.bowling.balls += s.balls;
        p.bowling.runs += s.runs;
        p.bowling.wickets += s.wickets;
        p.bowling.maidens += (st.maidens[pid] || 0);
        if (s.wickets >= 5) p.bowling.fiveWkt++;
        else if (s.wickets >= 3) p.bowling.threeWkt++;
        if (p.bowling.bestRuns === null || s.wickets > p.bowling.bestWkt || (s.wickets === p.bowling.bestWkt && s.runs < p.bowling.bestRuns)) {
          p.bowling.bestWkt = s.wickets; p.bowling.bestRuns = s.runs;
        }
      });

      Object.entries(st.fieldingCredits).forEach(([pid, c]) => {
        const name = bowlT.players.find((p) => p.id === pid)?.name;
        if (!name) return;
        const p = ensure(name);
        p.matchIds.add(match.id);
        p.fielding.catches += c.catches;
        p.fielding.runouts += c.runouts;
        p.fielding.stumpings += c.stumpings;
      });

      st.partnerships.forEach((pt) => {
        const n1 = bt.players.find((pl) => pl.id === pt.batsman1)?.name;
        const n2 = bt.players.find((pl) => pl.id === pt.batsman2)?.name;
        if (!n1 || !n2) return;
        [[n1, n2], [n2, n1]].forEach(([a, b]) => {
          const p = ensure(a);
          p.partnerships.push({ runs: pt.runs, partnerName: b.trim(), teamId: bt.id, matchId: match.id, date: match.createdAt, unbeaten: pt.unbeaten });
        });
      });
    });

    if (awards.bestBatsman) ensure(awards.bestBatsman.name).awards.motmBat++;
    if (awards.bestBowler) ensure(awards.bestBowler.name).awards.motmBowl++;
    if (awards.bestFielder) ensure(awards.bestFielder.name).awards.motmField++;
  });

  const list = Object.values(players).map((p) => ({
    ...p,
    matchesPlayed: p.matchIds.size,
    battingAvg: p.batting.outs ? p.batting.runs / p.batting.outs : (p.batting.runs > 0 ? Infinity : 0),
    strikeRate: p.batting.balls ? (p.batting.runs / p.batting.balls) * 100 : 0,
    economy: p.bowling.balls ? p.bowling.runs / (p.bowling.balls / 6) : 0,
    fieldingTotal: p.fielding.catches + p.fielding.runouts + p.fielding.stumpings,
  }));

  const battersWithRuns = list.filter((p) => p.batting.innings > 0);
  const topRunScorer = battersWithRuns.length ? [...battersWithRuns].sort((a, b) => b.batting.runs - a.batting.runs)[0] : null;
  const bowlersWithWkts = list.filter((p) => p.bowling.wickets > 0);
  const topWicketTaker = bowlersWithWkts.length ? [...bowlersWithWkts].sort((a, b) => b.bowling.wickets - a.bowling.wickets || a.economy - b.economy)[0] : null;
  const fieldersWithCredits = list.filter((p) => p.fieldingTotal > 0);
  const topFielder = fieldersWithCredits.length ? [...fieldersWithCredits].sort((a, b) => b.fieldingTotal - a.fieldingTotal)[0] : null;

  let bestPartnershipOverall = null;
  list.forEach((p) => {
    p.partnerships.forEach((pt) => {
      if (!bestPartnershipOverall || pt.runs > bestPartnershipOverall.runs) {
        bestPartnershipOverall = { runs: pt.runs, name1: p.name, name2: pt.partnerName, teamId: pt.teamId, unbeaten: pt.unbeaten, date: pt.date };
      }
    });
  });

  return { players: list, topRunScorer, topWicketTaker, topFielder, bestPartnershipOverall };
}

/* ---------------------------------- SMALL UI ATOMS ---------------------------------- */

function TopBar({ title, onBack, right }) {
  return (
    <div className="flex items-center justify-between px-4 py-3" style={{ background: C.pitch }}>
      <div className="flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="text-white/90 hover:text-white p-1 -ml-1">
            <ArrowLeft size={20} />
          </button>
        )}
        <span className="f-display text-white text-lg tracking-wide">{title}</span>
      </div>
      {right}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", className = "", disabled, size = "md" }) {
  const base = "f-ui rounded-md font-semibold transition-all stamp-btn disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2.5 text-sm", lg: "px-5 py-3 text-base" };
  const variants = {
    primary: { background: C.pitch, color: "#fff" },
    ghost: { background: "transparent", color: C.pitch, border: `1.5px solid ${C.pitch}` },
    danger: { background: C.ball, color: "#fff" },
    gold: { background: C.gold, color: "#fff" },
  };
  return (
    <button disabled={disabled} onClick={onClick} className={`${base} ${sizes[size]} ${className}`} style={variants[variant]}>
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <label className="f-ui block text-xs font-semibold mb-1 uppercase tracking-wide" style={{ color: C.inkSoft }}>{label}</label>
      {children}
    </div>
  );
}

function Select({ value, onChange, children }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="f-ui w-full px-3 py-2.5 rounded-md text-sm outline-none"
      style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}
    >
      {children}
    </select>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="f-ui w-full px-3 py-2.5 rounded-md text-sm outline-none"
      style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}
    />
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(20,18,14,0.55)" }}>
      <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: C.cream, maxHeight: "88vh" }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ background: C.pitchDark }}>
          <span className="f-display text-white text-base">{title}</span>
          <button onClick={onClose} className="text-white/80"><X size={20} /></button>
        </div>
        <div className="p-4 overflow-y-auto" style={{ maxHeight: "75vh" }}>{children}</div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel = "Delete", onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="f-ui text-sm mb-4" style={{ color: C.inkSoft }}>{message}</div>
      <div className="flex gap-2">
        <Btn variant="ghost" className="flex-1 text-center" onClick={onCancel}>Cancel</Btn>
        <Btn variant="danger" className="flex-1 text-center" onClick={onConfirm}>{confirmLabel}</Btn>
      </div>
    </Modal>
  );
}

/* ---------------------------------- HOME ---------------------------------- */

function HomeScreen({ teams, matches, tournaments, playerPool, go, onLogout, userEmail, deleteMatch, isScorer, isAdmin, supabaseClient, linkedPlayerName, setLinkedPlayerName }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [assignedRoles, setAssignedRoles] = useState([]);
  const [namePicker, setNamePicker] = useState(false);
  const [customName, setCustomName] = useState("");
  const [showMyProfile, setShowMyProfile] = useState(false);

  useEffect(() => {
    if (!isAdmin || !supabaseClient) return;
    supabaseClient.from("app_roles").select("email, role").in("role", ["scorer", "admin"]).then(({ data }) => {
      if (data) setAssignedRoles(data);
    });
  }, [isAdmin, supabaseClient]);

  const myCareer = linkedPlayerName
    ? computeCareerStats(matches, teams, "all").players.find((p) => p.key === linkedPlayerName.trim().toLowerCase())
    : null;

  const liveMatches = matches.filter((m) => m.status === "live");
  const recent = matches.filter((m) => m.status === "completed").slice(-5).reverse();
  const teamName = (id) => teams.find((t) => t.id === id)?.name || "Unknown";
  const upcomingWeekly = matches
    .filter((m) => m.category === "weekly" && m.status === "scheduled")
    .sort((a, b) => (a.matchDate || "") > (b.matchDate || "") ? 1 : -1)[0];
  const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

  return (
    <div className="min-h-full" style={{ background: C.cream }}>
      <div className="px-5 pt-8 pb-6" style={{ background: `linear-gradient(160deg, ${C.pitch}, ${C.pitchDark})` }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="f-ui text-xs uppercase tracking-[0.2em] text-white/60 mb-1">Scorer's Ledger</div>
            <div className="f-display text-3xl text-white">MPC Cricket App</div>
            <div className="f-ui text-white/70 text-sm mt-1">Teams, tournaments, and ball-by-ball scoring.</div>
          </div>
          {onLogout && (
            <div className="text-right">
              <button onClick={onLogout} className="f-ui text-[11px] text-white/70 border border-white/30 rounded-md px-2.5 py-1.5 mt-1 stamp-btn" title={userEmail || ""}>
                Log out
              </button>
              <div className="f-ui text-[10px] mt-1" style={{ color: isScorer ? "#D8B56A" : "rgba(255,255,255,0.5)" }}>{isScorer ? "Scorer" : "Viewer"}</div>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 -mt-4">
        {isScorer ? (
          <button onClick={() => { go.setPresetCategory(null); go("newMatch"); }} className="w-full rounded-xl p-4 flex items-center justify-between shadow-md stamp-btn" style={{ background: C.ball, color: "#fff" }}>
            <div className="flex items-center gap-3">
              <Play size={20} />
              <span className="f-display text-lg">New Match</span>
            </div>
            <ChevronRight size={18} />
          </button>
        ) : (
          <div className="w-full rounded-xl p-4 f-ui text-sm text-center" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.inkSoft }}>
            You're a viewer — you can watch live matches and browse stats, but only a scorer can start or record a match.
          </div>
        )}
      </div>

      <div className="px-4 mt-3">
        {!linkedPlayerName ? (
          <button onClick={() => setNamePicker(true)} className="w-full rounded-xl p-3.5 flex items-center gap-3 stamp-btn" style={{ background: C.paper, border: `1.5px dashed ${C.line}` }}>
            <Users size={17} style={{ color: C.pitch }} />
            <div className="flex-1 text-left">
              <div className="f-ui text-sm font-semibold" style={{ color: C.ink }}>Set up your player profile</div>
              <div className="f-ui text-[11px]" style={{ color: C.inkSoft }}>Link your name to see your own career stats</div>
            </div>
            <ChevronRight size={15} style={{ color: C.inkSoft }} />
          </button>
        ) : (
          <div className="rounded-xl p-3.5" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            <div className="flex items-center justify-between mb-2">
              <div className="f-ui text-xs font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>My Profile</div>
              <button onClick={() => { setCustomName(linkedPlayerName); setNamePicker(true); }} className="f-ui text-[11px]" style={{ color: C.pitch }}>Change</button>
            </div>
            <div className="flex items-center justify-between">
              <div className="f-display text-base" style={{ color: C.ink }}>{linkedPlayerName}</div>
              {myCareer ? (
                <button onClick={() => setShowMyProfile(true)} className="f-ui text-xs font-semibold stamp-btn" style={{ color: C.pitch }}>View Stats</button>
              ) : (
                <span className="f-ui text-xs" style={{ color: C.inkSoft }}>No matches recorded yet</span>
              )}
            </div>
            {myCareer && (
              <div className="grid grid-cols-3 gap-2 mt-2 f-mono text-xs">
                <div className="rounded-md p-2 text-center" style={{ background: C.cream }}>
                  <div className="font-bold" style={{ color: C.pitch }}>{myCareer.batting.runs}</div>
                  <div className="f-ui text-[10px]" style={{ color: C.inkSoft }}>Runs</div>
                </div>
                <div className="rounded-md p-2 text-center" style={{ background: C.cream }}>
                  <div className="font-bold" style={{ color: C.ball }}>{myCareer.bowling.wickets}</div>
                  <div className="f-ui text-[10px]" style={{ color: C.inkSoft }}>Wickets</div>
                </div>
                <div className="rounded-md p-2 text-center" style={{ background: C.cream }}>
                  <div className="font-bold" style={{ color: C.gold }}>{myCareer.fieldingTotal}</div>
                  <div className="f-ui text-[10px]" style={{ color: C.inkSoft }}>Dismissals</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {namePicker && (
        <Modal title="Which name is you?" onClose={() => setNamePicker(false)}>
          <div className="f-ui text-xs mb-3" style={{ color: C.inkSoft }}>Pick your name from the regular players list, or type it exactly as it's entered on your team's roster.</div>
          <div className="space-y-1.5 mb-4" style={{ maxHeight: "40vh", overflowY: "auto" }}>
            {playerPool.map((p) => (
              <button key={p.id} onClick={() => { setLinkedPlayerName(p.name); setNamePicker(false); }}
                className="w-full text-left f-ui text-sm px-3 py-2 rounded-md stamp-btn"
                style={{ background: linkedPlayerName === p.name ? C.pitch : C.paper, color: linkedPlayerName === p.name ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                {p.name}
              </button>
            ))}
          </div>
          <Field label="Not in the list? Type it exactly as scored">
            <TextInput value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Full name" />
          </Field>
          <Btn className="w-full" disabled={!customName.trim()} onClick={() => { setLinkedPlayerName(customName.trim()); setNamePicker(false); }}>Save</Btn>
        </Modal>
      )}

      {showMyProfile && myCareer && (
        <PlayerDetailModal stats={myCareer} onClose={() => setShowMyProfile(false)} />
      )}

      {liveMatches.length > 0 && (
        <div className="px-4 mt-4">
          <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>Live</div>
          {liveMatches.map((m) => {
            const inn = m.innings[m.currentInnings];
            const squadLen = teams.find((t) => t.id === inn.battingTeamId)?.players.length || 2;
            const st = computeInningsState(inn, squadLen, m.oversLimit, m.currentInnings === 1 ? inn.target : null);
            return (
              <button key={m.id} onClick={() => { go("live"); go.setMatch(m.id); }}
                className="w-full text-left rounded-xl p-4 mb-2 stamp-btn"
                style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="f-ui text-xs font-bold" style={{ color: C.ball }}>● LIVE</span>
                  <span className="f-ui text-xs" style={{ color: C.inkSoft }}>{m.oversLimit} overs</span>
                </div>
                <div className="f-display text-base" style={{ color: C.ink }}>{teamName(m.teamAId)} vs {teamName(m.teamBId)}</div>
                <div className="f-mono text-lg font-bold mt-1" style={{ color: C.pitch }}>
                  {teamName(inn.battingTeamId)} {st.totalRuns}/{st.wickets} <span className="text-sm font-normal" style={{ color: C.inkSoft }}>({st.oversStr})</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {upcomingWeekly && (
        <div className="px-4 mt-4">
          <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>This Weekend</div>
          <button onClick={() => go("weekly")} className="w-full text-left rounded-xl p-4 stamp-btn" style={{ background: C.gold + "22", border: `1.5px solid ${C.gold}` }}>
            <div className="flex items-center gap-1.5 f-ui text-xs font-bold uppercase tracking-wide" style={{ color: C.gold }}>
              <Calendar size={12} /> {upcomingWeekly.weekday}{upcomingWeekly.matchDate ? ` · ${fmtDate(upcomingWeekly.matchDate)}` : ""}
            </div>
            <div className="f-display text-base mt-1" style={{ color: C.ink }}>{teamName(upcomingWeekly.teamAId)} vs {teamName(upcomingWeekly.teamBId)}</div>
            {upcomingWeekly.venue && (
              <div className="f-ui text-xs mt-0.5 flex items-center gap-1" style={{ color: C.inkSoft }}><MapPin size={11} /> {upcomingWeekly.venue}</div>
            )}
          </button>
        </div>
      )}

      <div className="px-4 mt-4 grid grid-cols-3 gap-2.5">
        <button onClick={() => go("teams")} className="rounded-xl p-3 stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
          <Users size={17} style={{ color: C.pitch }} />
          <div className="f-display text-sm mt-2" style={{ color: C.ink }}>Teams</div>
          <div className="f-ui text-[11px]" style={{ color: C.inkSoft }}>{teams.length} squads</div>
        </button>
        <button onClick={() => go("tournaments")} className="rounded-xl p-3 stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
          <Trophy size={17} style={{ color: C.gold }} />
          <div className="f-display text-sm mt-2" style={{ color: C.ink }}>Tournaments</div>
          <div className="f-ui text-[11px]" style={{ color: C.inkSoft }}>{tournaments.length} running</div>
        </button>
        <button onClick={() => go("weekly")} className="rounded-xl p-3 stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
          <Calendar size={17} style={{ color: C.ball }} />
          <div className="f-display text-sm mt-2" style={{ color: C.ink }}>Weekly</div>
          <div className="f-ui text-[11px]" style={{ color: C.inkSoft }}>{matches.filter((m) => m.weekday).length} fixtures</div>
        </button>
      </div>

      <div className="px-4 mt-2.5 space-y-2">
        <button onClick={() => go("playerStats")} className="w-full flex items-center gap-3 rounded-xl p-3.5 stamp-btn" style={{ background: C.pitchDark, color: "#fff" }}>
          <BarChart3 size={18} style={{ color: C.gold }} />
          <div className="flex-1 text-left">
            <div className="f-display text-sm">Player Stats & Leaderboards</div>
            <div className="f-ui text-[11px] text-white/60">Top performers of the month, career numbers</div>
          </div>
          <ChevronRight size={16} className="text-white/60" />
        </button>
        <button onClick={() => go("matchHistory")} className="w-full flex items-center gap-3 rounded-xl p-3.5 stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
          <Calendar size={18} style={{ color: C.pitch }} />
          <div className="flex-1 text-left">
            <div className="f-display text-sm" style={{ color: C.ink }}>Match History</div>
            <div className="f-ui text-[11px]" style={{ color: C.inkSoft }}>Browse every match, grouped by month</div>
          </div>
          <ChevronRight size={16} style={{ color: C.inkSoft }} />
        </button>
      </div>

      {isAdmin && (
        <div className="px-4 mt-4">
          <button onClick={() => go("manageAccess")} className="w-full rounded-xl p-3.5 stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="f-ui text-sm font-semibold flex items-center gap-2" style={{ color: C.ink }}><Shield size={15} style={{ color: C.gold }} /> Manage Access</span>
              <ChevronRight size={15} style={{ color: C.inkSoft }} />
            </div>
            {assignedRoles.length === 0 ? (
              <div className="f-ui text-xs" style={{ color: C.inkSoft }}>No scorers assigned yet.</div>
            ) : (
              <div className="f-ui text-xs" style={{ color: C.inkSoft }}>
                {assignedRoles.map((r) => `${r.email} (${r.role})`).join(" · ")}
              </div>
            )}
          </button>
        </div>
      )}

      {recent.length > 0 && (
        <div className="px-4 mt-5 pb-8">
          <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>Recent Results</div>
          <div className="rounded-xl overflow-hidden ledger-edge" style={{ background: C.paper }}>
            {recent.map((m, i) => (
              <div key={m.id} className="w-full flex items-center justify-between" style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                <button onClick={() => { go("summary"); go.setMatch(m.id); }} className="flex-1 text-left px-4 py-3 stamp-btn">
                  <div className="f-ui text-sm font-medium" style={{ color: C.ink }}>{teamName(m.teamAId)} vs {teamName(m.teamBId)}</div>
                  <div className="f-ui text-xs mt-0.5" style={{ color: C.inkSoft }}>{m.result?.text}</div>
                </button>
                {deleteMatch && (
                  <button onClick={() => setConfirmDeleteId(m.id)} className="px-3 py-3"><X size={14} style={{ color: C.inkSoft }} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmModal
          title="Delete Match"
          message="This permanently removes the match and its scorecard. This can't be undone."
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => { deleteMatch(confirmDeleteId); setConfirmDeleteId(null); }}
        />
      )}
    </div>
  );
}

/* ---------------------------------- PLAYER STATS ---------------------------------- */

function fmtAvg(v) {
  if (v === Infinity) return "-";
  if (!v) return "0.0";
  return v.toFixed(1);
}

function PlayerDetailModal({ stats, onClose }) {
  const bestPartner = stats.partnerships.length ? [...stats.partnerships].sort((a, b) => b.runs - a.runs)[0] : null;
  return (
    <Modal title={stats.name} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>Batting</div>
          <div className="grid grid-cols-3 gap-2 f-mono text-sm">
            {[["Runs", stats.batting.runs], ["Inns", stats.batting.innings], ["Avg", fmtAvg(stats.battingAvg)],
              ["SR", stats.strikeRate.toFixed(1)], ["HS", `${stats.batting.highScore}${stats.batting.highScoreUnbeaten ? "*" : ""}`], ["50s/100s", `${stats.batting.fifties}/${stats.batting.hundreds}`],
              ["4s/6s", `${stats.batting.fours}/${stats.batting.sixes}`], ["Ducks", stats.batting.ducks], ["Not Out", stats.batting.notOuts]].map(([label, val]) => (
              <div key={label} className="rounded-md p-2 text-center" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
                <div className="font-bold" style={{ color: C.pitch }}>{val}</div>
                <div className="f-ui text-[10px]" style={{ color: C.inkSoft }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>Bowling</div>
          <div className="grid grid-cols-3 gap-2 f-mono text-sm">
            {[["Wkts", stats.bowling.wickets], ["Inns", stats.bowling.innings], ["Econ", stats.economy.toFixed(2)],
              ["Overs", `${Math.floor(stats.bowling.balls / 6)}.${stats.bowling.balls % 6}`], ["Maidens", stats.bowling.maidens], ["Best", stats.bowling.bestRuns !== null ? `${stats.bowling.bestWkt}/${stats.bowling.bestRuns}` : "-"],
              ["3W", stats.bowling.threeWkt], ["5W", stats.bowling.fiveWkt], ["Runs", stats.bowling.runs]].map(([label, val]) => (
              <div key={label} className="rounded-md p-2 text-center" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
                <div className="font-bold" style={{ color: C.ball }}>{val}</div>
                <div className="f-ui text-[10px]" style={{ color: C.inkSoft }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>Fielding & Awards</div>
          <div className="grid grid-cols-3 gap-2 f-mono text-sm">
            {[["Catches", stats.fielding.catches], ["Run Outs", stats.fielding.runouts], ["Stumpings", stats.fielding.stumpings],
              ["Best Bat", stats.awards.motmBat], ["Best Bowl", stats.awards.motmBowl], ["Best Field", stats.awards.motmField]].map(([label, val]) => (
              <div key={label} className="rounded-md p-2 text-center" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
                <div className="font-bold" style={{ color: C.gold }}>{val}</div>
                <div className="f-ui text-[10px]" style={{ color: C.inkSoft }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
        {bestPartner && (
          <div className="f-ui text-xs px-3 py-2 rounded-md" style={{ background: C.pitch + "15", color: C.inkSoft }}>
            Best partnership: <span className="font-semibold" style={{ color: C.ink }}>{bestPartner.runs}{bestPartner.unbeaten ? "*" : ""} with {bestPartner.partnerName}</span>
          </div>
        )}
        <div className="f-ui text-xs" style={{ color: C.inkSoft }}>Played {stats.matchesPlayed} match{stats.matchesPlayed !== 1 ? "es" : ""} in this view.</div>
      </div>
    </Modal>
  );
}

function PlayerStatsScreen({ matches, teams, go }) {
  const [range, setRange] = useState("month"); // 'month' | 'year' | 'all'
  const [tab, setTab] = useState("batting"); // 'batting' | 'bowling' | 'fielding'
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const monthKey = new Date().toISOString().slice(0, 7);
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const yearKey = new Date().getFullYear().toString();
  const data = computeCareerStats(matches, teams, range, range === "month" ? monthKey : range === "year" ? yearKey : null);

  const sortedBatting = [...data.players].filter((p) => p.batting.innings > 0).sort((a, b) => b.batting.runs - a.batting.runs);
  const sortedBowling = [...data.players].filter((p) => p.bowling.wickets > 0 || p.bowling.innings > 0).sort((a, b) => b.bowling.wickets - a.bowling.wickets || a.economy - b.economy);
  const sortedFielding = [...data.players].filter((p) => p.fieldingTotal > 0).sort((a, b) => b.fieldingTotal - a.fieldingTotal);

  const teamOf = (id) => teams.find((t) => t.id === id)?.name || "";

  return (
    <div className="min-h-full pb-8" style={{ background: C.cream }}>
      <TopBar title="Player Stats" onBack={() => go("home")} />
      <div className="p-4">
        <div className="flex gap-2 mb-4">
          <button onClick={() => setRange("month")} className="flex-1 f-ui text-xs py-2 rounded-md stamp-btn"
            style={{ background: range === "month" ? C.pitch : C.paper, color: range === "month" ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
            {monthLabel}
          </button>
          <button onClick={() => setRange("year")} className="flex-1 f-ui text-xs py-2 rounded-md stamp-btn"
            style={{ background: range === "year" ? C.pitch : C.paper, color: range === "year" ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
            This Year
          </button>
          <button onClick={() => setRange("all")} className="flex-1 f-ui text-xs py-2 rounded-md stamp-btn"
            style={{ background: range === "all" ? C.pitch : C.paper, color: range === "all" ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
            All Time
          </button>
        </div>

        {(data.topRunScorer || data.topWicketTaker || data.topFielder || data.bestPartnershipOverall) ? (
          <div className="space-y-2 mb-5">
            {data.topRunScorer && (
              <button onClick={() => setSelectedPlayer(data.topRunScorer.key)} className="w-full text-left rounded-xl p-3 flex items-center gap-3 stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.pitch + "22" }}><Trophy size={16} style={{ color: C.pitch }} /></div>
                <div className="flex-1 min-w-0">
                  <div className="f-ui text-[10px] font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Top Run Scorer</div>
                  <div className="f-display text-sm truncate" style={{ color: C.ink }}>{data.topRunScorer.name}</div>
                </div>
                <div className="f-mono text-sm font-bold" style={{ color: C.pitch }}>{data.topRunScorer.batting.runs} runs</div>
              </button>
            )}
            {data.topWicketTaker && (
              <button onClick={() => setSelectedPlayer(data.topWicketTaker.key)} className="w-full text-left rounded-xl p-3 flex items-center gap-3 stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.ball + "22" }}><Target size={16} style={{ color: C.ball }} /></div>
                <div className="flex-1 min-w-0">
                  <div className="f-ui text-[10px] font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Top Wicket Taker</div>
                  <div className="f-display text-sm truncate" style={{ color: C.ink }}>{data.topWicketTaker.name}</div>
                </div>
                <div className="f-mono text-sm font-bold" style={{ color: C.ball }}>{data.topWicketTaker.bowling.wickets} wkts</div>
              </button>
            )}
            {data.topFielder && (
              <button onClick={() => setSelectedPlayer(data.topFielder.key)} className="w-full text-left rounded-xl p-3 flex items-center gap-3 stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.gold + "22" }}><Shield size={16} style={{ color: C.gold }} /></div>
                <div className="flex-1 min-w-0">
                  <div className="f-ui text-[10px] font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Top Fielder</div>
                  <div className="f-display text-sm truncate" style={{ color: C.ink }}>{data.topFielder.name}</div>
                </div>
                <div className="f-mono text-sm font-bold" style={{ color: C.gold }}>{data.topFielder.fieldingTotal} dismissals</div>
              </button>
            )}
            {data.bestPartnershipOverall && (
              <div className="w-full rounded-xl p-3 flex items-center gap-3" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.pitchDark + "22" }}><Users size={16} style={{ color: C.pitchDark }} /></div>
                <div className="flex-1 min-w-0">
                  <div className="f-ui text-[10px] font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Best Partnership</div>
                  <div className="f-display text-sm truncate" style={{ color: C.ink }}>{data.bestPartnershipOverall.name1} & {data.bestPartnershipOverall.name2}</div>
                </div>
                <div className="f-mono text-sm font-bold" style={{ color: C.pitchDark }}>{data.bestPartnershipOverall.runs}{data.bestPartnershipOverall.unbeaten ? "*" : ""}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 f-ui text-sm mb-4" style={{ color: C.inkSoft }}>No completed matches {range === "month" ? "this month" : range === "year" ? "this year" : "yet"}.</div>
        )}

        <div className="flex gap-2 mb-3">
          {[["batting", "Batting"], ["bowling", "Bowling"], ["fielding", "Fielding"]].map(([v, label]) => (
            <button key={v} onClick={() => setTab(v)} className="flex-1 f-ui text-xs py-2 rounded-md stamp-btn"
              style={{ background: tab === v ? C.pitch : C.paper, color: tab === v ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
          {tab === "batting" && (
            <>
              <div className="grid grid-cols-[1fr,40px,36px,36px,32px] px-3 py-1.5 f-ui text-[10px] font-bold uppercase" style={{ color: C.inkSoft, borderBottom: `1px solid ${C.line}` }}>
                <div>Player</div><div className="text-center">Runs</div><div className="text-center">Avg</div><div className="text-center">SR</div><div className="text-center">50/100</div>
              </div>
              {sortedBatting.length === 0 && <div className="p-4 f-ui text-sm" style={{ color: C.inkSoft }}>No batting data yet.</div>}
              {sortedBatting.map((p, i) => (
                <button key={p.key} onClick={() => setSelectedPlayer(p.key)} className="w-full grid grid-cols-[1fr,40px,36px,36px,32px] px-3 py-2 items-center f-mono text-xs stamp-btn"
                  style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                  <div className="f-ui text-left truncate" style={{ color: C.ink }}>{p.name}</div>
                  <div className="text-center font-semibold">{p.batting.runs}</div>
                  <div className="text-center">{fmtAvg(p.battingAvg)}</div>
                  <div className="text-center">{p.strikeRate.toFixed(0)}</div>
                  <div className="text-center">{p.batting.fifties}/{p.batting.hundreds}</div>
                </button>
              ))}
            </>
          )}
          {tab === "bowling" && (
            <>
              <div className="grid grid-cols-[1fr,32px,32px,40px,32px] px-3 py-1.5 f-ui text-[10px] font-bold uppercase" style={{ color: C.inkSoft, borderBottom: `1px solid ${C.line}` }}>
                <div>Player</div><div className="text-center">Wkts</div><div className="text-center">Econ</div><div className="text-center">Best</div><div className="text-center">Mdns</div>
              </div>
              {sortedBowling.length === 0 && <div className="p-4 f-ui text-sm" style={{ color: C.inkSoft }}>No bowling data yet.</div>}
              {sortedBowling.map((p, i) => (
                <button key={p.key} onClick={() => setSelectedPlayer(p.key)} className="w-full grid grid-cols-[1fr,32px,32px,40px,32px] px-3 py-2 items-center f-mono text-xs stamp-btn"
                  style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                  <div className="f-ui text-left truncate" style={{ color: C.ink }}>{p.name}</div>
                  <div className="text-center font-semibold">{p.bowling.wickets}</div>
                  <div className="text-center">{p.economy.toFixed(1)}</div>
                  <div className="text-center">{p.bowling.bestRuns !== null ? `${p.bowling.bestWkt}/${p.bowling.bestRuns}` : "-"}</div>
                  <div className="text-center">{p.bowling.maidens}</div>
                </button>
              ))}
            </>
          )}
          {tab === "fielding" && (
            <>
              <div className="grid grid-cols-[1fr,44px,44px,52px,40px] px-3 py-1.5 f-ui text-[10px] font-bold uppercase" style={{ color: C.inkSoft, borderBottom: `1px solid ${C.line}` }}>
                <div>Player</div><div className="text-center">Catch</div><div className="text-center">R/O</div><div className="text-center">Stump</div><div className="text-center">Total</div>
              </div>
              {sortedFielding.length === 0 && <div className="p-4 f-ui text-sm" style={{ color: C.inkSoft }}>No fielding data yet.</div>}
              {sortedFielding.map((p, i) => (
                <button key={p.key} onClick={() => setSelectedPlayer(p.key)} className="w-full grid grid-cols-[1fr,44px,44px,52px,40px] px-3 py-2 items-center f-mono text-xs stamp-btn"
                  style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                  <div className="f-ui text-left truncate" style={{ color: C.ink }}>{p.name}</div>
                  <div className="text-center">{p.fielding.catches}</div>
                  <div className="text-center">{p.fielding.runouts}</div>
                  <div className="text-center">{p.fielding.stumpings}</div>
                  <div className="text-center font-semibold">{p.fieldingTotal}</div>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {selectedPlayer && (
        <PlayerDetailModal stats={data.players.find((p) => p.key === selectedPlayer)} onClose={() => setSelectedPlayer(null)} />
      )}
    </div>
  );
}

/* ---------------------------------- MANAGE ACCESS (admin only) ---------------------------------- */

function ManageAccessScreen({ supabaseClient, userEmail, go }) {
  const [people, setPeople] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [savingEmail, setSavingEmail] = useState(null);

  const load = async () => {
    setError(null);
    try {
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabaseClient.from("profiles").select("id, email"),
        supabaseClient.from("app_roles").select("email, role"),
      ]);
      if (pErr || rErr) { setError((pErr || rErr).message); return; }
      const roleByEmail = {};
      (roles || []).forEach((r) => { roleByEmail[r.email] = r.role; });
      const merged = (profiles || [])
        .map((p) => ({ email: p.email, role: roleByEmail[p.email] || "viewer" }))
        .sort((a, b) => a.email.localeCompare(b.email));
      setPeople(merged);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const setRole = async (email, role) => {
    setSavingEmail(email);
    const { error: err } = await supabaseClient.from("app_roles").upsert({ email, role }, { onConflict: "email" });
    setSavingEmail(null);
    if (err) { setError(err.message); return; }
    setPeople((ps) => ps.map((p) => p.email === email ? { ...p, role } : p));
  };

  return (
    <div className="min-h-full pb-8" style={{ background: C.cream }}>
      <TopBar title="Manage Access" onBack={() => go("home")} />
      <div className="p-4">
        <div className="f-ui text-xs mb-4" style={{ color: C.inkSoft }}>
          Everyone who has signed up shows up here. Set who can score matches and who else should have full admin control. New sign-ups start as Viewers automatically.
        </div>
        {error && <div className="f-ui text-xs mb-3 px-3 py-2 rounded-md" style={{ background: C.ball + "22", color: C.inkSoft }}>{error}</div>}
        {people === null && <div className="f-ui text-sm" style={{ color: C.inkSoft }}>Loading…</div>}
        {people && people.length === 0 && <div className="f-ui text-sm" style={{ color: C.inkSoft }}>Nobody's signed up yet.</div>}
        <div className="space-y-2">
          {people && people.map((p) => (
            <div key={p.email} className="rounded-xl p-3" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
              <div className="f-ui text-sm mb-2 truncate" style={{ color: C.ink }}>
                {p.email}{p.email === userEmail && <span className="f-ui text-[10px] ml-2 px-1.5 py-0.5 rounded" style={{ background: C.gold + "33", color: C.gold }}>you</span>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {["viewer", "scorer", "admin"].map((r) => (
                  <button key={r} disabled={savingEmail === p.email} onClick={() => setRole(p.email, r)}
                    className="f-ui text-xs py-1.5 rounded-md capitalize stamp-btn disabled:opacity-50"
                    style={{ background: p.role === r ? C.pitch : C.cream, color: p.role === r ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- MATCH HISTORY ---------------------------------- */

function MatchHistoryScreen({ matches, teams, go }) {
  const teamName = (id) => teams.find((t) => t.id === id)?.name || "Unknown";
  const fmtMonth = (key) => {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  };
  const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

  const withDates = matches.filter((m) => m.status !== "scheduled" && m.createdAt);
  const groups = {};
  withDates.forEach((m) => {
    const key = m.createdAt.slice(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });
  const monthKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
  monthKeys.forEach((k) => groups[k].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));

  return (
    <div className="min-h-full pb-8" style={{ background: C.cream }}>
      <TopBar title="Match History" onBack={() => go("home")} />
      <div className="p-4">
        {monthKeys.length === 0 && (
          <div className="text-center py-10 f-ui text-sm" style={{ color: C.inkSoft }}>No matches yet.</div>
        )}
        {monthKeys.map((key) => (
          <div key={key} className="mb-5">
            <div className="f-display text-base mb-2" style={{ color: C.pitch }}>{fmtMonth(key)}</div>
            <div className="rounded-xl overflow-hidden" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
              {groups[key].map((m, i) => (
                <button key={m.id} onClick={() => { go(m.status === "completed" ? "summary" : "live"); go.setMatch(m.id); }}
                  className="w-full text-left px-4 py-3 flex items-center justify-between stamp-btn"
                  style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                  <div className="min-w-0">
                    <div className="f-ui text-sm font-medium truncate" style={{ color: C.ink }}>{teamName(m.teamAId)} vs {teamName(m.teamBId)}</div>
                    <div className="f-ui text-xs mt-0.5" style={{ color: m.status === "live" ? C.ball : C.inkSoft }}>
                      {fmtDate(m.createdAt)} · {m.status === "live" ? "● Live now" : (m.result?.text || "In progress")}
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: C.inkSoft, flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- TEAMS ---------------------------------- */

function TeamsScreen({ teams, setTeams, playerPool, setPlayerPool, isScorer, go }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TEAM_SWATCHES[0]);
  const [openTeam, setOpenTeam] = useState(null);
  const [playerName, setPlayerName] = useState("");
  const [poolModal, setPoolModal] = useState(false);
  const [poolSelected, setPoolSelected] = useState([]);
  const [randomCount, setRandomCount] = useState(6);
  const [showPoolManager, setShowPoolManager] = useState(false);
  const [newPoolName, setNewPoolName] = useState("");

  const createTeam = () => {
    if (!name.trim()) return;
    setTeams((ts) => [...ts, { id: uid(), name: name.trim(), color, players: [], keeperId: null }]);
    setName(""); setColor(TEAM_SWATCHES[0]); setAdding(false);
  };
  const addPlayer = (teamId) => {
    const name = playerName.trim();
    if (!name) return;
    setTeams((ts) => ts.map((t) => t.id === teamId ? { ...t, players: [...t.players, { id: uid(), name }] } : t));
    const alreadyInPool = playerPool.some((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    if (!alreadyInPool) setPlayerPool((pool) => [...pool, { id: uid(), name }]);
    setPlayerName("");
  };
  const removePlayer = (teamId, playerId) => {
    setTeams((ts) => ts.map((t) => t.id === teamId ? { ...t, players: t.players.filter((p) => p.id !== playerId), keeperId: t.keeperId === playerId ? null : t.keeperId } : t));
  };
  const setKeeper = (teamId, playerId) => {
    setTeams((ts) => ts.map((t) => t.id === teamId ? { ...t, keeperId: t.keeperId === playerId ? null : playerId } : t));
  };
  const removeTeam = (teamId) => {
    setTeams((ts) => ts.filter((t) => t.id !== teamId));
    setOpenTeam(null);
  };

  const team = teams.find((t) => t.id === openTeam);

  const poolAvailable = team ? playerPool.filter((p) => !team.players.some((tp) => tp.name.trim().toLowerCase() === p.name.trim().toLowerCase())) : [];

  const togglePoolPick = (id) => setPoolSelected((sel) => sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);

  const randomPick = () => {
    const n = Math.min(Number(randomCount) || 0, poolAvailable.length);
    const shuffled = [...poolAvailable].sort(() => Math.random() - 0.5).slice(0, n);
    setPoolSelected(shuffled.map((p) => p.id));
  };

  const confirmPoolAdd = () => {
    const chosen = poolAvailable.filter((p) => poolSelected.includes(p.id));
    setTeams((ts) => ts.map((t) => t.id === team.id ? { ...t, players: [...t.players, ...chosen.map((p) => ({ id: uid(), name: p.name }))] } : t));
    setPoolSelected([]); setPoolModal(false);
  };

  const addPoolName = () => {
    if (!newPoolName.trim()) return;
    setPlayerPool((pool) => [...pool, { id: uid(), name: newPoolName.trim() }]);
    setNewPoolName("");
  };
  const removePoolName = (id) => setPlayerPool((pool) => pool.filter((p) => p.id !== id));

  if (showPoolManager) {
    return (
      <div className="min-h-full" style={{ background: C.cream }}>
        <TopBar title="Regular Players" onBack={() => setShowPoolManager(false)} />
        <div className="p-4">
          <div className="f-ui text-xs mb-3" style={{ color: C.inkSoft }}>Your saved pool of regulars — pick from here when building any team's roster. Removing someone here doesn't affect teams they're already on.</div>
          {isScorer && (
            <div className="flex gap-2 mb-4">
              <TextInput placeholder="Add a regular player" value={newPoolName} onChange={(e) => setNewPoolName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPoolName()} />
              <Btn onClick={addPoolName}><Plus size={16} /></Btn>
            </div>
          )}
          <div className="rounded-xl overflow-hidden" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            {playerPool.length === 0 && <div className="p-4 f-ui text-sm" style={{ color: C.inkSoft }}>Pool is empty.</div>}
            {playerPool.map((p, i) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                <span className="f-ui text-sm" style={{ color: C.ink }}>{p.name}</span>
                {isScorer && <button onClick={() => removePoolName(p.id)}><X size={15} style={{ color: C.inkSoft }} /></button>}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (team) {
    return (
      <div className="min-h-full" style={{ background: C.cream }}>
        <TopBar title={team.name} onBack={() => setOpenTeam(null)} />
        <div className="p-4">
          {isScorer && (
            <>
              <div className="flex gap-2 mb-1">
                <TextInput placeholder="Player name (e.g. a guest)" value={playerName} onChange={(e) => setPlayerName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPlayer(team.id)} />
                <Btn onClick={() => addPlayer(team.id)}><Plus size={16} /></Btn>
              </div>
              <div className="f-ui text-[11px] mb-3" style={{ color: C.inkSoft }}>New names are also added to Regular Players, so they're one tap away next time.</div>
              <button onClick={() => { setPoolSelected([]); setPoolModal(true); }} className="w-full f-ui text-xs font-semibold py-2.5 rounded-md mb-4 stamp-btn"
                style={{ background: C.gold + "22", color: C.gold, border: `1.5px solid ${C.gold}` }}>
                Add from Regular Players ({poolAvailable.length} available)
              </button>
              <div className="f-ui text-xs mb-2" style={{ color: C.inkSoft }}>Tap the shield to set the wicketkeeper.</div>
            </>
          )}
          <div className="rounded-xl overflow-hidden" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            {team.players.length === 0 && <div className="p-4 f-ui text-sm" style={{ color: C.inkSoft }}>No players yet.{isScorer ? " Add your roster above." : ""}</div>}
            {team.players.map((p, i) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                <span className="f-ui text-sm" style={{ color: C.ink }}>{i + 1}. {p.name}{team.keeperId === p.id ? <span className="f-ui text-[10px] font-bold ml-2 px-1.5 py-0.5 rounded" style={{ background: C.gold + "33", color: C.gold }}>WK</span> : null}</span>
                {isScorer && (
                  <div className="flex items-center gap-3">
                    <button onClick={() => setKeeper(team.id, p.id)} title="Set as wicketkeeper">
                      <Shield size={15} style={{ color: team.keeperId === p.id ? C.gold : C.line }} fill={team.keeperId === p.id ? C.gold : "none"} />
                    </button>
                    <button onClick={() => removePlayer(team.id, p.id)}><X size={15} style={{ color: C.inkSoft }} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {isScorer && <button onClick={() => removeTeam(team.id)} className="f-ui text-xs mt-4" style={{ color: C.ball }}>Delete team</button>}
        </div>

        {poolModal && isScorer && (
          <Modal title="Add from Regular Players" onClose={() => setPoolModal(false)}>
            <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md" style={{ background: C.gold + "22" }}>
              <span className="f-ui text-xs" style={{ color: C.inkSoft }}>Randomly pick</span>
              <input type="number" min="1" max={poolAvailable.length} value={randomCount} onChange={(e) => setRandomCount(e.target.value)}
                className="f-mono text-sm w-14 px-2 py-1 rounded text-center" style={{ border: `1px solid ${C.line}` }} />
              <button onClick={randomPick} className="f-ui text-xs font-bold px-3 py-1.5 rounded-md stamp-btn ml-auto" style={{ background: C.gold, color: "#fff" }}>Shuffle</button>
            </div>
            <div className="space-y-1.5 mb-3">
              {poolAvailable.length === 0 && <div className="f-ui text-xs" style={{ color: C.inkSoft }}>Everyone in the pool is already on this team.</div>}
              {poolAvailable.map((p) => (
                <button key={p.id} onClick={() => togglePoolPick(p.id)} className="w-full text-left f-ui text-sm px-3 py-2 rounded-md stamp-btn flex items-center justify-between"
                  style={{ background: poolSelected.includes(p.id) ? C.pitch : C.paper, color: poolSelected.includes(p.id) ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                  {p.name}
                  {poolSelected.includes(p.id) && <Check size={14} />}
                </button>
              ))}
            </div>
            <Btn className="w-full" onClick={confirmPoolAdd} disabled={poolSelected.length === 0}>Add Selected ({poolSelected.length})</Btn>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-full" style={{ background: C.cream }}>
      <TopBar title="Teams" onBack={() => go("home")} right={
        isScorer && <button onClick={() => setAdding(!adding)} className="text-white"><Plus size={20} /></button>
      } />
      <div className="px-4 pt-4">
        <button onClick={() => setShowPoolManager(true)} className="w-full flex items-center justify-between p-3 rounded-xl mb-3 stamp-btn" style={{ background: C.gold + "22", border: `1.5px solid ${C.gold}` }}>
          <span className="f-ui text-sm font-semibold" style={{ color: C.ink }}>Regular Players</span>
          <span className="f-ui text-xs" style={{ color: C.inkSoft }}>{playerPool.length} saved <ChevronRight size={12} className="inline" /></span>
        </button>
      </div>
      {adding && isScorer && (
        <div className="p-4" style={{ background: C.paper, borderBottom: `1.5px solid ${C.line}` }}>
          <Field label="Team name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside CC" />
          </Field>
          <Field label="Color">
            <div className="flex gap-2">
              {TEAM_SWATCHES.map((c) => (
                <button key={c} onClick={() => setColor(c)} className="w-7 h-7 rounded-full" style={{ background: c, outline: color === c ? `2px solid ${C.ink}` : "none", outlineOffset: 2 }} />
              ))}
            </div>
          </Field>
          <Btn onClick={createTeam}>Create Team</Btn>
        </div>
      )}
      <div className="p-4 space-y-2">
        {teams.length === 0 && !adding && (
          <div className="text-center py-10 f-ui text-sm" style={{ color: C.inkSoft }}>No teams yet{isScorer ? " — tap + to add one." : "."}</div>
        )}
        {teams.map((t) => (
          <button key={t.id} onClick={() => setOpenTeam(t.id)} className="w-full flex items-center justify-between p-4 rounded-xl stamp-btn"
            style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ background: t.color }} />
              <div className="text-left">
                <div className="f-display text-base" style={{ color: C.ink }}>{t.name}</div>
                <div className="f-ui text-xs" style={{ color: C.inkSoft }}>{t.players.length} players</div>
              </div>
            </div>
            <ChevronRight size={16} style={{ color: C.inkSoft }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- TOURNAMENTS ---------------------------------- */

function TournamentsScreen({ teams, tournaments, setTournaments, matches, deleteTournament, deleteMatch, isScorer, go }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [selTeams, setSelTeams] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [confirmDeleteMatchId, setConfirmDeleteMatchId] = useState(null);
  const [confirmDeleteTournament, setConfirmDeleteTournament] = useState(false);

  const create = () => {
    if (!name.trim() || selTeams.length < 2) return;
    setTournaments((ts) => [...ts, { id: uid(), name: name.trim(), teamIds: selTeams }]);
    setName(""); setSelTeams([]); setAdding(false);
  };
  const toggleTeam = (id) => setSelTeams((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const open = tournaments.find((t) => t.id === openId);

  if (open) {
    const standings = open.teamIds.map((tid) => {
      const t = teams.find((x) => x.id === tid);
      const relevant = matches.filter((m) => m.tournamentId === open.id && m.status === "completed" && (m.teamAId === tid || m.teamBId === tid));
      let won = 0, lost = 0, tied = 0;
      relevant.forEach((m) => {
        if (!m.result) return;
        if (m.result.winnerTeamId === null) tied++;
        else if (m.result.winnerTeamId === tid) won++;
        else lost++;
      });
      return { id: tid, name: t?.name || "?", color: t?.color, played: relevant.length, won, lost, tied, points: won * 2 + tied };
    }).sort((a, b) => b.points - a.points || b.won - a.won);

    return (
      <div className="min-h-full" style={{ background: C.cream }}>
        <TopBar title={open.name} onBack={() => setOpenId(null)} />
        <div className="p-4">
          <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>Points Table</div>
          <div className="rounded-xl overflow-hidden" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            <div className="grid grid-cols-[1fr,32px,32px,32px,32px,40px] px-3 py-2 f-ui text-[11px] font-bold uppercase" style={{ color: C.inkSoft, borderBottom: `1px solid ${C.line}` }}>
              <div>Team</div><div className="text-center">P</div><div className="text-center">W</div><div className="text-center">L</div><div className="text-center">T</div><div className="text-center">Pts</div>
            </div>
            {standings.map((s, i) => (
              <div key={s.id} className="grid grid-cols-[1fr,32px,32px,32px,32px,40px] px-3 py-2.5 items-center f-mono text-sm" style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                <div className="flex items-center gap-2 f-ui" style={{ color: C.ink }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="truncate">{s.name}</span>
                </div>
                <div className="text-center">{s.played}</div>
                <div className="text-center">{s.won}</div>
                <div className="text-center">{s.lost}</div>
                <div className="text-center">{s.tied}</div>
                <div className="text-center font-bold" style={{ color: C.pitch }}>{s.points}</div>
              </div>
            ))}
          </div>

          <div className="f-ui text-xs font-bold uppercase tracking-wide mt-5 mb-2" style={{ color: C.inkSoft }}>Matches</div>
          <div className="space-y-2">
            {matches.filter((m) => m.tournamentId === open.id).map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <button onClick={() => { if (m.status === "completed") { go("summary"); go.setMatch(m.id); } else { go("live"); go.setMatch(m.id); } }}
                  className="flex-1 text-left p-3 rounded-lg stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
                  <div className="f-ui text-sm" style={{ color: C.ink }}>{teams.find(t=>t.id===m.teamAId)?.name} vs {teams.find(t=>t.id===m.teamBId)?.name}</div>
                  <div className="f-ui text-xs mt-0.5" style={{ color: m.status === "live" ? C.ball : C.inkSoft }}>{m.status === "live" ? "● Live now" : m.result?.text}</div>
                </button>
                {deleteMatch && <button onClick={() => setConfirmDeleteMatchId(m.id)} className="p-2"><X size={14} style={{ color: C.inkSoft }} /></button>}
              </div>
            ))}
            {matches.filter((m) => m.tournamentId === open.id).length === 0 && (
              <div className="f-ui text-xs" style={{ color: C.inkSoft }}>No matches yet. Start one from New Match and pick this tournament.</div>
            )}
          </div>

          {deleteTournament && <button onClick={() => setConfirmDeleteTournament(true)} className="f-ui text-xs mt-6" style={{ color: C.ball }}>Delete tournament</button>}
        </div>

        {confirmDeleteMatchId && (
          <ConfirmModal
            title="Delete Match"
            message="This permanently removes the match and its scorecard. This can't be undone."
            onCancel={() => setConfirmDeleteMatchId(null)}
            onConfirm={() => { deleteMatch(confirmDeleteMatchId); setConfirmDeleteMatchId(null); }}
          />
        )}
        {confirmDeleteTournament && (
          <ConfirmModal
            title="Delete Tournament"
            message="This deletes the tournament itself. Its matches stay in your match history, just no longer grouped under it."
            onCancel={() => setConfirmDeleteTournament(false)}
            onConfirm={() => { deleteTournament(open.id); setConfirmDeleteTournament(false); setOpenId(null); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-full" style={{ background: C.cream }}>
      <TopBar title="Tournaments" onBack={() => go("home")} right={
        isScorer && <button onClick={() => setAdding(!adding)} className="text-white"><Plus size={20} /></button>
      } />
      {adding && isScorer && (
        <div className="p-4" style={{ background: C.paper, borderBottom: `1.5px solid ${C.line}` }}>
          <Field label="Tournament name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer Cup" />
          </Field>
          <Field label="Teams (pick at least 2)">
            <div className="flex flex-wrap gap-2">
              {teams.map((t) => (
                <button key={t.id} onClick={() => toggleTeam(t.id)} className="f-ui text-xs px-3 py-1.5 rounded-full stamp-btn"
                  style={{ background: selTeams.includes(t.id) ? C.pitch : C.cream, color: selTeams.includes(t.id) ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                  {t.name}
                </button>
              ))}
            </div>
          </Field>
          <Btn onClick={create} disabled={selTeams.length < 2 || !name.trim()}>Create Tournament</Btn>
        </div>
      )}
      <div className="p-4 space-y-2">
        {tournaments.length === 0 && !adding && (
          <div className="text-center py-10 f-ui text-sm" style={{ color: C.inkSoft }}>No tournaments yet{isScorer ? " — tap + to start one." : "."}</div>
        )}
        {tournaments.map((t) => (
          <button key={t.id} onClick={() => setOpenId(t.id)} className="w-full flex items-center justify-between p-4 rounded-xl stamp-btn"
            style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            <div className="text-left">
              <div className="f-display text-base" style={{ color: C.ink }}>{t.name}</div>
              <div className="f-ui text-xs" style={{ color: C.inkSoft }}>{t.teamIds.length} teams</div>
            </div>
            <Trophy size={16} style={{ color: C.gold }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- WEEKLY CRICKET ---------------------------------- */

function WeeklyScreen({ teams, matches, startScheduledMatch, deleteMatch, isScorer, go }) {
  const [tossPickId, setTossPickId] = useState(null);
  const [tossWinner, setTossWinner] = useState("");
  const [tossChoice, setTossChoice] = useState("bat");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const weekly = matches.filter((m) => m.weekday).sort((a, b) => (a.matchDate || "") < (b.matchDate || "") ? 1 : -1);
  const teamName = (id) => teams.find((t) => t.id === id)?.name || "Unknown";
  const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

  const tossMatch = matches.find((m) => m.id === tossPickId);

  const confirmToss = () => {
    if (!tossWinner) return;
    startScheduledMatch(tossPickId, tossWinner, tossChoice);
    setTossPickId(null); setTossWinner(""); setTossChoice("bat");
    go("live");
  };

  return (
    <div className="min-h-full pb-8" style={{ background: C.cream }}>
      <TopBar title="Weekly Cricket" onBack={() => go("home")} right={
        isScorer && (
          <button onClick={() => { go("newMatch"); go.setPresetCategory("weekly"); }} className="text-white"><Plus size={20} /></button>
        )
      } />
      <div className="p-4 space-y-2">
        {weekly.length === 0 && (
          <div className="text-center py-10 f-ui text-sm" style={{ color: C.inkSoft }}>No weekend fixtures yet{isScorer ? " — tap + to schedule one." : "."}</div>
        )}
        {weekly.map((m) => (
          <div key={m.id} className="rounded-xl p-4" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="f-ui text-xs font-bold uppercase tracking-wide" style={{ color: C.gold }}>{m.weekday}{m.matchDate ? ` · ${fmtDate(m.matchDate)}` : ""}</span>
              <div className="flex items-center gap-2">
                {m.status === "live" && <span className="f-ui text-xs font-bold" style={{ color: C.ball }}>● LIVE</span>}
                {deleteMatch && <button onClick={() => setConfirmDeleteId(m.id)}><X size={14} style={{ color: C.inkSoft }} /></button>}
              </div>
            </div>
            <div className="f-display text-base" style={{ color: C.ink }}>{teamName(m.teamAId)} vs {teamName(m.teamBId)}</div>
            {m.venue && (
              <div className="f-ui text-xs mt-0.5 flex items-center gap-1" style={{ color: C.inkSoft }}>
                <MapPin size={11} /> {m.venue}
              </div>
            )}
            <div className="mt-3">
              {m.status === "scheduled" && (
                isScorer ? <Btn size="sm" onClick={() => { setTossPickId(m.id); setTossWinner(""); setTossChoice("bat"); }}>Start Match</Btn>
                  : <span className="f-ui text-xs" style={{ color: C.inkSoft }}>Waiting for a scorer to start this match</span>
              )}
              {m.status === "live" && (
                <Btn size="sm" onClick={() => { go("live"); go.setMatch(m.id); }}>{isScorer ? "Resume Scoring" : "Watch Live"}</Btn>
              )}
              {m.status === "completed" && (
                <button onClick={() => { go("summary"); go.setMatch(m.id); }} className="f-ui text-xs font-semibold" style={{ color: C.pitch }}>
                  {m.result?.text} <ChevronRight size={12} className="inline" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {confirmDeleteId && (
        <ConfirmModal
          title="Delete Fixture"
          message="This permanently removes the fixture and any scoring data on it. This can't be undone."
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => { deleteMatch(confirmDeleteId); setConfirmDeleteId(null); }}
        />
      )}

      {tossMatch && (
        <Modal title="Toss" onClose={() => setTossPickId(null)}>
          <Field label="Toss won by">
            <Select value={tossWinner} onChange={setTossWinner}>
              <option value="">Select team</option>
              <option value={tossMatch.teamAId}>{teamName(tossMatch.teamAId)}</option>
              <option value={tossMatch.teamBId}>{teamName(tossMatch.teamBId)}</option>
            </Select>
          </Field>
          <Field label="Elected to">
            <div className="flex gap-2">
              {["bat", "bowl"].map((c) => (
                <button key={c} onClick={() => setTossChoice(c)} className="flex-1 f-ui text-sm py-2 rounded-md capitalize stamp-btn"
                  style={{ background: tossChoice === c ? C.pitch : C.paper, color: tossChoice === c ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                  {c}
                </button>
              ))}
            </div>
          </Field>
          <Btn className="w-full mt-2" disabled={!tossWinner} onClick={confirmToss}>Begin Innings</Btn>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------- NEW MATCH ---------------------------------- */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function NewMatchScreen({ teams, tournaments, createMatch, presetCategory, isScorer, go }) {
  if (!isScorer) {
    return (
      <div className="min-h-full" style={{ background: C.cream }}>
        <TopBar title="New Match" onBack={() => go("home")} />
        <div className="p-8 text-center f-ui text-sm" style={{ color: C.inkSoft }}>Only scorers can start a match. Ask whoever manages the app to make you a scorer if this seems wrong.</div>
      </div>
    );
  }
  const [category, setCategory] = useState(presetCategory || "standalone");
  const [tournamentId, setTournamentId] = useState("");
  const [weekday, setWeekday] = useState("Saturday");
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [venue, setVenue] = useState("");
  const [alsoWeekly, setAlsoWeekly] = useState(false);
  const [teamAId, setTeamAId] = useState("");
  const [teamBId, setTeamBId] = useState("");
  const [overs, setOvers] = useState(20);
  const [maxOversPerBowler, setMaxOversPerBowler] = useState(null);
  const [tossWinner, setTossWinner] = useState("");
  const [tossChoice, setTossChoice] = useState("bat");

  const eligibleTeams = (category === "tournament" && tournamentId) ? teams.filter((t) => tournaments.find((tt) => tt.id === tournamentId)?.teamIds.includes(t.id)) : teams;
  const todayISO = new Date().toISOString().slice(0, 10);
  const isFutureWeekly = category === "weekly" && matchDate > todayISO;
  const canSubmit = teamAId && teamBId && teamAId !== teamBId && overs > 0 && (isFutureWeekly || tossWinner);

  const setDateAndWeekday = (d) => {
    setMatchDate(d);
    if (d) {
      const dt = new Date(d + "T00:00:00");
      setWeekday(WEEKDAYS[dt.getDay()]);
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    const attachWeekly = category === "weekly" || alsoWeekly;
    const created = createMatch({
      tournamentId: category === "tournament" ? (tournamentId || null) : null,
      category, weekday: attachWeekly ? weekday : null, matchDate: attachWeekly ? matchDate : null, venue: attachWeekly ? venue : null,
      teamAId, teamBId, oversLimit: Number(overs), maxOversPerBowler, tossWinnerId: tossWinner || null, tossChoice,
    });
    go(created.status === "scheduled" ? "weekly" : "live");
  };

  return (
    <div className="min-h-full" style={{ background: C.cream }}>
      <TopBar title="New Match" onBack={() => go("home")} />
      <div className="p-4">
        <Field label="Match type">
          <div className="flex gap-2">
            {[["standalone", "Standalone"], ["tournament", "Tournament"], ["weekly", "Weekly"]].map(([v, label]) => (
              <button key={v} onClick={() => setCategory(v)} className="flex-1 f-ui text-xs py-2 rounded-md stamp-btn"
                style={{ background: category === v ? C.pitch : C.paper, color: category === v ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                {label}
              </button>
            ))}
          </div>
        </Field>

        {category === "tournament" && (
          <Field label="Tournament">
            <Select value={tournamentId} onChange={setTournamentId}>
              <option value="">Select tournament</option>
              {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        )}

        {category !== "weekly" && (
          <Field label="Weekly Cricket">
            <button onClick={() => setAlsoWeekly((v) => !v)} className="w-full flex items-center justify-between px-3 py-2.5 rounded-md stamp-btn"
              style={{ background: alsoWeekly ? C.pitch : C.paper, color: alsoWeekly ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
              <span className="f-ui text-sm">Also save this to Weekly Cricket</span>
              <span className="f-ui text-xs">{alsoWeekly ? "✓ On" : "Off"}</span>
            </button>
          </Field>
        )}

        {(category === "weekly" || alsoWeekly) && (
          <>
            <Field label="Date">
              <TextInput type="date" value={matchDate} onChange={(e) => setDateAndWeekday(e.target.value)} />
            </Field>
            <Field label="Day of the week">
              <div className="grid grid-cols-4 gap-1.5">
                {WEEKDAYS.map((d) => (
                  <button key={d} onClick={() => setWeekday(d)} className="f-ui text-[11px] py-2 rounded-md stamp-btn"
                    style={{ background: weekday === d ? C.pitch : C.paper, color: weekday === d ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                    {d.slice(0, 3)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Venue">
              <TextInput value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Riverside Ground, Net 2" />
            </Field>
          </>
        )}

        <Field label="Team A">
          <Select value={teamAId} onChange={setTeamAId}>
            <option value="">Select team</option>
            {eligibleTeams.map((t) => <option key={t.id} value={t.id} disabled={t.players.length < 2}>{t.name} {t.players.length < 2 ? "(needs 2+ players)" : ""}</option>)}
          </Select>
        </Field>
        <Field label="Team B">
          <Select value={teamBId} onChange={setTeamBId}>
            <option value="">Select team</option>
            {eligibleTeams.filter((t) => t.id !== teamAId).map((t) => <option key={t.id} value={t.id} disabled={t.players.length < 2}>{t.name} {t.players.length < 2 ? "(needs 2+ players)" : ""}</option>)}
          </Select>
        </Field>
        <Field label="Overs per innings">
          <TextInput type="number" min="1" value={overs} onChange={(e) => setOvers(e.target.value)} />
        </Field>
        <Field label="Limit overs per bowler (optional)">
          <div className="flex gap-2">
            <button onClick={() => setMaxOversPerBowler(null)} className="flex-1 f-ui text-xs py-2 rounded-md stamp-btn"
              style={{ background: maxOversPerBowler === null ? C.pitch : C.paper, color: maxOversPerBowler === null ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
              No limit
            </button>
            {[1, 2, 3].map((n) => (
              <button key={n} onClick={() => setMaxOversPerBowler(n)} className="flex-1 f-ui text-xs py-2 rounded-md stamp-btn"
                style={{ background: maxOversPerBowler === n ? C.pitch : C.paper, color: maxOversPerBowler === n ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                {n} over{n > 1 ? "s" : ""}
              </button>
            ))}
          </div>
        </Field>
        {isFutureWeekly && (
          <div className="f-ui text-xs mb-3 px-3 py-2 rounded-md" style={{ background: C.gold + "22", color: C.inkSoft }}>
            This date is in the future — the fixture will be saved to Weekly Cricket. Set the toss and start scoring on the day.
          </div>
        )}
        {teamAId && teamBId && !isFutureWeekly && (
          <>
            <Field label="Toss won by">
              <Select value={tossWinner} onChange={setTossWinner}>
                <option value="">Select team</option>
                <option value={teamAId}>{teams.find((t) => t.id === teamAId)?.name}</option>
                <option value={teamBId}>{teams.find((t) => t.id === teamBId)?.name}</option>
              </Select>
            </Field>
            <Field label="Elected to">
              <div className="flex gap-2">
                {["bat", "bowl"].map((c) => (
                  <button key={c} onClick={() => setTossChoice(c)} className="flex-1 f-ui text-sm py-2 rounded-md capitalize stamp-btn"
                    style={{ background: tossChoice === c ? C.pitch : C.paper, color: tossChoice === c ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                    {c}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}
        <div className="mt-2">
          <Btn onClick={submit} disabled={!canSubmit} className="w-full text-center block">{isFutureWeekly ? "Save Fixture" : "Start Match"}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- LIVE SCORING ---------------------------------- */

function LiveScreen({ match, teams, appendEvent, setOpeners, setKeeperOverride, undoLast, deleteMatch, updateMatchOvers, isScorer, go }) {
  const [editOversModal, setEditOversModal] = useState(false);
  const [oversInput, setOversInput] = useState(0);
  const [wicketModal, setWicketModal] = useState(false);
  const [wicketType, setWicketType] = useState("Bowled");
  const [wicketWho, setWicketWho] = useState("striker");
  const [wicketRuns, setWicketRuns] = useState(0);
  const [wicketFielder, setWicketFielder] = useState("");
  const [extraPick, setExtraPick] = useState(null); // 'bye' | 'legbye' | 'noball' | 'wide'
  const [keeperModal, setKeeperModal] = useState(false);
  const [retireModal, setRetireModal] = useState(false);
  const [callbackModal, setCallbackModal] = useState(false);
  const [callbackReturning, setCallbackReturning] = useState(null);
  const [extrasModal, setExtrasModal] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  if (!match) return <div className="p-8 text-center f-ui" style={{ color: C.inkSoft }}>Match not found.</div>;

  const idx = match.currentInnings;
  const innings = match.innings[idx];
  const battingTeam = teams.find((t) => t.id === innings.battingTeamId);
  const bowlingTeam = teams.find((t) => t.id === innings.bowlingTeamId);
  const target = idx === 1 ? innings.target : null;
  const state = computeInningsState(innings, battingTeam.players.length, match.oversLimit, target);

  if (match.status === "completed") {
    return (
      <div className="min-h-full flex flex-col items-center justify-center p-8 text-center" style={{ background: C.cream }}>
        <Flag size={28} style={{ color: C.gold }} />
        <div className="f-display text-xl mt-3" style={{ color: C.ink }}>{match.result?.text}</div>
        <Btn className="mt-5" onClick={() => go("summary")}>View Scorecard</Btn>
      </div>
    );
  }

  const battingRoster = battingTeam.players.filter((p) => state.striker !== p.id || true);
  const availableBatsmen = battingTeam.players
    .filter((p) => !state.outPlayers.includes(p.id) && p.id !== state.striker && p.id !== state.nonStriker)
    .map((p) => state.retiredPlayers.includes(p.id) ? { ...p, name: `${p.name} (retired hurt)` } : p);
  const availableBowlers = bowlingTeam.players.filter((p) => {
    if (p.id === state.lastOverBowler) return false;
    if (match.maxOversPerBowler) {
      const bowledOvers = Math.floor((state.bowlerStats[p.id]?.balls || 0) / 6);
      if (bowledOvers >= match.maxOversPerBowler) return false;
    }
    return true;
  });

  /* --- Openers setup --- */
  if (innings.openers.striker === null) {
    if (!isScorer) {
      return (
        <div className="min-h-full" style={{ background: C.cream }}>
          <TopBar title={`${battingTeam.name} vs ${bowlingTeam.name}`} onBack={() => go("home")} />
          <div className="p-8 text-center f-ui text-sm" style={{ color: C.inkSoft }}>Waiting for a scorer to set the openers.</div>
        </div>
      );
    }
    return (
      <OpenersForm
        battingTeam={battingTeam} bowlingTeam={bowlingTeam}
        onConfirm={(striker, nonStriker, bowler) => setOpeners(idx, { striker, nonStriker, bowler })}
        go={go} target={target} inningsIdx={idx}
      />
    );
  }

  const recordBall = (runsBat, extraType = null, extraRuns = 0, wicket = null) => {
    appendEvent(idx, { type: "ball", runsBat, extraType, extraRuns, wicket });
  };

  const effectiveKeeperId = innings.currentKeeperId ?? bowlingTeam.keeperId;
  const effectiveKeeperName = bowlingTeam.players.find((p) => p.id === effectiveKeeperId)?.name || null;
  const keeperIsBowling = effectiveKeeperId && effectiveKeeperId === state.bowler;

  const confirmWicket = () => {
    let fielderName = null, fielderId = null;
    if (wicketType === "Stumped") { fielderName = effectiveKeeperName; fielderId = effectiveKeeperId || null; }
    else if (wicketType === "Caught" || wicketType === "Run Out") { fielderName = bowlingTeam.players.find((p) => p.id === wicketFielder)?.name || null; fielderId = wicketFielder || null; }
    recordBall(wicketType === "Run Out" ? Number(wicketRuns) : 0, null, 0, { type: wicketType, who: wicketType === "Run Out" ? wicketWho : "striker", fielder: fielderName, fielderId });
    setWicketModal(false); setWicketType("Bowled"); setWicketWho("striker"); setWicketRuns(0); setWicketFielder("");
  };

  const battingName = (id) => battingTeam.players.find((p) => p.id === id)?.name || "—";
  const bowlingName = (id) => bowlingTeam.players.find((p) => p.id === id)?.name || "—";

  const reqRuns = target !== null ? target - state.totalRuns : null;
  const ballsLeft = target !== null ? match.oversLimit * 6 - state.legalBalls : null;
  const reqRate = target !== null && ballsLeft > 0 ? (reqRuns / (ballsLeft / 6)).toFixed(2) : null;

  return (
    <div className="min-h-full pb-8" style={{ background: C.cream }}>
      <TopBar title={`${battingTeam.name} vs ${bowlingTeam.name}`} onBack={() => go("home")} right={
        <div className="flex items-center gap-3">
          {updateMatchOvers && (
            <button onClick={() => { setOversInput(match.oversLimit); setEditOversModal(true); }} className="f-ui text-[10px] text-white/80 border border-white/30 rounded px-2 py-1">Edit overs</button>
          )}
          {deleteMatch && (
            <button onClick={() => setConfirmAbandon(true)} className="text-white/80"><X size={18} /></button>
          )}
        </div>
      } />

      {/* Scorecard header */}
      <div className="mx-4 mt-4 rounded-xl p-4 ledger-edge" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="f-ui text-xs font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>{battingTeam.name} · Innings {idx + 1}</div>
            <div className="f-mono text-3xl font-bold mt-0.5" style={{ color: C.pitch }}>
              {state.totalRuns}/{state.wickets} <span className="text-base font-normal" style={{ color: C.inkSoft }}>({state.oversStr})</span>
            </div>
          </div>
          {target !== null && (
            <div className="text-right">
              <div className="f-ui text-xs" style={{ color: C.inkSoft }}>Target {target}</div>
              <div className="f-mono text-sm font-semibold" style={{ color: C.ball }}>{reqRuns > 0 ? `Need ${reqRuns} off ${ballsLeft}` : ""}</div>
              {reqRate && <div className="f-ui text-xs" style={{ color: C.inkSoft }}>RRR {reqRate}</div>}
            </div>
          )}
        </div>

        <div className="flex gap-1.5 mt-3 flex-wrap">
          {state.overBalls.map((b, i) => (
            <div key={i} className="f-mono text-xs w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: b === "W" ? C.ball : (b === "•" ? C.cream : C.gold + "33"), color: b === "W" ? "#fff" : C.ink, border: `1px solid ${C.line}` }}>
              {b}
            </div>
          ))}
        </div>

        <button onClick={() => setExtrasModal(true)} className="w-full flex items-center justify-between mt-3 pt-2 f-ui text-xs stamp-btn" style={{ borderTop: `1px solid ${C.line}`, color: C.inkSoft }}>
          <span>Extras: <span className="f-mono font-semibold" style={{ color: C.ink }}>{extrasTotal(state.extras)}</span></span>
          <span className="font-semibold" style={{ color: C.pitch }}>Breakdown</span>
        </button>
      </div>

      {extrasModal && (
        <Modal title="Extras Breakdown" onClose={() => setExtrasModal(false)}>
          <ExtrasBreakdown extras={state.extras} />
        </Modal>
      )}

      {/* Batsmen / bowler */}
      <div className="mx-4 mt-3 rounded-xl overflow-hidden" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
        <div className="grid grid-cols-[1fr,44px,32px,32px,44px] px-3 py-1.5 f-ui text-[10px] font-bold uppercase" style={{ color: C.inkSoft, borderBottom: `1px solid ${C.line}` }}>
          <div>Batter</div><div className="text-center">R</div><div className="text-center">B</div><div className="text-center">4s/6s</div><div className="text-center">SR</div>
        </div>
        {[state.striker, state.nonStriker].map((id) => {
          const s = state.batsmanStats[id] || { runs: 0, balls: 0, fours: 0, sixes: 0 };
          return (
            <div key={id} className="grid grid-cols-[1fr,44px,32px,32px,44px] px-3 py-1.5 items-center f-mono text-xs">
              <div className="f-ui truncate" style={{ color: C.ink }}>{battingName(id)}{id === state.striker ? " *" : ""}</div>
              <div className="text-center font-semibold">{s.runs}</div>
              <div className="text-center">{s.balls}</div>
              <div className="text-center">{s.fours}/{s.sixes}</div>
              <div className="text-center">{fmtSR(s.runs, s.balls)}</div>
            </div>
          );
        })}
        <div className="px-3 py-1.5 f-mono text-xs" style={{ borderTop: `1px solid ${C.line}`, color: C.inkSoft }}>
          <span className="f-ui">Bowling: </span>{bowlingName(state.bowler)} — {state.bowlerStats[state.bowler] ? `${Math.floor(state.bowlerStats[state.bowler].balls/6)}.${state.bowlerStats[state.bowler].balls%6}-${state.bowlerStats[state.bowler].runs}-${state.bowlerStats[state.bowler].wickets}` : "0.0-0-0"}
          {" "}(econ {fmtEcon(state.bowlerStats[state.bowler]?.runs || 0, state.bowlerStats[state.bowler]?.balls || 0)})
          {match.maxOversPerBowler && <span> · limit {match.maxOversPerBowler} ov</span>}
        </div>
        {isScorer ? (
          <button onClick={() => setKeeperModal(true)} className="w-full flex items-center justify-between px-3 py-1.5 f-ui text-xs stamp-btn" style={{ borderTop: `1px solid ${C.line}`, color: C.inkSoft }}>
            <span><Shield size={11} className="inline mr-1" style={{ color: C.gold }} /> Keeper: <span style={{ color: C.ink }}>{effectiveKeeperName || "not set"}</span></span>
            <span className="font-semibold" style={{ color: C.pitch }}>Change</span>
          </button>
        ) : (
          <div className="px-3 py-1.5 f-ui text-xs" style={{ borderTop: `1px solid ${C.line}`, color: C.inkSoft }}>
            <Shield size={11} className="inline mr-1" style={{ color: C.gold }} /> Keeper: <span style={{ color: C.ink }}>{effectiveKeeperName || "not set"}</span>
          </div>
        )}
      </div>

      {keeperModal && isScorer && (
        <Modal title="Change wicketkeeper" onClose={() => setKeeperModal(false)}>
          <div className="space-y-1.5">
            {bowlingTeam.players.map((p) => (
              <button key={p.id} onClick={() => { setKeeperOverride(idx, p.id); setKeeperModal(false); }}
                className="w-full text-left f-ui text-sm px-3 py-2 rounded-md stamp-btn flex items-center justify-between"
                style={{ background: effectiveKeeperId === p.id ? C.pitch : C.paper, color: effectiveKeeperId === p.id ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                {p.name}
                {p.id === bowlingTeam.keeperId && <span className="f-ui text-[10px]" style={{ color: effectiveKeeperId === p.id ? "#fff" : C.gold }}>default</span>}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {!isScorer ? (
        <div className="mx-4 mt-3 rounded-xl p-4 text-center" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
          <div className="f-ui text-sm" style={{ color: C.inkSoft }}>You're watching this match live. Only a scorer can record balls.</div>
        </div>
      ) : state.awaitingBatsman ? (
        <SelectPrompt title="Select new batsman" options={availableBatsmen} onPick={(id) => {
          const lastVacancy = [...innings.events].reverse().find((e) => (e.type === "ball" && e.wicket) || e.type === "retire");
          let end;
          if (lastVacancy?.type === "retire") {
            end = lastVacancy.end;
          } else {
            // A ball-wicket's "who" label was recorded at the moment of
            // dismissal, but this same ball's normal strike/over-end swap
            // may have since moved that player to the other slot. Check
            // where they're actually sitting right now instead of trusting
            // the static label -- otherwise the survivor gets overwritten
            // and the dismissed player stays in the game.
            const lastOutId = state.outPlayers[state.outPlayers.length - 1];
            end = state.nonStriker === lastOutId ? "nonstriker" : "striker";
          }
          appendEvent(idx, { type: "newBatsman", playerId: id, replacingEnd: end });
        }} />
      ) : state.awaitingBowler ? (
        <SelectPrompt title="Select bowler for next over" options={availableBowlers} onPick={(id) => appendEvent(idx, { type: "newBowler", playerId: id })} />
      ) : keeperIsBowling ? (
        <SelectPrompt
          title={`${effectiveKeeperName} is bowling — who's keeping?`}
          options={bowlingTeam.players.filter((p) => p.id !== state.bowler)}
          onPick={(id) => setKeeperOverride(idx, id)}
        />
      ) : (
        <div className="mx-4 mt-3">
          {state.nextBallFreeHit && (
            <div className="rounded-lg px-3 py-2 mb-3 f-ui text-xs font-bold text-center" style={{ background: C.gold, color: "#fff" }}>
              ⚡ FREE HIT — only a run out can dismiss the batter
            </div>
          )}
          <div className="grid grid-cols-4 gap-2 mb-2">
            {[0, 1, 2, 3, 4, 6].map((r) => (
              <button key={r} onClick={() => recordBall(r)} className="f-mono text-lg font-bold py-3 rounded-lg stamp-btn"
                style={{ background: r === 4 || r === 6 ? C.pitch : C.paper, color: r === 4 || r === 6 ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                {r}
              </button>
            ))}
            <button onClick={() => setExtraPick("wide")} className="f-ui text-xs font-bold py-3 rounded-lg stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>Wide</button>
            <button onClick={() => setExtraPick("noball")} className="f-ui text-xs font-bold py-3 rounded-lg stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>No Ball</button>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            <button onClick={() => setExtraPick("bye")} className="f-ui text-[11px] font-bold py-2.5 rounded-lg stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>Bye</button>
            <button onClick={() => setExtraPick("legbye")} className="f-ui text-[11px] font-bold py-2.5 rounded-lg stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>Leg Bye</button>
            <button onClick={() => setExtraPick("overthrow")} className="f-ui text-[11px] font-bold py-2.5 rounded-lg stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>Overthrow</button>
            <button onClick={() => recordBall(0, "deadball", 0)} className="f-ui text-[11px] font-bold py-2.5 rounded-lg stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>Dead Ball</button>
            <button onClick={() => setWicketModal(true)} className="f-ui text-[11px] font-bold py-2.5 rounded-lg stamp-btn" style={{ background: C.ball, color: "#fff" }}>Wicket</button>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button onClick={() => setRetireModal(true)} className="f-ui text-xs font-bold py-2.5 rounded-lg stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>Retire Hurt</button>
            <button onClick={() => setCallbackModal(true)} disabled={state.retiredPlayers.length === 0}
              className="f-ui text-xs font-bold py-2.5 rounded-lg stamp-btn disabled:opacity-40"
              style={{ background: C.gold, color: "#fff" }}>Call Back{state.retiredPlayers.length > 0 ? ` (${state.retiredPlayers.length})` : ""}</button>
          </div>
        </div>
      )}

      {isScorer && innings.events.length > state.undoBoundaryIndex && (
        <div className="mx-4 mt-3 flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: C.gold + "15", border: `1.5px solid ${C.gold}` }}>
          <span className="f-ui text-xs" style={{ color: C.inkSoft }}>Made a mistake? You can undo back through this over and the previous one — even past a batsman or bowler change.</span>
          <button onClick={() => undoLast(idx)} className="flex items-center gap-1.5 f-ui text-xs font-bold flex-shrink-0 ml-3 stamp-btn" style={{ color: C.pitch }}>
            <Undo2 size={14} /> Undo
          </button>
        </div>
      )}

      {extraPick && (
        <Modal title={
          extraPick === "wide" ? "Wide" : extraPick === "noball" ? "No Ball" :
          extraPick === "overthrow" ? "Overthrow" : extraPick === "bye" ? "Bye" : "Leg Bye"
        } onClose={() => setExtraPick(null)}>
          {(extraPick === "bye" || extraPick === "legbye") && (
            <>
              <div className="f-ui text-sm mb-3" style={{ color: C.inkSoft }}>How many runs did they run?</div>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} onClick={() => { recordBall(0, extraPick, n); setExtraPick(null); }}
                    className="f-mono text-lg font-bold py-3 rounded-lg stamp-btn" style={{ background: C.gold + "33", border: `1.5px solid ${C.line}` }}>{n}</button>
                ))}
              </div>
            </>
          )}
          {extraPick === "overthrow" && (
            <>
              <div className="f-ui text-sm mb-3" style={{ color: C.inkSoft }}>Total runs off the misfield/overthrow:</div>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button key={n} onClick={() => { recordBall(0, "overthrow", n); setExtraPick(null); }}
                    className="f-mono text-lg font-bold py-3 rounded-lg stamp-btn" style={{ background: C.ball + "33", border: `1.5px solid ${C.line}` }}>{n}</button>
                ))}
              </div>
            </>
          )}
          {extraPick === "noball" && (
            <>
              <div className="f-ui text-sm mb-3" style={{ color: C.inkSoft }}>Runs off the bat on this no-ball (the automatic +1 no-ball run is added on top):</div>
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2, 3, 4, 6].map((n) => (
                  <button key={n} onClick={() => { recordBall(n, "noball", 1); setExtraPick(null); }}
                    className="f-mono text-lg font-bold py-3 rounded-lg stamp-btn" style={{ background: C.gold + "33", border: `1.5px solid ${C.line}` }}>{n}</button>
                ))}
              </div>
              <div className="f-ui text-xs mt-3" style={{ color: C.inkSoft }}>Tap 0 if the batter didn't score off the bat — the no-ball run is still recorded.</div>
            </>
          )}
          {extraPick === "wide" && (
            <>
              <div className="f-ui text-sm mb-3" style={{ color: C.inkSoft }}>Did they run any extra byes on this wide? (the automatic +1 wide run is added on top):</div>
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 4].map((n) => (
                  <button key={n} onClick={() => { recordBall(0, "wide", 1 + n); setExtraPick(null); }}
                    className="f-mono text-lg font-bold py-3 rounded-lg stamp-btn" style={{ background: C.gold + "33", border: `1.5px solid ${C.line}` }}>{n}</button>
                ))}
              </div>
              <div className="f-ui text-xs mt-3" style={{ color: C.inkSoft }}>Tap 0 for a plain wide — the wide run is still recorded.</div>
            </>
          )}
        </Modal>
      )}

      {wicketModal && (
        <Modal title="Wicket" onClose={() => setWicketModal(false)}>
          <div className="rounded-lg px-3 py-2.5 mb-3" style={{ background: C.pitch + "12", border: `1.5px solid ${C.pitch}55` }}>
            <div className="f-ui text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: C.inkSoft }}>Currently at the crease — check before confirming</div>
            <div className="f-ui text-sm" style={{ color: C.ink }}>
              <span className="font-semibold">{battingName(state.striker)}</span> <span style={{ color: C.inkSoft }}>on strike</span>
              {" · "}
              <span className="font-semibold">{battingName(state.nonStriker)}</span> <span style={{ color: C.inkSoft }}>non-striker</span>
            </div>
          </div>
          {state.nextBallFreeHit && (
            <div className="rounded-lg px-3 py-2 mb-3 f-ui text-xs font-bold text-center" style={{ background: C.gold, color: "#fff" }}>
              ⚡ Free hit — only Run Out is allowed
            </div>
          )}
          <Field label="How out">
            <div className="grid grid-cols-2 gap-2">
              {(state.nextBallFreeHit ? ["Run Out"] : ["Bowled", "Caught", "LBW", "Run Out", "Stumped", "Hit Wicket"]).map((t) => (
                <button key={t} onClick={() => setWicketType(t)} className="f-ui text-xs py-2 rounded-md stamp-btn"
                  style={{ background: wicketType === t ? C.ball : C.paper, color: wicketType === t ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>{t}</button>
              ))}
            </div>
          </Field>
          {wicketType === "Stumped" && !effectiveKeeperId && (
            <div className="f-ui text-xs mb-3 px-3 py-2 rounded-md" style={{ background: C.gold + "22", color: C.inkSoft }}>
              No wicketkeeper set for {bowlingTeam.name}. Close this and use "Change" on the keeper row to set one.
            </div>
          )}
          {wicketType === "Caught" && (
            <Field label="Caught by">
              <Select value={wicketFielder} onChange={setWicketFielder}>
                <option value="">Select fielder</option>
                {bowlingTeam.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          )}
          {wicketType === "Run Out" && (
            <>
              <Field label="Who's out">
                <div className="flex gap-2">
                  <button onClick={() => setWicketWho("striker")} className="flex-1 f-ui text-xs py-2 rounded-md stamp-btn" style={{ background: wicketWho === "striker" ? C.pitch : C.paper, color: wicketWho === "striker" ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>{battingName(state.striker)}</button>
                  <button onClick={() => setWicketWho("nonstriker")} className="flex-1 f-ui text-xs py-2 rounded-md stamp-btn" style={{ background: wicketWho === "nonstriker" ? C.pitch : C.paper, color: wicketWho === "nonstriker" ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>{battingName(state.nonStriker)}</button>
                </div>
              </Field>
              <Field label="Runs completed before run out">
                <TextInput type="number" min="0" max="3" value={wicketRuns} onChange={(e) => setWicketRuns(e.target.value)} />
              </Field>
              <Field label="Run out by">
                <Select value={wicketFielder} onChange={setWicketFielder}>
                  <option value="">Select fielder</option>
                  {bowlingTeam.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            </>
          )}
          <Btn className="w-full mt-2" variant="danger" onClick={confirmWicket}>Confirm Wicket</Btn>
        </Modal>
      )}

      {retireModal && (
        <Modal title="Retire Hurt" onClose={() => setRetireModal(false)}>
          <div className="f-ui text-xs mb-3" style={{ color: C.inkSoft }}>They stay off the field but are not out — bring them back later with Call Back.</div>
          <div className="space-y-1.5">
            <button onClick={() => { appendEvent(idx, { type: "retire", playerId: state.striker, end: "striker" }); setRetireModal(false); }}
              className="w-full text-left f-ui text-sm px-3 py-2 rounded-md stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>
              {battingName(state.striker)} (striker)
            </button>
            <button onClick={() => { appendEvent(idx, { type: "retire", playerId: state.nonStriker, end: "nonstriker" }); setRetireModal(false); }}
              className="w-full text-left f-ui text-sm px-3 py-2 rounded-md stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>
              {battingName(state.nonStriker)} (non-striker)
            </button>
          </div>
        </Modal>
      )}

      {callbackModal && (
        <Modal title="Call Back" onClose={() => { setCallbackModal(false); setCallbackReturning(null); }}>
          {!callbackReturning ? (
            <>
              <div className="f-ui text-xs mb-3" style={{ color: C.inkSoft }}>Who's coming back in?</div>
              <div className="space-y-1.5">
                {state.retiredPlayers.map((pid) => (
                  <button key={pid} onClick={() => setCallbackReturning(pid)}
                    className="w-full text-left f-ui text-sm px-3 py-2 rounded-md stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>
                    {battingName(pid)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="f-ui text-xs mb-3" style={{ color: C.inkSoft }}>{battingName(callbackReturning)} swaps in for:</div>
              <div className="space-y-1.5">
                <button onClick={() => { appendEvent(idx, { type: "callback", returningId: callbackReturning, outgoingId: state.striker, end: "striker" }); setCallbackModal(false); setCallbackReturning(null); }}
                  className="w-full text-left f-ui text-sm px-3 py-2 rounded-md stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>
                  {battingName(state.striker)} (striker)
                </button>
                <button onClick={() => { appendEvent(idx, { type: "callback", returningId: callbackReturning, outgoingId: state.nonStriker, end: "nonstriker" }); setCallbackModal(false); setCallbackReturning(null); }}
                  className="w-full text-left f-ui text-sm px-3 py-2 rounded-md stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>
                  {battingName(state.nonStriker)} (non-striker)
                </button>
              </div>
              <button onClick={() => setCallbackReturning(null)} className="f-ui text-xs mt-3" style={{ color: C.inkSoft }}>Back</button>
            </>
          )}
        </Modal>
      )}

      {confirmAbandon && (
        <ConfirmModal
          title="Abandon Match"
          message="This permanently deletes the match in progress and everything scored so far. This can't be undone."
          confirmLabel="Abandon"
          onCancel={() => setConfirmAbandon(false)}
          onConfirm={() => { deleteMatch(match.id); setConfirmAbandon(false); go("home"); }}
        />
      )}

      {editOversModal && (
        <Modal title="Edit Overs" onClose={() => setEditOversModal(false)}>
          <div className="f-ui text-xs mb-3" style={{ color: C.inkSoft }}>Fixes the overs-per-innings limit for this match if it was entered wrong. Applies immediately to both innings.</div>
          <Field label="Overs per innings">
            <TextInput type="number" min="1" value={oversInput} onChange={(e) => setOversInput(e.target.value)} />
          </Field>
          <Btn className="w-full" onClick={() => { updateMatchOvers(match.id, Number(oversInput)); setEditOversModal(false); }}>Save</Btn>
        </Modal>
      )}
    </div>
  );
}

function OpenersForm({ battingTeam, bowlingTeam, onConfirm, go, target, inningsIdx }) {
  const [striker, setStriker] = useState("");
  const [nonStriker, setNonStriker] = useState("");
  const [bowler, setBowler] = useState("");
  const ready = striker && nonStriker && striker !== nonStriker && bowler;
  return (
    <div className="min-h-full" style={{ background: C.cream }}>
      <TopBar title={inningsIdx === 1 ? "Second Innings" : "Openers"} onBack={() => go("home")} />
      <div className="p-4">
        {target !== null && (
          <div className="rounded-lg p-3 mb-4 f-ui text-sm" style={{ background: C.gold + "22", border: `1.5px solid ${C.line}`, color: C.ink }}>
            <Target size={14} className="inline mr-1" style={{ color: C.gold }} /> Target: <span className="f-mono font-bold">{target}</span>
          </div>
        )}
        <Field label={`Opening striker (${battingTeam.name})`}>
          <Select value={striker} onChange={setStriker}>
            <option value="">Select</option>
            {battingTeam.players.map((p) => <option key={p.id} value={p.id} disabled={p.id === nonStriker}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Non-striker">
          <Select value={nonStriker} onChange={setNonStriker}>
            <option value="">Select</option>
            {battingTeam.players.map((p) => <option key={p.id} value={p.id} disabled={p.id === striker}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label={`Opening bowler (${bowlingTeam.name})`}>
          <Select value={bowler} onChange={setBowler}>
            <option value="">Select</option>
            {bowlingTeam.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Btn className="w-full text-center block mt-2" disabled={!ready} onClick={() => onConfirm(striker, nonStriker, bowler)}>Start Innings</Btn>
      </div>
    </div>
  );
}

function SelectPrompt({ title, options, onPick }) {
  return (
    <div className="mx-4 mt-3 rounded-xl p-4" style={{ background: C.gold + "22", border: `1.5px solid ${C.gold}` }}>
      <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>{title}</div>
      <div className="space-y-1.5">
        {options.map((p) => (
          <button key={p.id} onClick={() => onPick(p.id)} className="w-full text-left f-ui text-sm px-3 py-2 rounded-md stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}`, color: C.ink }}>
            {p.name}
          </button>
        ))}
        {options.length === 0 && <div className="f-ui text-xs" style={{ color: C.inkSoft }}>No eligible players available.</div>}
      </div>
    </div>
  );
}

/* ---------------------------------- SUMMARY ---------------------------------- */

function SummaryScreen({ match, teams, deleteMatch, updateMatchWeeklyInfo, go }) {
  const [tab, setTab] = useState("overview"); // 'overview' | 'scorecard'
  const [openExtras, setOpenExtras] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [weeklyModal, setWeeklyModal] = useState(false);
  const [wkDate, setWkDate] = useState("");
  const [wkDay, setWkDay] = useState("Saturday");
  const [wkVenue, setWkVenue] = useState("");
  if (!match) return <div className="p-8 text-center f-ui" style={{ color: C.inkSoft }}>Match not found.</div>;
  const awards = match.status === "completed" ? computeMatchAwards(match, teams) : null;
  const teamOf = (id) => teams.find((t) => t.id === id)?.name || "";

  const openWeeklyModal = () => {
    setWkDate(match.matchDate || match.createdAt || new Date().toISOString().slice(0, 10));
    setWkDay(match.weekday || "Saturday");
    setWkVenue(match.venue || "");
    setWeeklyModal(true);
  };
  const setWkDateAndDay = (d) => {
    setWkDate(d);
    if (d) setWkDay(WEEKDAYS[new Date(d + "T00:00:00").getDay()]);
  };

  const inningsData = match.innings.map((inn, i) => {
    const bt = teams.find((t) => t.id === inn.battingTeamId);
    const bowlT = teams.find((t) => t.id === inn.bowlingTeamId);
    const target = i === 1 ? inn.target : null;
    const st = computeInningsState(inn, bt.players.length, match.oversLimit, target);
    const oversFaced = st.legalBalls / 6;
    const runRate = oversFaced > 0 ? (st.totalRuns / oversFaced).toFixed(2) : "0.00";
    return { i, inn, bt, bowlT, st, runRate };
  });

  return (
    <div className="min-h-full pb-8" style={{ background: C.cream }}>
      <TopBar title="Scorecard" onBack={() => go("home")} />
      <div className="mx-4 mt-4 rounded-xl p-4 text-center" style={{ background: C.pitch }}>
        <Flag size={20} className="inline mb-1" style={{ color: C.gold }} />
        <div className="f-display text-white text-lg">{match.result?.text || "In progress"}</div>
      </div>

      {updateMatchWeeklyInfo && (
        <div className="mx-4 mt-3">
          <button onClick={openWeeklyModal} className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            <span className="f-ui text-xs flex items-center gap-1.5" style={{ color: C.inkSoft }}>
              <Calendar size={13} style={{ color: C.gold }} />
              {match.weekday ? `${match.weekday}${match.venue ? ` · ${match.venue}` : ""}` : "Not in Weekly Cricket"}
            </span>
            <span className="f-ui text-xs font-semibold" style={{ color: C.pitch }}>{match.weekday ? "Edit" : "Add to Weekly Cricket"}</span>
          </button>
        </div>
      )}

      {awards && (awards.bestBatsman || awards.bestBowler || awards.bestFielder || awards.bestPartnership) && (
        <div className="mx-4 mt-3">
          <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>Match Awards</div>
          <div className="space-y-2">
            {awards.bestBatsman && (
              <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.pitch + "22" }}>
                  <Trophy size={16} style={{ color: C.pitch }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="f-ui text-[10px] font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Best Batsman</div>
                  <div className="f-display text-sm truncate" style={{ color: C.ink }}>{awards.bestBatsman.name} <span className="f-ui text-xs" style={{ color: C.inkSoft }}>({teamOf(awards.bestBatsman.teamId)})</span></div>
                </div>
                <div className="f-mono text-sm font-bold text-right" style={{ color: C.pitch }}>{awards.bestBatsman.runs}<span className="text-xs font-normal" style={{ color: C.inkSoft }}> ({awards.bestBatsman.balls}b)</span></div>
              </div>
            )}
            {awards.bestBowler && (
              <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.ball + "22" }}>
                  <Target size={16} style={{ color: C.ball }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="f-ui text-[10px] font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Best Bowler</div>
                  <div className="f-display text-sm truncate" style={{ color: C.ink }}>{awards.bestBowler.name} <span className="f-ui text-xs" style={{ color: C.inkSoft }}>({teamOf(awards.bestBowler.teamId)})</span></div>
                </div>
                <div className="f-mono text-sm font-bold text-right" style={{ color: C.ball }}>{awards.bestBowler.wickets}/{awards.bestBowler.runs}<span className="text-xs font-normal" style={{ color: C.inkSoft }}> ({Math.floor(awards.bestBowler.balls / 6)}.{awards.bestBowler.balls % 6}{awards.bestBowler.maidens ? `, ${awards.bestBowler.maidens}m` : ""})</span></div>
              </div>
            )}
            {awards.bestFielder && (
              <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.gold + "22" }}>
                  <Shield size={16} style={{ color: C.gold }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="f-ui text-[10px] font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Best Fielder</div>
                  <div className="f-display text-sm truncate" style={{ color: C.ink }}>{awards.bestFielder.name} <span className="f-ui text-xs" style={{ color: C.inkSoft }}>({teamOf(awards.bestFielder.teamId)})</span></div>
                </div>
                <div className="f-mono text-sm font-bold text-right" style={{ color: C.gold }}>{awards.bestFielder.credits} dismissal{awards.bestFielder.credits !== 1 ? "s" : ""}</div>
              </div>
            )}
            {awards.bestPartnership && (
              <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.pitchDark + "22" }}>
                  <Users size={16} style={{ color: C.pitchDark }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="f-ui text-[10px] font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Best Partnership</div>
                  <div className="f-display text-sm truncate" style={{ color: C.ink }}>{awards.bestPartnership.name1} & {awards.bestPartnership.name2} <span className="f-ui text-xs" style={{ color: C.inkSoft }}>({teamOf(awards.bestPartnership.teamId)})</span></div>
                </div>
                <div className="f-mono text-sm font-bold text-right" style={{ color: C.pitchDark }}>{awards.bestPartnership.runs}{awards.bestPartnership.unbeaten ? "*" : ""}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mx-4 mt-4 flex gap-2">
        {[["overview", "Overview"], ["scorecard", "Scorecard"]].map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className="flex-1 f-ui text-sm py-2 rounded-md stamp-btn"
            style={{ background: tab === v ? C.pitch : C.paper, color: tab === v ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && inningsData.map(({ i, bt, bowlT, st, runRate }) => (
        <div key={i} className="mx-4 mt-4">
          <div className="f-display text-base mb-1" style={{ color: C.ink }}>{bt.name} — {st.totalRuns}/{st.wickets} <span className="f-ui text-sm" style={{ color: C.inkSoft }}>({st.oversStr} ov)</span></div>
          <div className="f-ui text-xs mb-3" style={{ color: C.inkSoft }}>Run rate: <span className="f-mono font-semibold" style={{ color: C.pitch }}>{runRate}</span></div>

          <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>Fall of Wickets</div>
          <div className="rounded-xl overflow-hidden mb-3" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            {st.fallOfWickets.length === 0 && <div className="p-3 f-ui text-xs" style={{ color: C.inkSoft }}>No wickets fell.</div>}
            {st.fallOfWickets.map((fow, wi) => {
              const name = bt.players.find((p) => p.id === fow.batsmanId)?.name || "?";
              return (
                <div key={wi} className="flex items-center justify-between px-3 py-2 f-ui text-xs" style={{ borderTop: wi === 0 ? "none" : `1px solid ${C.line}` }}>
                  <span style={{ color: C.ink }}>{fow.wicketNumber}. {name}</span>
                  <span className="f-mono" style={{ color: C.inkSoft }}>{fow.score}-{fow.wicketNumber} ({fow.oversStr})</span>
                </div>
              );
            })}
          </div>

          <div className="f-ui text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft }}>Partnerships</div>
          <div className="rounded-xl overflow-hidden mb-3" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            {st.partnerships.length === 0 && <div className="p-3 f-ui text-xs" style={{ color: C.inkSoft }}>No completed partnerships.</div>}
            {st.partnerships.map((pt, pi) => {
              const n1 = bt.players.find((p) => p.id === pt.batsman1)?.name || "?";
              const n2 = bt.players.find((p) => p.id === pt.batsman2)?.name || "?";
              return (
                <div key={pi} className="flex items-center justify-between px-3 py-2 f-ui text-xs" style={{ borderTop: pi === 0 ? "none" : `1px solid ${C.line}` }}>
                  <span style={{ color: C.ink }}>{n1} & {n2}</span>
                  <span className="f-mono font-semibold" style={{ color: C.pitch }}>{pt.runs}{pt.unbeaten ? "*" : ""}</span>
                </div>
              );
            })}
          </div>

          <button onClick={() => setOpenExtras((o) => ({ ...o, [i]: !o[i] }))}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg stamp-btn" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            <span className="f-ui text-xs" style={{ color: C.inkSoft }}>Extras: <span className="f-mono font-semibold" style={{ color: C.ink }}>{extrasTotal(st.extras)}</span></span>
            <span className="f-ui text-xs font-semibold" style={{ color: C.pitch }}>{openExtras[i] ? "Hide" : "Breakdown"}</span>
          </button>
          {openExtras[i] && <div className="mt-3"><ExtrasBreakdown extras={st.extras} /></div>}
        </div>
      ))}

      {tab === "scorecard" && inningsData.map(({ i, bt, bowlT, st }) => (
        <div key={i} className="mx-4 mt-4">
          <div className="f-display text-base mb-2" style={{ color: C.ink }}>{bt.name} — {st.totalRuns}/{st.wickets} <span className="f-ui text-sm" style={{ color: C.inkSoft }}>({st.oversStr} ov)</span></div>
          <div className="rounded-xl overflow-hidden mb-3" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            <div className="grid grid-cols-[1fr,36px,36px,32px,32px,44px] px-3 py-1.5 f-ui text-[10px] font-bold uppercase" style={{ color: C.inkSoft, borderBottom: `1px solid ${C.line}` }}>
              <div>Batter</div><div className="text-center">R</div><div className="text-center">B</div><div className="text-center">4s</div><div className="text-center">6s</div><div className="text-center">SR</div>
            </div>
            {st.battingOrder.map((id) => {
              const s = st.batsmanStats[id];
              const name = bt.players.find((p) => p.id === id)?.name;
              return (
                <div key={id} className="grid grid-cols-[1fr,36px,36px,32px,32px,44px] px-3 py-1.5 items-center f-mono text-xs" style={{ borderTop: `1px solid ${C.line}` }}>
                  <div className="f-ui truncate" style={{ color: C.ink }}>{name}<span className="block text-[10px]" style={{ color: C.inkSoft }}>{s.out ? `${s.howOut}${s.fielder ? ` (${s.fielder})` : ""}` : (st.retiredPlayers.includes(id) ? "retired hurt" : "not out")}</span></div>
                  <div className="text-center font-semibold">{s.runs}</div>
                  <div className="text-center">{s.balls}</div>
                  <div className="text-center">{s.fours}</div>
                  <div className="text-center">{s.sixes}</div>
                  <div className="text-center">{fmtSR(s.runs, s.balls)}</div>
                </div>
              );
            })}
          </div>
          <div className="rounded-xl overflow-hidden" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
            <div className="grid grid-cols-[1fr,36px,36px,36px,44px] px-3 py-1.5 f-ui text-[10px] font-bold uppercase" style={{ color: C.inkSoft, borderBottom: `1px solid ${C.line}` }}>
              <div>Bowler</div><div className="text-center">O</div><div className="text-center">R</div><div className="text-center">W</div><div className="text-center">Econ</div>
            </div>
            {Object.entries(st.bowlerStats).map(([id, s]) => {
              const name = bowlT.players.find((p) => p.id === id)?.name;
              return (
                <div key={id} className="grid grid-cols-[1fr,36px,36px,36px,44px] px-3 py-1.5 items-center f-mono text-xs" style={{ borderTop: `1px solid ${C.line}` }}>
                  <div className="f-ui truncate" style={{ color: C.ink }}>{name}</div>
                  <div className="text-center">{Math.floor(s.balls / 6)}.{s.balls % 6}</div>
                  <div className="text-center">{s.runs}</div>
                  <div className="text-center font-semibold">{s.wickets}</div>
                  <div className="text-center">{fmtEcon(s.runs, s.balls)}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {deleteMatch && (
        <div className="mx-4 mt-6">
          <button onClick={() => setConfirmDelete(true)} className="f-ui text-xs" style={{ color: C.ball }}>Delete this match</button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Match"
          message="This permanently removes the match and its scorecard. This can't be undone."
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { deleteMatch(match.id); setConfirmDelete(false); go("home"); }}
        />
      )}

      {weeklyModal && (
        <Modal title="Weekly Cricket" onClose={() => setWeeklyModal(false)}>
          <div className="f-ui text-xs mb-3" style={{ color: C.inkSoft }}>Tag this match with a day and venue to have it show up in Weekly Cricket, whether it just happened or happened a while ago.</div>
          <Field label="Date">
            <TextInput type="date" value={wkDate} onChange={(e) => setWkDateAndDay(e.target.value)} />
          </Field>
          <Field label="Day of the week">
            <div className="grid grid-cols-4 gap-1.5">
              {WEEKDAYS.map((d) => (
                <button key={d} onClick={() => setWkDay(d)} className="f-ui text-[11px] py-2 rounded-md stamp-btn"
                  style={{ background: wkDay === d ? C.pitch : C.paper, color: wkDay === d ? "#fff" : C.ink, border: `1.5px solid ${C.line}` }}>
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Venue">
            <TextInput value={wkVenue} onChange={(e) => setWkVenue(e.target.value)} placeholder="e.g. Riverside Ground, Net 2" />
          </Field>
          <Btn className="w-full" onClick={() => { updateMatchWeeklyInfo(match.id, { weekday: wkDay, matchDate: wkDate, venue: wkVenue }); setWeeklyModal(false); }}>Save</Btn>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------- APP ---------------------------------- */

export default function CricketApp({ onLogout, userEmail, role, supabaseClient, linkedPlayerName, setLinkedPlayerName }) {
  const isAdmin = role === "admin";
  const isScorer = role === "scorer" || role === "admin";
  const [screen, setScreen] = useState("home");
  const [teams, setTeams] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [matches, setMatches] = useState([]);
  const [playerPool, setPlayerPool] = useState([]);
  const [currentMatchId, setCurrentMatchId] = useState(null);
  const [presetCategory, setPresetCategory] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [t, tn, m, pp] = await Promise.all([loadKey("teams", []), loadKey("tournaments", []), loadKey("matches", []), loadKey("playerPool", buildDefaultPool())]);
      setTeams(t); setTournaments(tn); setMatches(m); setPlayerPool(pp); setLoaded(true);
    })();
  }, []);
  useEffect(() => { if (loaded) saveKey("teams", teams); }, [teams, loaded]);
  useEffect(() => { if (loaded) saveKey("tournaments", tournaments); }, [tournaments, loaded]);
  useEffect(() => { if (loaded) saveKey("matches", matches); }, [matches, loaded]);
  useEffect(() => { if (loaded) saveKey("playerPool", playerPool); }, [playerPool, loaded]);

  const go = (s) => setScreen(s);
  go.setMatch = (id) => setCurrentMatchId(id);
  go.setPresetCategory = (c) => setPresetCategory(c);

  const createMatch = ({ tournamentId, category, weekday, matchDate, venue, teamAId, teamBId, oversLimit, maxOversPerBowler, tossWinnerId, tossChoice }) => {
    const todayISO = new Date().toISOString().slice(0, 10);
    const isFutureScheduled = category === "weekly" && matchDate && matchDate > todayISO;
    const id = uid();
    let innings0;
    if (isFutureScheduled) {
      innings0 = { battingTeamId: null, bowlingTeamId: null, events: [], openers: { striker: null, nonStriker: null, bowler: null }, target: null, currentKeeperId: null };
    } else {
      const battingFirst = tossChoice === "bat" ? tossWinnerId : (tossWinnerId === teamAId ? teamBId : teamAId);
      const bowlingFirst = battingFirst === teamAId ? teamBId : teamAId;
      innings0 = { battingTeamId: battingFirst, bowlingTeamId: bowlingFirst, events: [], openers: { striker: null, nonStriker: null, bowler: null }, target: null, currentKeeperId: null };
    }
    const match = {
      id, tournamentId, category: category || "standalone", weekday: weekday || null, matchDate: matchDate || null, venue: venue || null,
      createdAt: matchDate || todayISO,
      teamAId, teamBId, oversLimit, maxOversPerBowler, tossWinnerId: isFutureScheduled ? null : tossWinnerId, tossChoice: isFutureScheduled ? null : tossChoice,
      status: isFutureScheduled ? "scheduled" : "live", currentInnings: 0,
      innings: [innings0],
      result: null,
    };
    setMatches((ms) => [...ms, match]);
    setCurrentMatchId(id);
    return match;
  };

  const startScheduledMatch = (matchId, tossWinnerId, tossChoice) => {
    setMatches((ms) => ms.map((m) => {
      if (m.id !== matchId) return m;
      const battingFirst = tossChoice === "bat" ? tossWinnerId : (tossWinnerId === m.teamAId ? m.teamBId : m.teamAId);
      const bowlingFirst = battingFirst === m.teamAId ? m.teamBId : m.teamAId;
      const innings = m.innings.map((inn, i) => i === 0 ? { ...inn, battingTeamId: battingFirst, bowlingTeamId: bowlingFirst } : inn);
      return { ...m, status: "live", tossWinnerId, tossChoice, innings };
    }));
    setCurrentMatchId(matchId);
  };

  const setOpeners = (inningsIdx, openers) => {
    setMatches((ms) => ms.map((m) => {
      if (m.id !== currentMatchId) return m;
      const innings = m.innings.map((inn, i) => i === inningsIdx ? { ...inn, openers } : inn);
      return { ...m, innings };
    }));
  };

  const setKeeperOverride = (inningsIdx, playerId) => {
    setMatches((ms) => ms.map((m) => {
      if (m.id !== currentMatchId) return m;
      const innings = m.innings.map((inn, i) => i === inningsIdx ? { ...inn, currentKeeperId: playerId } : inn);
      return { ...m, innings };
    }));
  };

  const appendEvent = (inningsIdx, event) => {
    setMatches((ms) => ms.map((m) => {
      if (m.id !== currentMatchId) return m;
      const innings = m.innings.map((inn, i) => i === inningsIdx ? { ...inn, events: [...inn.events, event] } : inn);
      let newMatch = { ...m, innings };

      const inn = innings[inningsIdx];
      const battingTeam = teams.find((t) => t.id === inn.battingTeamId);
      const target = inningsIdx === 1 ? inn.target : null;
      const st = computeInningsState(inn, battingTeam.players.length, m.oversLimit, target);

      if (st.complete) {
        if (inningsIdx === 0) {
          newMatch.innings = [...innings, {
            battingTeamId: inn.bowlingTeamId, bowlingTeamId: inn.battingTeamId,
            events: [], openers: { striker: null, nonStriker: null, bowler: null }, target: st.totalRuns + 1, currentKeeperId: null,
          }];
          newMatch.currentInnings = 1;
        } else {
          const inn1 = innings[0];
          const bt1 = teams.find((t) => t.id === inn1.battingTeamId);
          const st1 = computeInningsState(inn1, bt1.players.length, m.oversLimit, null);
          const team1Name = teams.find((t) => t.id === inn1.battingTeamId)?.name;
          const team2Id = inn.battingTeamId;
          const team2Name = teams.find((t) => t.id === team2Id)?.name;
          let text, winnerTeamId;
          if (st.totalRuns > st1.totalRuns) {
            const wLeft = st.maxWickets - st.wickets;
            text = `${team2Name} won by ${wLeft} wicket${wLeft !== 1 ? "s" : ""}`;
            winnerTeamId = team2Id;
          } else if (st1.totalRuns > st.totalRuns) {
            const diff = st1.totalRuns - st.totalRuns;
            text = `${team1Name} won by ${diff} run${diff !== 1 ? "s" : ""}`;
            winnerTeamId = inn1.battingTeamId;
          } else {
            text = "Match tied"; winnerTeamId = null;
          }
          newMatch.status = "completed";
          newMatch.result = { text, winnerTeamId };
        }
      }
      return newMatch;
    }));
  };

  const undoLast = (inningsIdx) => {
    setMatches((ms) => ms.map((m) => {
      if (m.id !== currentMatchId) return m;
      const innings = m.innings.map((inn, i) => i === inningsIdx ? { ...inn, events: inn.events.slice(0, -1) } : inn);
      return { ...m, innings };
    }));
  };

  const deleteMatch = (matchId) => {
    setMatches((ms) => ms.filter((m) => m.id !== matchId));
    if (currentMatchId === matchId) setCurrentMatchId(null);
  };

  const deleteTournament = (tournamentId) => {
    setTournaments((ts) => ts.filter((t) => t.id !== tournamentId));
    setMatches((ms) => ms.map((m) => m.tournamentId === tournamentId ? { ...m, tournamentId: null } : m));
  };

  const updateMatchOvers = (matchId, newOversLimit) => {
    setMatches((ms) => ms.map((m) => m.id === matchId ? { ...m, oversLimit: newOversLimit } : m));
  };

  const updateMatchWeeklyInfo = (matchId, { weekday, matchDate, venue }) => {
    setMatches((ms) => ms.map((m) => m.id === matchId ? { ...m, weekday, matchDate, venue } : m));
  };

  const currentMatch = matches.find((m) => m.id === currentMatchId) || null;

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: C.cream }}><div className="f-display" style={{ color: C.pitch }}>Loading…</div></div>;
  }

  return (
    <div className="min-h-screen w-full" style={{ background: C.cream }}>
      {FONTS}
      <div className="max-w-md mx-auto min-h-screen" style={{ background: C.cream, boxShadow: "0 0 40px rgba(0,0,0,0.06)" }}>
        {screen === "home" && <HomeScreen teams={teams} matches={matches} tournaments={tournaments} playerPool={playerPool} go={go} onLogout={onLogout} userEmail={userEmail} isScorer={isScorer} isAdmin={isAdmin} deleteMatch={isAdmin ? deleteMatch : null} supabaseClient={supabaseClient} linkedPlayerName={linkedPlayerName} setLinkedPlayerName={setLinkedPlayerName} />}
        {screen === "manageAccess" && <ManageAccessScreen supabaseClient={supabaseClient} userEmail={userEmail} go={go} />}
        {screen === "teams" && <TeamsScreen teams={teams} setTeams={setTeams} playerPool={playerPool} setPlayerPool={setPlayerPool} isScorer={isScorer} go={go} />}
        {screen === "tournaments" && <TournamentsScreen teams={teams} tournaments={tournaments} setTournaments={setTournaments} matches={matches} deleteTournament={isAdmin ? deleteTournament : null} deleteMatch={isAdmin ? deleteMatch : null} isScorer={isScorer} go={go} />}
        {screen === "weekly" && <WeeklyScreen teams={teams} matches={matches} startScheduledMatch={startScheduledMatch} deleteMatch={isAdmin ? deleteMatch : null} isScorer={isScorer} go={go} />}
        {screen === "playerStats" && <PlayerStatsScreen matches={matches} teams={teams} go={go} />}
        {screen === "matchHistory" && <MatchHistoryScreen matches={matches} teams={teams} go={go} />}
        {screen === "newMatch" && <NewMatchScreen teams={teams} tournaments={tournaments} createMatch={createMatch} presetCategory={presetCategory} isScorer={isScorer} go={go} />}
        {screen === "live" && <LiveScreen match={currentMatch} teams={teams} appendEvent={appendEvent} setOpeners={setOpeners} setKeeperOverride={setKeeperOverride} undoLast={undoLast} deleteMatch={isAdmin ? deleteMatch : null} updateMatchOvers={isScorer ? updateMatchOvers : null} isScorer={isScorer} go={go} />}
        {screen === "summary" && <SummaryScreen match={currentMatch} teams={teams} deleteMatch={isAdmin ? deleteMatch : null} updateMatchWeeklyInfo={isScorer ? updateMatchWeeklyInfo : null} go={go} />}
      </div>
    </div>
  );
}
