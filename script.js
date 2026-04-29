// Cumulative thresholds out of 1000 — same buckets as the original Python script.
// Each entry: { label, finish, threshold }. A roll < threshold belongs to that team.
const POSITIONS = [
  { label: "seventh", finish: 7, threshold: 40 },
  { label: "eighth", finish: 8, threshold: 110 },
  { label: "ninth", finish: 9, threshold: 217 },
  { label: "tenth", finish: 10, threshold: 360 },
  { label: "eleventh", finish: 11, threshold: 627 },
  { label: "twelfth", finish: 12, threshold: 1000 },
];

const ORDINAL_SUFFIX = {
  7: "th",
  8: "th",
  9: "th",
  10: "th",
  11: "th",
  12: "th",
};

// Per-finish-position metadata loaded from Sleeper. Keys are finish numbers (7..12).
// Inputs always override names; the rest carries owner / avatar / max-PF / roster info.
const teamData = {};

// Playoff-team draft order (picks 7-12). Index 0 = pick 7 (6th place); index 5 = pick 12 (champion).
// Each entry: { name, ownerName, avatarUrl, maxPf, rosterId } or null if not derivable.
const playoffPicks = [];

// First-round pick ownership for next season's draft, keyed by the original team's roster_id.
// Only populated when a pick has been traded.
const pickOwnerByRosterId = new Map();

function ordinal(n) {
  return `${n}${ORDINAL_SUFFIX[n] ?? "th"}`;
}

function pick() {
  const value = Math.floor(Math.random() * 1000);
  return POSITIONS.find((p) => value < p.threshold);
}

function runLottery() {
  const order = [];
  const taken = new Set();
  while (order.length < 6) {
    const p = pick();
    if (!taken.has(p.finish)) {
      taken.add(p.finish);
      order.push(p);
    }
  }
  return order;
}

function renderTeamInputs() {
  const grid = document.getElementById("teams-grid");
  grid.innerHTML = "";
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

    row.appendChild(fields);
    grid.appendChild(row);
  }
}

function renderOddsTable() {
  const body = document.getElementById("odds-body");
  let prev = 0;
  for (const p of POSITIONS) {
    const odds = ((p.threshold - prev) / 10).toFixed(1);
    prev = p.threshold;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${ordinal(p.finish)}</td><td>${odds}%</td>`;
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
    };
  }
  return teams;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPlaceholderSlots(count) {
  const list = document.getElementById("results-list");
  list.innerHTML = "";
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
    // Decelerate during the last 700ms for a "settling" feel.
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
  tumbler.innerHTML = "";

  // Distribute balls across the tumbler with slight overlap for a "tumbling" feel.
  POSITIONS.forEach((p) => {
    const ball = document.createElement("div");
    ball.className = "ball";
    ball.dataset.finish = String(p.finish);

    const x = 6 + Math.random() * 78; // % from left
    const y = 12 + Math.random() * 60; // % from top
    ball.style.left = `${x}%`;
    ball.style.top = `${y}%`;

    // Each ball gets its own float vector + duration so motion looks chaotic.
    const dx = (Math.random() - 0.5) * 36;
    const dy = (Math.random() - 0.5) * 28;
    ball.style.setProperty("--ball-dx", `${dx}px`);
    ball.style.setProperty("--ball-dy", `${dy}px`);
    ball.style.animationDuration = `${1.2 + Math.random() * 1.1}s`;
    ball.style.animationDelay = `${(-Math.random() * 2).toFixed(2)}s`;

    ball.textContent = ordinal(p.finish);
    tumbler.appendChild(ball);
  });
}

async function drawBall(finishPosition, suspenseDuration) {
  const tumbler = document.getElementById("machine-tumbler");
  tumbler.classList.add("shaking");
  await wait(suspenseDuration);
  tumbler.classList.remove("shaking");

  const winner = tumbler.querySelector(
    `.ball[data-finish="${finishPosition}"]`
  );
  if (winner) {
    winner.classList.add("winning");
    await wait(850); // matches ball-winning animation duration
    winner.classList.add("exited");
  }
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
  // pick → finishing position (pick 7 = 6th place, pick 12 = champion).
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

  // Clear any prior owner/traded lines (in case slot was pre-filled then re-filled).
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

async function dramaticReveal(order) {
  const section = document.getElementById("results");
  const status = document.getElementById("draw-status");
  const teams = getTeams();
  section.hidden = false;

  setupLotteryMachine();

  const slots = buildPlaceholderSlots(12);

  // Pre-fill picks 7-12 from playoff data so they're visible while picks 1-6 are drawn.
  for (let i = 6; i < 12; i++) {
    const data = playoffPicks[i - 6];
    const slot = slots[i];
    if (data) {
      fillSlot(slot, data, playoffFromLabel(i + 1));
    } else {
      slot.querySelector(".from").textContent = playoffFromLabel(i + 1);
    }
  }

  const allNames = Object.values(teams).map((t) => t.name).filter(Boolean);

  section.scrollIntoView({ behavior: "smooth", block: "start" });
  await wait(600);

  for (let i = order.length - 1; i >= 0; i--) {
    const slot = slots[i];
    const team = teams[order[i].finish];

    status.textContent =
      i === 0 ? "And the #1 pick goes to…" : `Drawing pick ${i + 1}…`;

    await wait(450);

    // Tumbler shakes and slot text rolls in parallel; both end together.
    const duration = 1200 + (order.length - 1 - i) * 400;
    await Promise.all([
      rollSlot(slot, allNames, duration),
      drawBall(order[i].finish, duration),
    ]);

    fillSlot(slot, team, `finished ${ordinal(order[i].finish)}`);

    await wait(i === 0 ? 1400 : 750);
  }

  hideLotteryMachine();
  status.textContent = "Draft order finalized.";
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

// Walks the Sleeper winners_bracket and returns the playoff-team draft order.
// Returns array of 6 entries: [pick7Team, pick8Team, ..., pick12Team], where
// pick 7 = 6th place, pick 12 = champion. Picks 7 and 8 are split by max PF
// (lower max PF → pick 7) per league rule.
function computePlayoffOrder(bracket, rosterById) {
  const out = [null, null, null, null, null, null];
  if (!Array.isArray(bracket)) return out;

  for (const m of bracket) {
    if (m.p === 1) {
      out[5] = rosterById.get(m.w) || null; // champion → pick 12
      out[4] = rosterById.get(m.l) || null; // runner-up → pick 11
    } else if (m.p === 3) {
      out[3] = rosterById.get(m.w) || null; // 3rd place → pick 10
      out[2] = rosterById.get(m.l) || null; // 4th place → pick 9
    } else if (m.p === 5) {
      const t1 = m.t1 != null ? rosterById.get(m.t1) : null;
      const t2 = m.t2 != null ? rosterById.get(m.t2) : null;
      if (t1 && t2) {
        const [higher, lower] =
          t1.maxPf >= t2.maxPf ? [t1, t2] : [t2, t1];
        out[1] = higher; // higher max PF → 5th → pick 8
        out[0] = lower; // lower max PF → 6th → pick 7
      } else if (t1 || t2) {
        out[1] = t1 || t2;
      }
    }
  }

  return out;
}

// Builds a map of original-roster-id → current owner for next-season round-1 picks.
// Walks the trade chain so a pick traded A→B→C lands on C.
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

  // Identify non-playoff teams by record, then order them by max points-for.
  // Highest max PF = 7th seed (worst odds), lowest max PF = 12th (best odds).
  const playoffTeams = league?.settings?.playoff_teams ?? 6;
  const byRecord = [...enriched].sort(
    (a, b) => b.wins - a.wins || b.ties - a.ties || b.fpts - a.fpts
  );
  const nonPlayoff = byRecord.slice(playoffTeams);
  const lotterySize = POSITIONS.length;
  const lottery = [...nonPlayoff]
    .sort((a, b) => b.maxPf - a.maxPf)
    .slice(0, lotterySize);

  // Reset persistent Sleeper state.
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
    };
    filled++;
  });

  // Compute playoff finishing order from the winners_bracket (picks 7-12).
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
      });
    }
  }

  // First-round pick ownership for next year's draft.
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

  // Console easter egg — only visible to anyone who opens dev tools.
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
    await dramaticReveal(order);

    runBtn.textContent = "Lottery Complete";
    resetBtn.hidden = false;
  });

  resetBtn.addEventListener("click", () => {
    document.getElementById("results").hidden = true;
    document.getElementById("results-list").innerHTML = "";
    document.getElementById("draw-status").textContent = "";
    runBtn.disabled = false;
    runBtn.textContent = "Run Lottery";
    resetBtn.hidden = true;
  });
});
