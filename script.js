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

function renderResults(order) {
  const section = document.getElementById("results");
  const list = document.getElementById("results-list");
  const names = getTeamNames();
  list.innerHTML = "";
  section.hidden = false;

  order.forEach((p, idx) => {
    const li = document.createElement("li");
    if (idx === 0) li.classList.add("first");
    li.style.animationDelay = `${idx * 350}ms`;
    li.innerHTML = `
      <span class="pick-num">${idx + 1}</span>
      <span class="team-name">${escapeHtml(names[p.finish])}</span>
      <span class="from">finished ${ordinal(p.finish)}</span>
    `;
    list.appendChild(li);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

document.addEventListener("DOMContentLoaded", () => {
  renderTeamInputs();
  renderOddsTable();

  const runBtn = document.getElementById("run-btn");
  const resetBtn = document.getElementById("reset-btn");

  runBtn.addEventListener("click", () => {
    const order = runLottery();
    renderResults(order);
    runBtn.disabled = true;
    runBtn.textContent = "Lottery Complete";
    resetBtn.hidden = false;
    document
      .getElementById("results")
      .scrollIntoView({ behavior: "smooth", block: "start" });
  });

  resetBtn.addEventListener("click", () => {
    document.getElementById("results").hidden = true;
    document.getElementById("results-list").innerHTML = "";
    runBtn.disabled = false;
    runBtn.textContent = "Run Lottery";
    resetBtn.hidden = true;
  });
});
