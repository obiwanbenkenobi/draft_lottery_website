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
// Inputs always override names, so this only carries owner / avatar info.
const teamData = {};

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

    if (data?.ownerName) {
      const owner = document.createElement("span");
      owner.className = "team-owner";
      owner.textContent = `@${data.ownerName}`;
      fields.appendChild(owner);
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

async function dramaticReveal(order) {
  const section = document.getElementById("results");
  const status = document.getElementById("draw-status");
  const teams = getTeams();
  section.hidden = false;

  const slots = buildPlaceholderSlots(order.length);
  const allNames = Object.values(teams).map((t) => t.name);

  section.scrollIntoView({ behavior: "smooth", block: "start" });
  await wait(600);

  for (let i = order.length - 1; i >= 0; i--) {
    const slot = slots[i];
    const nameEl = slot.querySelector(".team-name");
    const fromEl = slot.querySelector(".from");
    const fields = slot.querySelector(".pick-fields");
    const team = teams[order[i].finish];

    status.textContent =
      i === 0 ? "And the #1 pick goes to…" : `Drawing pick ${i + 1}…`;

    await wait(450);

    const duration = 1200 + (order.length - 1 - i) * 400;
    await rollSlot(slot, allNames, duration);

    nameEl.classList.remove("rolling");
    nameEl.textContent = team.name;
    fromEl.textContent = `finished ${ordinal(order[i].finish)}`;
    attachAvatar(slot, team.avatarUrl);

    if (team.ownerName) {
      const owner = document.createElement("span");
      owner.className = "pick-owner";
      owner.textContent = `@${team.ownerName}`;
      fields.appendChild(owner);
    }

    slot.classList.remove("pending");
    slot.classList.add("revealed");

    await wait(i === 0 ? 1400 : 750);
  }

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

async function loadSleeperLeague(leagueId) {
  const base = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}`;
  const [users, rosters] = await Promise.all([
    fetch(`${base}/users`).then(handleSleeperResponse),
    fetch(`${base}/rosters`).then(handleSleeperResponse),
  ]);

  if (!Array.isArray(users) || !Array.isArray(rosters) || rosters.length === 0) {
    throw new Error("League returned no rosters.");
  }

  const userById = new Map(users.map((u) => [u.user_id, u]));

  // Sort by standings: wins desc, ties desc, points-for desc.
  const sorted = rosters
    .map((r) => {
      const s = r.settings || {};
      const fpts = (s.fpts || 0) + (s.fpts_decimal || 0) / 100;
      return {
        roster: r,
        wins: s.wins || 0,
        ties: s.ties || 0,
        fpts,
      };
    })
    .sort((a, b) => b.wins - a.wins || b.ties - a.ties || b.fpts - a.fpts);

  const lotterySize = POSITIONS.length;
  const bottom = sorted.slice(-lotterySize); // worst N — bottom[0] = best of the worst

  // Reset before re-populating.
  for (const key of Object.keys(teamData)) delete teamData[key];

  let filled = 0;
  POSITIONS.forEach((p, i) => {
    const standing = bottom[i];
    if (!standing) return;
    const owner = userById.get(standing.roster.owner_id);
    if (!owner) return;

    const customName = owner.metadata && owner.metadata.team_name;
    const teamName = customName || owner.display_name || "Unknown Team";

    teamData[p.finish] = {
      name: teamName,
      ownerName: owner.display_name || null,
      avatarUrl: buildAvatarUrl(owner),
    };
    filled++;
  });

  return { teamCount: filled };
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
      const { teamCount } = await loadSleeperLeague(id);
      renderTeamInputs();
      setSleeperStatus(
        `Loaded ${teamCount} team${teamCount === 1 ? "" : "s"} from Sleeper.`,
        "success"
      );
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
