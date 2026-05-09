// Lottery weights — same buckets as the original Python script (cumulative-threshold deltas).
// Lower-finishing teams get bigger weight (better odds at the top picks).
const POSITIONS = [
  { label: "seventh", finish: 7, weight: 40 },
  { label: "eighth", finish: 8, weight: 70 },
  { label: "ninth", finish: 9, weight: 107 },
  { label: "tenth", finish: 10, weight: 143 },
  { label: "eleventh", finish: 11, weight: 267 },
  { label: "twelfth", finish: 12, weight: 373 },
];

// ±3 cap: a team's actual pick can't differ from their default position (13 - finish) by more than this.
// 12th can only land in picks 1–4; 7th can only land in picks 3–6.
const MAX_DRIFT = 3;

const ORDINAL_SUFFIX = {
  7: "th",
  8: "th",
  9: "th",
  10: "th",
  11: "th",
  12: "th",
};

const teamData = {};
const playoffPicks = [];
const pickOwnerByRosterId = new Map();

// --- Live sync state (Firebase Realtime Database) ---
const liveSyncSearch = new URLSearchParams(window.location.search);
const isHost = liveSyncSearch.has("host");
const liveRoomId = window.lotteryRoomId || "default";
const liveInstanceId = Math.random().toString(36).slice(2);
let liveDb = null;
let presenceRef = null;

let appliedSetupAt = 0;
let appliedSessionAt = 0;
let appliedRevealedCount = 0;
let activeOrder = null;
// Becomes true once the viewer has processed at least one revealedCount snapshot.
// Until then, any catch-up is "initial sync" (snap, no animation) rather than live (animate).
let initialRevealedSyncDone = false;

function ordinal(n) {
  return `${n}${ORDINAL_SUFFIX[n] ?? "th"}`;
}

function defaultPickForFinish(finish) {
  return 13 - finish;
}

function isFinishEligibleForPick(finish, pickNum) {
  return Math.abs(pickNum - defaultPickForFinish(finish)) <= MAX_DRIFT;
}

function eligibilityForPick(pickNum) {
  return POSITIONS.filter((p) => isFinishEligibleForPick(p.finish, pickNum));
}

function weightedPick(pool) {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of pool) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return pool[pool.length - 1];
}

function tryLottery() {
  const order = [];
  const drawn = new Set();
  for (let pickNum = 1; pickNum <= 6; pickNum++) {
    const pool = eligibilityForPick(pickNum).filter((p) => !drawn.has(p.finish));
    if (!pool.length) return null;
    const chosen = weightedPick(pool);
    order.push(chosen);
    drawn.add(chosen.finish);
  }
  return order;
}

function runLottery() {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const result = tryLottery();
    if (result) return result;
  }
  throw new Error("Lottery infeasible after 1000 attempts.");
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function formatWorstWeek(worst) {
  if (!worst || worst.points == null) return null;
  const opp = worst.opponentName ? ` vs @${worst.opponentName}` : "";
  return `Worst: W${worst.week} • ${worst.points.toFixed(2)}${opp}`;
}

function renderTeamInputs() {
  const grid = document.getElementById("teams-grid");
  clearChildren(grid);
  for (const p of POSITIONS) {
    const data = teamData[p.finish];
    const row = document.createElement("label");
    row.className = "team-row";

    const place = document.createElement("span");
    place.className = "place";
    place.textContent = ordinal(p.finish);
    row.appendChild(place);

    if (data?.avatarUrl) {
      const img = document.createElement("img");
      img.className = "team-avatar";
      img.src = data.avatarUrl;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => img.remove());
      row.appendChild(img);
    }

    const fields = document.createElement("div");
    fields.className = "team-fields";

    const input = document.createElement("input");
    input.type = "text";
    input.dataset.finish = String(p.finish);
    input.placeholder = `Team that finished ${ordinal(p.finish)}`;
    if (data?.name) input.value = data.name;
    fields.appendChild(input);

    const metaParts = [];
    if (data?.ownerName) metaParts.push(`@${data.ownerName}`);
    if (data?.maxPf != null) metaParts.push(`Max PF ${data.maxPf.toFixed(2)}`);
    if (metaParts.length) {
      const meta = document.createElement("span");
      meta.className = "team-owner";
      meta.textContent = metaParts.join(" • ");
      fields.appendChild(meta);
    }
    // Worst week is intentionally NOT shown here — only during the ball-draw overlay.

    row.appendChild(fields);
    grid.appendChild(row);
  }
}

function renderOddsTable() {
  const body = document.getElementById("odds-body");
  clearChildren(body);
  const total = POSITIONS.reduce((s, p) => s + p.weight, 0);
  for (const p of POSITIONS) {
    const odds = ((p.weight / total) * 100).toFixed(1);
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = ordinal(p.finish);
    const tdOdds = document.createElement("td");
    tdOdds.textContent = `${odds}%`;
    tr.appendChild(tdName);
    tr.appendChild(tdOdds);
    body.appendChild(tr);
  }
}

function getTeams() {
  const teams = {};
  for (const input of document.querySelectorAll("#teams-grid input")) {
    const finish = Number(input.dataset.finish);
    const data = teamData[finish] || {};
    const name = input.value.trim() || data.name || `Team ${ordinal(finish)}`;
    teams[finish] = {
      name,
      ownerName: data.ownerName || null,
      avatarUrl: data.avatarUrl || null,
      maxPf: data.maxPf ?? null,
      rosterId: data.rosterId ?? null,
      worstWeek: data.worstWeek || null,
    };
  }
  return teams;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPlaceholderSlots(count) {
  const list = document.getElementById("results-list");
  clearChildren(list);
  const slots = [];
  for (let i = 0; i < count; i++) {
    const li = document.createElement("li");
    li.className = "pick-slot pending";
    if (i === 0) li.classList.add("first");

    const num = document.createElement("span");
    num.className = "pick-num";
    num.textContent = String(i + 1);
    li.appendChild(num);

    const fields = document.createElement("div");
    fields.className = "pick-fields";
    const name = document.createElement("span");
    name.className = "team-name rolling";
    name.textContent = "—";
    fields.appendChild(name);
    li.appendChild(fields);

    const from = document.createElement("span");
    from.className = "from";
    li.appendChild(from);

    list.appendChild(li);
    slots.push(li);
  }
  return slots;
}

async function rollSlot(slot, allNames, duration) {
  const nameEl = slot.querySelector(".team-name");
  let elapsed = 0;
  let lastIdx = -1;
  while (elapsed < duration) {
    const remaining = duration - elapsed;
    const interval = remaining < 700 ? 60 + (700 - remaining) * 0.45 : 60;
    let idx = Math.floor(Math.random() * allNames.length);
    if (idx === lastIdx && allNames.length > 1) {
      idx = (idx + 1) % allNames.length;
    }
    lastIdx = idx;
    nameEl.textContent = allNames[idx];
    await wait(interval);
    elapsed += interval;
  }
}

function setupLotteryMachine() {
  const machine = document.getElementById("lottery-machine");
  const tumbler = document.getElementById("machine-tumbler");
  machine.hidden = false;
  machine.classList.remove("fading");
  clearChildren(tumbler);
  hideWorstWeekOverlay();
}

function createBall(p) {
  const ball = document.createElement("div");
  ball.className = "ball";
  ball.dataset.finish = String(p.finish);

  const x = 4 + Math.random() * 80;
  const y = 8 + Math.random() * 70;
  ball.style.left = `${x}%`;
  ball.style.top = `${y}%`;

  const dx = (Math.random() - 0.5) * 36;
  const dy = (Math.random() - 0.5) * 28;
  ball.style.setProperty("--ball-dx", `${dx}px`);
  ball.style.setProperty("--ball-dy", `${dy}px`);
  ball.style.animationDuration = `${1.2 + Math.random() * 1.1}s`;
  ball.style.animationDelay = `${(-Math.random() * 2).toFixed(2)}s`;

  ball.textContent = ordinal(p.finish);
  return ball;
}

function probDrawnLast(targetFinish, pool) {
  if (pool.length === 1) {
    return pool[0].finish === targetFinish ? 1 : 0;
  }
  let prob = 0;
  const totalWeight = pool.reduce((s, p) => s + p.weight, 0);
  for (const p of pool) {
    if (p.finish === targetFinish) continue;
    const pFirst = p.weight / totalWeight;
    const remaining = pool.filter((x) => x.finish !== p.finish);
    prob += pFirst * probDrawnLast(targetFinish, remaining);
  }
  return prob;
}

function computePickOdds(pool) {
  return pool.map((p) => ({
    finish: p.finish,
    weight: p.weight,
    label: p.label,
    prob: probDrawnLast(p.finish, pool),
  }));
}

function populateTumbler(pool) {
  const tumbler = document.getElementById("machine-tumbler");
  clearChildren(tumbler);
  if (!pool.length) return;

  const odds = computePickOdds(pool);
  const targetTotal = pool.length === 1 ? 6 : pool.length * 6;

  for (const o of odds) {
    const count = Math.max(1, Math.round(o.prob * targetTotal));
    for (let i = 0; i < count; i++) {
      tumbler.appendChild(createBall(o));
    }
  }
}

async function drawBall(finishPosition, suspenseDuration, team) {
  const tumbler = document.getElementById("machine-tumbler");
  tumbler.classList.add("shaking");
  await wait(suspenseDuration);
  tumbler.classList.remove("shaking");

  const candidates = tumbler.querySelectorAll(
    `.ball[data-finish="${finishPosition}"]`
  );
  if (candidates.length) {
    const winner = candidates[Math.floor(Math.random() * candidates.length)];
    winner.classList.add("winning");
    await wait(850);
    winner.classList.add("exited");
    // Show the worst-week reveal AFTER the ball flies out so it doesn't obscure the climax.
    showWorstWeekOverlay(team);
  }
}

function showWorstWeekOverlay(team) {
  const overlay = document.getElementById("worst-week-overlay");
  if (!overlay || !team?.worstWeek) return;
  const { points, week, opponentName } = team.worstWeek;
  const headline = document.getElementById("worst-week-headline");
  const pointsEl = document.getElementById("worst-week-points");
  const teamLabel = team.ownerName ? `@${team.ownerName}` : team.name;
  const oppLabel = opponentName ? ` vs @${opponentName}` : "";
  headline.textContent = `${teamLabel} — Week ${week}${oppLabel}`;
  pointsEl.textContent = `${points.toFixed(2)} pts`;
  overlay.hidden = false;
  // Force reflow so transition fires after `hidden` was just removed.
  // eslint-disable-next-line no-unused-expressions
  overlay.offsetWidth;
  overlay.classList.add("shown");
}

function hideWorstWeekOverlay() {
  const overlay = document.getElementById("worst-week-overlay");
  if (!overlay) return;
  overlay.classList.remove("shown");
  setTimeout(() => {
    overlay.hidden = true;
  }, 280);
}

function hideLotteryMachine() {
  const machine = document.getElementById("lottery-machine");
  machine.classList.add("fading");
  setTimeout(() => {
    machine.hidden = true;
  }, 500);
}

function attachAvatar(slot, avatarUrl) {
  if (!avatarUrl) return;
  const img = document.createElement("img");
  img.className = "pick-avatar";
  img.src = avatarUrl;
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => img.remove());
  const fields = slot.querySelector(".pick-fields");
  slot.insertBefore(img, fields);
}

function playoffFromLabel(pick) {
  switch (pick) {
    case 7: return "6th — lower 5/6 PF";
    case 8: return "5th — higher 5/6 PF";
    case 9: return "4th place";
    case 10: return "3rd place";
    case 11: return "runner-up";
    case 12: return "champion";
    default: return "";
  }
}

function fillSlot(slot, team, fromLabel) {
  const nameEl = slot.querySelector(".team-name");
  const fromEl = slot.querySelector(".from");
  const fields = slot.querySelector(".pick-fields");

  for (const el of fields.querySelectorAll(".pick-owner, .pick-traded")) {
    el.remove();
  }
  const existingAvatar = slot.querySelector(".pick-avatar");
  if (existingAvatar) existingAvatar.remove();

  nameEl.classList.remove("rolling");
  nameEl.textContent = team.name;
  fromEl.textContent = fromLabel || "";
  attachAvatar(slot, team.avatarUrl);

  const ownerParts = [];
  if (team.ownerName) ownerParts.push(`@${team.ownerName}`);
  if (team.maxPf != null) ownerParts.push(`Max PF ${team.maxPf.toFixed(2)}`);
  if (ownerParts.length) {
    const owner = document.createElement("span");
    owner.className = "pick-owner";
    owner.textContent = ownerParts.join(" • ");
    fields.appendChild(owner);
  }
  // Worst week intentionally not rendered as a persistent slot line — see overlay-only design.

  if (team.rosterId != null) {
    const tradedTo = pickOwnerByRosterId.get(team.rosterId);
    if (tradedTo) {
      const line = document.createElement("span");
      line.className = "pick-traded";
      const label = tradedTo.ownerName
        ? `Pick owned by @${tradedTo.ownerName}`
        : "Pick has been traded";
      line.textContent = label;
      fields.appendChild(line);
    }
  }

  slot.classList.remove("pending");
  slot.classList.add("revealed");
}

let revealState = null;

function buildRevealStateFromOrder(order) {
  const teams = getTeams();
  const slots = buildPlaceholderSlots(12);

  for (let i = 6; i < 12; i++) {
    const data = playoffPicks[i - 6];
    const slot = slots[i];
    if (data) {
      fillSlot(slot, data, playoffFromLabel(i + 1));
    } else {
      slot.querySelector(".from").textContent = playoffFromLabel(i + 1);
    }
  }

  return {
    order,
    teams,
    slots,
    revealed: new Set(),
    nextPick: 6,
    busy: false,
  };
}

async function startReveal(order) {
  const section = document.getElementById("results");
  section.hidden = false;
  setupLotteryMachine();
  revealState = buildRevealStateFromOrder(order);
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  await wait(400);
  presentNextReveal();
}

// Snap reveals up to alreadyRevealed without animation, then resume live.
async function startRevealAtCount(order, alreadyRevealed) {
  const section = document.getElementById("results");
  section.hidden = false;
  setupLotteryMachine();
  revealState = buildRevealStateFromOrder(order);

  for (let r = 0; r < alreadyRevealed && r < 6; r++) {
    const pickNum = 6 - r;
    const winner = order[pickNum - 1];
    if (!winner) break;
    const team = revealState.teams[winner.finish];
    const slot = revealState.slots[pickNum - 1];
    fillSlot(slot, team, `finished ${ordinal(winner.finish)}`);
    revealState.revealed.add(winner.finish);
    revealState.nextPick = pickNum - 1;
  }

  section.scrollIntoView({ behavior: "smooth", block: "start" });
  await wait(200);

  if (alreadyRevealed >= 6) {
    document.getElementById("draw-status").textContent = "Draft order finalized.";
    const sidebar = document.getElementById("odds-sidebar");
    if (sidebar) sidebar.hidden = true;
    hideLotteryMachine();
    revealState = null;
    return;
  }
  presentNextReveal();
}

function presentNextReveal() {
  if (!revealState) return;
  const pickNum = revealState.nextPick;
  const pool = eligibilityForPick(pickNum).filter(
    (p) => !revealState.revealed.has(p.finish)
  );

  populateTumbler(pool);
  updateOddsSidebar(pickNum, pool);

  const status = document.getElementById("draw-status");
  status.textContent =
    pickNum === 1
      ? "And the #1 pick goes to…"
      : `Click to reveal pick ${pickNum}.`;

  const btn = document.getElementById("reveal-btn");
  if (btn) {
    btn.textContent = pickNum === 1 ? "Reveal pick 1!" : `Reveal pick ${pickNum}`;
    // Only the host sees the reveal button; viewers' UI is driven by remote increments.
    btn.hidden = !isHost;
    btn.disabled = false;
  }
}

async function performRevealAnimation() {
  if (!revealState || revealState.busy) return false;
  revealState.busy = true;
  // Clear the prior pick's worst-week banner now that the next draw is starting.
  hideWorstWeekOverlay();

  const btn = document.getElementById("reveal-btn");
  if (btn) btn.disabled = true;

  const pickNum = revealState.nextPick;
  const winner = revealState.order[pickNum - 1];
  const team = revealState.teams[winner.finish];
  const slot = revealState.slots[pickNum - 1];

  const suspenseDuration = 700 + (6 - pickNum) * 250;

  const allNames = Object.values(revealState.teams)
    .map((t) => t.name)
    .filter(Boolean);

  await Promise.all([
    rollSlot(slot, allNames, suspenseDuration),
    drawBall(winner.finish, suspenseDuration, team),
  ]);

  fillSlot(slot, team, `finished ${ordinal(winner.finish)}`);
  revealState.revealed.add(winner.finish);

  // Worst-week overlay stays up until the next reveal begins (or the machine fades on pick 1).
  if (pickNum === 1) {
    if (btn) btn.hidden = true;
    document.getElementById("draw-status").textContent = "Draft order finalized.";
    const sidebar = document.getElementById("odds-sidebar");
    if (sidebar) sidebar.hidden = true;
    await wait(800);
    hideLotteryMachine();
    revealState = null;
    if (isHost) {
      const resetBtn = document.getElementById("reset-btn");
      if (resetBtn) resetBtn.hidden = false;
      const runBtn = document.getElementById("run-btn");
      if (runBtn) runBtn.textContent = "Lottery Complete";
    }
  } else {
    revealState.nextPick = pickNum - 1;
    revealState.busy = false;
    await wait(700);
    presentNextReveal();
  }
  return true;
}

async function performRevealAsHost() {
  if (!revealState || revealState.busy) return;
  // Publish the new revealedCount BEFORE animating so viewers begin their animation
  // in lockstep (gated only by network latency), not after the host's full ~3s reveal.
  // pick 6 → revealedCount 1; pick 5 → 2; ...
  const newCount = 7 - revealState.nextPick;
  appliedRevealedCount = newCount;
  publishRevealedCount(newCount);
  await performRevealAnimation();
}

function updateOddsSidebar(pickNum, pool) {
  const sidebar = document.getElementById("odds-sidebar");
  const list = document.getElementById("odds-sidebar-list");
  const numEl = document.getElementById("odds-pick-num");
  if (!sidebar || !list || !numEl) return;

  numEl.textContent = String(pickNum);
  clearChildren(list);

  if (!pool.length) {
    sidebar.hidden = true;
    return;
  }

  const odds = computePickOdds(pool);
  const sorted = [...odds].sort((a, b) => b.prob - a.prob);

  for (const o of sorted) {
    const pct = o.prob * 100;
    const teamName = revealState?.teams?.[o.finish]?.name || ordinal(o.finish);

    const li = document.createElement("li");
    li.className = "odds-row";
    li.dataset.finish = String(o.finish);

    const swatch = document.createElement("span");
    swatch.className = `odds-swatch swatch-${o.finish}`;
    li.appendChild(swatch);

    const label = document.createElement("span");
    label.className = "odds-label";
    label.textContent = teamName;
    li.appendChild(label);

    const bar = document.createElement("span");
    bar.className = "odds-bar";
    const fill = document.createElement("span");
    fill.className = "odds-bar-fill";
    fill.style.width = `${pct.toFixed(1)}%`;
    bar.appendChild(fill);
    li.appendChild(bar);

    const pctEl = document.createElement("span");
    pctEl.className = "odds-pct";
    pctEl.textContent = pct >= 99.5 ? "100%" : `${pct.toFixed(0)}%`;
    li.appendChild(pctEl);

    list.appendChild(li);
  }

  sidebar.hidden = false;
}

async function handleSleeperResponse(res) {
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("League not found. Double-check the ID.");
    }
    throw new Error(`Sleeper API error (${res.status}).`);
  }
  return res.json();
}

function buildAvatarUrl(user) {
  const customAvatar = user.metadata && user.metadata.avatar;
  if (customAvatar && /^https?:\/\//i.test(customAvatar)) return customAvatar;
  if (user.avatar) return `https://sleepercdn.com/avatars/thumbs/${user.avatar}`;
  return null;
}

function computePlayoffOrder(bracket, rosterById) {
  const out = [null, null, null, null, null, null];
  if (!Array.isArray(bracket)) return out;

  for (const m of bracket) {
    if (m.p === 1) {
      out[5] = rosterById.get(m.w) || null;
      out[4] = rosterById.get(m.l) || null;
    } else if (m.p === 3) {
      out[3] = rosterById.get(m.w) || null;
      out[2] = rosterById.get(m.l) || null;
    } else if (m.p === 5) {
      const t1 = m.t1 != null ? rosterById.get(m.t1) : null;
      const t2 = m.t2 != null ? rosterById.get(m.t2) : null;
      if (t1 && t2) {
        const [higher, lower] =
          t1.maxPf >= t2.maxPf ? [t1, t2] : [t2, t1];
        out[1] = higher;
        out[0] = lower;
      } else if (t1 || t2) {
        out[1] = t1 || t2;
      }
    }
  }

  return out;
}

function buildPickOwnerMap(tradedPicks, season, rosterById) {
  pickOwnerByRosterId.clear();
  if (!Array.isArray(tradedPicks)) return;

  const relevant = tradedPicks.filter(
    (tp) => tp.round === 1 && String(tp.season) === season
  );
  if (!relevant.length) return;

  const tradesByOriginal = new Map();
  for (const tp of relevant) {
    if (!tradesByOriginal.has(tp.roster_id)) tradesByOriginal.set(tp.roster_id, []);
    tradesByOriginal.get(tp.roster_id).push(tp);
  }

  for (const [originalRosterId, trades] of tradesByOriginal) {
    let current = originalRosterId;
    let progressed = true;
    let safety = trades.length + 1;
    while (progressed && safety-- > 0) {
      progressed = false;
      for (const tp of trades) {
        if (tp.previous_owner_id === current) {
          current = tp.owner_id;
          progressed = true;
          break;
        }
      }
    }
    if (current !== originalRosterId) {
      const newOwner = rosterById.get(current);
      if (newOwner) {
        pickOwnerByRosterId.set(originalRosterId, {
          ownerName: newOwner.ownerName,
          avatarUrl: newOwner.avatarUrl,
          teamName: newOwner.teamName,
        });
      }
    }
  }
}

// Pulls weekly matchups for each regular-season week and computes each roster's lowest score.
// Sleeper returns matchups as [{matchup_id, roster_id, points, ...}]; opponents share matchup_id.
async function fetchWorstWeeks(leagueId, league, rosterById) {
  const playoffStart = league?.settings?.playoff_week_start ?? 15;
  const lastRegular = Math.max(0, playoffStart - 1);
  if (!lastRegular) return new Map();

  const base = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}`;
  const weeks = Array.from({ length: lastRegular }, (_, i) => i + 1);

  const responses = await Promise.all(
    weeks.map((w) =>
      fetch(`${base}/matchups/${w}`).then((r) => (r.ok ? r.json() : []))
    )
  );

  const worst = new Map();

  responses.forEach((matchups, idx) => {
    if (!Array.isArray(matchups)) return;
    const week = idx + 1;

    const byMatchupId = new Map();
    for (const m of matchups) {
      if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
      byMatchupId.get(m.matchup_id).push(m);
    }

    for (const m of matchups) {
      const points = m.points ?? 0;
      // Skip unplayed weeks (Sleeper reports 0 for not-yet-played).
      if (points <= 0) continue;

      const pair = byMatchupId.get(m.matchup_id) || [];
      const opp = pair.find((x) => x.roster_id !== m.roster_id);
      const oppRoster = opp ? rosterById.get(opp.roster_id) : null;

      const prev = worst.get(m.roster_id);
      if (!prev || points < prev.points) {
        worst.set(m.roster_id, {
          points,
          week,
          opponentRosterId: opp?.roster_id ?? null,
          opponentName: oppRoster?.ownerName || null,
        });
      }
    }
  });

  return worst;
}

// --- Firebase live sync ---

function isFirebaseConfigured() {
  const c = window.firebaseConfig;
  if (!c || typeof firebase === "undefined") return false;
  if (!c.apiKey || c.apiKey.startsWith("YOUR_")) return false;
  if (!c.databaseURL || c.databaseURL.includes("YOUR_PROJECT")) return false;
  return true;
}

function roomRef(path) {
  return liveDb.ref(`lottery/${liveRoomId}/${path}`);
}

function initLiveSync() {
  if (!isFirebaseConfigured()) return;
  try {
    firebase.initializeApp(window.firebaseConfig);
    liveDb = firebase.database();
  } catch (err) {
    console.warn("Firebase init failed:", err);
    return;
  }

  const status = document.getElementById("live-status");
  const indicator = document.getElementById("live-indicator");
  if (status) status.hidden = false;
  if (indicator) indicator.textContent = isHost ? "Live · Host" : "Live · Viewer";

  if (!isHost) {
    document.body.classList.add("viewer-mode");
    const waiting = document.getElementById("waiting-card");
    if (waiting) waiting.hidden = false;
  }

  setupPresence();
  watchPresence();

  roomRef("setup").on("value", (snap) => {
    const data = snap.val();
    if (data) handleRemoteSetup(data);
  });

  roomRef("session").on("value", (snap) => {
    const data = snap.val();
    if (data) {
      handleRemoteSession(data);
    } else if (appliedSessionAt > 0) {
      // Session was cleared (host reset). Clear the viewer's reveal UI.
      handleSessionCleared();
    }
  });

  roomRef("revealedCount").on("value", (snap) => {
    const n = snap.val() ?? 0;
    handleRemoteRevealedCount(n);
  });
}

function setupPresence() {
  presenceRef = liveDb.ref(`presence/${liveRoomId}/${liveInstanceId}`);
  presenceRef.onDisconnect().remove();

  // Re-establish on reconnect (e.g., wake from sleep, transient drop).
  liveDb.ref(".info/connected").on("value", (snap) => {
    if (snap.val() !== true) return;
    presenceRef.onDisconnect().remove();
    presenceRef.set({
      role: isHost ? "host" : "viewer",
      joinedAt: firebase.database.ServerValue.TIMESTAMP,
    });
  });
}

function watchPresence() {
  const chip = document.getElementById("watching-chip");
  const countEl = document.getElementById("watching-count");
  if (!chip || !countEl) return;

  liveDb.ref(`presence/${liveRoomId}`).on("value", (snap) => {
    const data = snap.val() || {};
    const count = Object.keys(data).length;
    countEl.textContent = String(count);
    chip.hidden = count === 0;
  });
}

function publishSetup() {
  if (!liveDb || !isHost) return;
  const payload = {
    publishedAt: firebase.database.ServerValue.TIMESTAMP,
    teamData: { ...teamData },
    playoffPicks: playoffPicks.map((p) => p || null),
    pickOwners: Object.fromEntries(
      Array.from(pickOwnerByRosterId.entries()).map(([k, v]) => [String(k), v])
    ),
  };
  roomRef("setup").set(payload).catch((err) => {
    console.warn("Failed to publish setup:", err);
  });
}

function publishSession(order) {
  if (!liveDb || !isHost) return;
  const payload = {
    startedAt: firebase.database.ServerValue.TIMESTAMP,
    hostInstanceId: liveInstanceId,
    order: order.map((p) => ({
      label: p.label,
      finish: p.finish,
      weight: p.weight,
    })),
  };
  Promise.all([
    roomRef("session").set(payload),
    roomRef("revealedCount").set(0),
  ]).catch((err) => {
    console.warn("Failed to publish session:", err);
  });
}

function publishRevealedCount(n) {
  if (!liveDb || !isHost) return;
  roomRef("revealedCount").set(n).catch((err) => {
    console.warn("Failed to publish revealedCount:", err);
  });
}

function clearSession() {
  if (!liveDb || !isHost) return;
  Promise.all([
    roomRef("session").remove(),
    roomRef("revealedCount").set(0),
  ]).catch((err) => {
    console.warn("Failed to clear session:", err);
  });
}

function handleRemoteSetup(data) {
  if (!data?.publishedAt || data.publishedAt <= appliedSetupAt) return;
  appliedSetupAt = data.publishedAt;

  for (const key of Object.keys(teamData)) delete teamData[key];
  if (data.teamData) {
    for (const [finish, info] of Object.entries(data.teamData)) {
      teamData[Number(finish)] = info;
    }
  }

  playoffPicks.length = 0;
  if (Array.isArray(data.playoffPicks)) {
    for (const p of data.playoffPicks) playoffPicks.push(p || null);
  }

  pickOwnerByRosterId.clear();
  if (data.pickOwners) {
    for (const [k, v] of Object.entries(data.pickOwners)) {
      pickOwnerByRosterId.set(Number(k), v);
    }
  }

  renderTeamInputs();

  if (!isHost) {
    const waiting = document.getElementById("waiting-card");
    const text = document.getElementById("waiting-text");
    if (waiting && text && !activeOrder) {
      waiting.hidden = false;
      text.textContent = "Teams loaded. Waiting for the host to start the lottery…";
    }
  }
}

async function handleRemoteSession(data) {
  if (!data?.startedAt || data.startedAt <= appliedSessionAt) return;
  appliedSessionAt = data.startedAt;
  // Reset session-scoped flags. Don't reset appliedRevealedCount here — a prior
  // revealedCount snapshot might already have arrived for this same session.
  initialRevealedSyncDone = false;

  if (!Array.isArray(data.order) || !data.order.length) return;
  activeOrder = data.order;

  // Host is already animating locally — don't re-trigger from its own echo.
  if (isHost && data.hostInstanceId === liveInstanceId) return;

  const waiting = document.getElementById("waiting-card");
  if (waiting) waiting.hidden = true;

  // Build reveal state at whatever revealedCount we currently know about
  // (could be 0, or could be N if the count snapshot raced ahead of session).
  await startRevealAtCount(activeOrder, appliedRevealedCount);
  initialRevealedSyncDone = true;
}

function handleSessionCleared() {
  appliedSessionAt = 0;
  appliedRevealedCount = 0;
  initialRevealedSyncDone = false;
  activeOrder = null;
  revealState = null;

  document.getElementById("results").hidden = true;
  const list = document.getElementById("results-list");
  if (list) clearChildren(list);
  document.getElementById("draw-status").textContent = "";
  const sidebar = document.getElementById("odds-sidebar");
  if (sidebar) sidebar.hidden = true;
  hideWorstWeekOverlay();
  const machine = document.getElementById("lottery-machine");
  if (machine) {
    machine.hidden = true;
    machine.classList.remove("fading");
  }

  if (!isHost) {
    const waiting = document.getElementById("waiting-card");
    const text = document.getElementById("waiting-text");
    if (waiting && text) {
      waiting.hidden = false;
      text.textContent = "Waiting for the host to start the draft lottery…";
    }
  }
}

function snapReveals(deltaCount) {
  for (let i = 0; i < deltaCount && revealState; i++) {
    const pickNum = revealState.nextPick;
    const winner = revealState.order[pickNum - 1];
    if (!winner) break;
    const team = revealState.teams[winner.finish];
    const slot = revealState.slots[pickNum - 1];
    fillSlot(slot, team, `finished ${ordinal(winner.finish)}`);
    revealState.revealed.add(winner.finish);
    revealState.nextPick = pickNum - 1;
  }
}

async function handleRemoteRevealedCount(n) {
  if (n <= appliedRevealedCount) return;
  if (isHost) {
    appliedRevealedCount = n;
    return;
  }

  const prev = appliedRevealedCount;
  appliedRevealedCount = n;

  // No session yet — handleRemoteSession will read appliedRevealedCount when it arrives.
  if (!activeOrder) return;

  if (!revealState) {
    // Session arrived but reveal state not built yet (possible if session handler is mid-await).
    await startRevealAtCount(activeOrder, n);
    initialRevealedSyncDone = true;
    return;
  }

  // First revealedCount tick after session: those reveals are historic — snap.
  if (!initialRevealedSyncDone) {
    snapReveals(n - prev);
    initialRevealedSyncDone = true;
    if (revealState) presentNextReveal();
    return;
  }

  // Live update — animate. For burst increments, snap intermediates and animate the last.
  const delta = n - prev;
  if (delta > 1) snapReveals(delta - 1);
  if (revealState) await performRevealAnimation();
}

async function loadSleeperLeague(leagueId) {
  const base = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}`;
  const [league, users, rosters, bracket, tradedPicks] = await Promise.all([
    fetch(base).then(handleSleeperResponse),
    fetch(`${base}/users`).then(handleSleeperResponse),
    fetch(`${base}/rosters`).then(handleSleeperResponse),
    fetch(`${base}/winners_bracket`).then((r) => (r.ok ? r.json() : [])),
    fetch(`${base}/traded_picks`).then((r) => (r.ok ? r.json() : [])),
  ]);

  if (!Array.isArray(users) || !Array.isArray(rosters) || rosters.length === 0) {
    throw new Error("League returned no rosters.");
  }

  const userById = new Map(users.map((u) => [u.user_id, u]));
  const rosterById = new Map();

  const enriched = rosters.map((r) => {
    const s = r.settings || {};
    const fpts = (s.fpts || 0) + (s.fpts_decimal || 0) / 100;
    const maxPf = (s.ppts || 0) + (s.ppts_decimal || 0) / 100;
    const owner = userById.get(r.owner_id) || null;
    const customName = owner?.metadata?.team_name;
    const teamName = customName || owner?.display_name || `Roster ${r.roster_id}`;
    const entry = {
      rosterId: r.roster_id,
      teamName,
      ownerName: owner?.display_name || null,
      avatarUrl: owner ? buildAvatarUrl(owner) : null,
      wins: s.wins || 0,
      ties: s.ties || 0,
      fpts,
      maxPf,
    };
    rosterById.set(r.roster_id, entry);
    return entry;
  });

  const worstByRoster = await fetchWorstWeeks(leagueId, league, rosterById);

  const playoffTeams = league?.settings?.playoff_teams ?? 6;
  const byRecord = [...enriched].sort(
    (a, b) => b.wins - a.wins || b.ties - a.ties || b.fpts - a.fpts
  );
  const nonPlayoff = byRecord.slice(playoffTeams);
  const lotterySize = POSITIONS.length;
  const lottery = [...nonPlayoff]
    .sort((a, b) => b.maxPf - a.maxPf)
    .slice(0, lotterySize);

  for (const key of Object.keys(teamData)) delete teamData[key];
  playoffPicks.length = 0;

  let filled = 0;
  POSITIONS.forEach((p, i) => {
    const standing = lottery[i];
    if (!standing) return;
    teamData[p.finish] = {
      name: standing.teamName,
      ownerName: standing.ownerName,
      avatarUrl: standing.avatarUrl,
      maxPf: standing.maxPf,
      rosterId: standing.rosterId,
      worstWeek: worstByRoster.get(standing.rosterId) || null,
    };
    filled++;
  });

  const playoffOrder = computePlayoffOrder(bracket, rosterById);
  for (const standing of playoffOrder) {
    if (!standing) {
      playoffPicks.push(null);
    } else {
      playoffPicks.push({
        name: standing.teamName,
        ownerName: standing.ownerName,
        avatarUrl: standing.avatarUrl,
        maxPf: standing.maxPf,
        rosterId: standing.rosterId,
        worstWeek: worstByRoster.get(standing.rosterId) || null,
      });
    }
  }

  const nextSeason = String(Number(league?.season || 0) + 1);
  buildPickOwnerMap(tradedPicks, nextSeason, rosterById);

  return {
    teamCount: filled,
    playoffCount: playoffPicks.filter(Boolean).length,
    tradedCount: pickOwnerByRosterId.size,
  };
}

document.addEventListener("DOMContentLoaded", () => {
  renderTeamInputs();
  renderOddsTable();
  initLiveSync();

  console.log(
    "%c Kill Yourself Sminky ",
    "background:#f5c518;color:#1a1300;font-size:18px;font-weight:700;padding:6px 12px;border-radius:6px;"
  );

  const runBtn = document.getElementById("run-btn");
  const resetBtn = document.getElementById("reset-btn");
  const sleeperBtn = document.getElementById("sleeper-load");
  const sleeperInput = document.getElementById("sleeper-id");
  const sleeperStatus = document.getElementById("sleeper-status");

  function setSleeperStatus(text, kind) {
    sleeperStatus.classList.remove("error", "success");
    if (!text) {
      sleeperStatus.hidden = true;
      sleeperStatus.textContent = "";
      return;
    }
    sleeperStatus.hidden = false;
    sleeperStatus.textContent = text;
    if (kind) sleeperStatus.classList.add(kind);
  }

  async function handleSleeperLoad() {
    const id = sleeperInput.value.trim();
    if (!id) {
      setSleeperStatus("Enter a league ID first.", "error");
      return;
    }
    sleeperBtn.disabled = true;
    setSleeperStatus("Loading league…");
    try {
      const { teamCount, playoffCount, tradedCount } =
        await loadSleeperLeague(id);
      renderTeamInputs();
      const parts = [
        `Loaded ${teamCount} lottery team${teamCount === 1 ? "" : "s"}`,
      ];
      if (playoffCount) parts.push(`${playoffCount} playoff team${playoffCount === 1 ? "" : "s"}`);
      if (tradedCount) parts.push(`${tradedCount} traded 1st-round pick${tradedCount === 1 ? "" : "s"}`);
      setSleeperStatus(parts.join(", ") + ".", "success");
      // Push setup so viewers see the team list before the host runs the lottery.
      publishSetup();
    } catch (err) {
      setSleeperStatus(err.message || "Failed to load league.", "error");
    } finally {
      sleeperBtn.disabled = false;
    }
  }

  sleeperBtn.addEventListener("click", handleSleeperLoad);
  sleeperInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSleeperLoad();
    }
  });

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    runBtn.textContent = "Drawing…";
    resetBtn.hidden = true;

    const order = runLottery();
    activeOrder = order;
    // Re-publish setup in case the host edited team-name inputs after Sleeper load.
    publishSetup();
    publishSession(order);
    await startReveal(order);
  });

  const revealBtn = document.getElementById("reveal-btn");
  if (revealBtn) {
    revealBtn.addEventListener("click", () => {
      if (isHost) performRevealAsHost();
    });
  }

  resetBtn.addEventListener("click", () => {
    document.getElementById("results").hidden = true;
    const list = document.getElementById("results-list");
    clearChildren(list);
    document.getElementById("draw-status").textContent = "";
    const sidebar = document.getElementById("odds-sidebar");
    if (sidebar) sidebar.hidden = true;
    const rb = document.getElementById("reveal-btn");
    if (rb) rb.hidden = true;
    revealState = null;
    activeOrder = null;
    runBtn.disabled = false;
    runBtn.textContent = "Run Lottery";
    resetBtn.hidden = true;
    clearSession();
  });
});
