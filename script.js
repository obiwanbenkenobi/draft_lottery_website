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
    const row = document.createElement("label");
    row.className = "team-row";
    row.innerHTML = `
      <span class="place">${ordinal(p.finish)}</span>
      <input type="text" data-finish="${p.finish}" placeholder="Team that finished ${ordinal(p.finish)}" />
    `;
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

function getTeamNames() {
  const names = {};
  for (const input of document.querySelectorAll("#teams-grid input")) {
    const finish = Number(input.dataset.finish);
    const value = input.value.trim();
    names[finish] = value || `Team ${ordinal(finish)}`;
  }
  return names;
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
    li.innerHTML = `
      <span class="pick-num">${i + 1}</span>
      <span class="team-name rolling">—</span>
      <span class="from"></span>
    `;
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
    if (idx === lastIdx) idx = (idx + 1) % allNames.length;
    lastIdx = idx;
    nameEl.textContent = allNames[idx];
    await wait(interval);
    elapsed += interval;
  }
}

async function dramaticReveal(order) {
  const section = document.getElementById("results");
  const status = document.getElementById("draw-status");
  const names = getTeamNames();
  section.hidden = false;

  const slots = buildPlaceholderSlots(order.length);
  const allNames = Object.values(names);

  section.scrollIntoView({ behavior: "smooth", block: "start" });
  await wait(600);

  // Reveal in reverse: pick #6 first, build suspense to #1.
  for (let i = order.length - 1; i >= 0; i--) {
    const slot = slots[i];
    const nameEl = slot.querySelector(".team-name");
    const fromEl = slot.querySelector(".from");
    const teamName = names[order[i].finish];

    status.textContent =
      i === 0 ? "And the #1 pick goes to…" : `Drawing pick ${i + 1}…`;

    await wait(450);

    // Suspense scales up as we get closer to pick #1.
    const duration = 1200 + (order.length - 1 - i) * 400;
    await rollSlot(slot, allNames, duration);

    nameEl.classList.remove("rolling");
    nameEl.textContent = teamName;
    fromEl.textContent = `finished ${ordinal(order[i].finish)}`;
    slot.classList.remove("pending");
    slot.classList.add("revealed");

    await wait(i === 0 ? 1400 : 750);
  }

  status.textContent = "Draft order finalized.";
}

document.addEventListener("DOMContentLoaded", () => {
  renderTeamInputs();
  renderOddsTable();

  // Console easter egg — only visible to anyone who opens dev tools.
  console.log(
    "%c sminky's season ends in week 1 ",
    "background:#f5c518;color:#1a1300;font-size:18px;font-weight:700;padding:6px 12px;border-radius:6px;"
  );

  const runBtn = document.getElementById("run-btn");
  const resetBtn = document.getElementById("reset-btn");

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
