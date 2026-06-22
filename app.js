"use strict";

const CONFIG = {
  rows: 14,
  maxBalls: 100,
  startingBalance: 10000,
  risks: {
    green: {
      label: "Green",
      color: "#22C55E",
      glow: "rgba(34,197,94,0.45)",
      rtp: 60,
      multipliers: [16, 2.5, 1.5, 1.1, 0.8, 0.6, 0.4, 0.2, 0.4, 0.6, 0.8, 1.1, 1.5, 2.5, 16],
      chances: [1, 0.1, 0.25, 0.5, 1, 2, 8.97, 72.35, 8.98, 2, 1, 0.5, 0.25, 0.1, 1]
    },
    yellow: {
      label: "Yellow",
      color: "#F59E0B",
      glow: "rgba(245,158,11,0.45)",
      rtp: 40,
      multipliers: [40, 8, 4, 2.2, 1.2, 0.7, 0.5, 0.2, 0.5, 0.7, 1.2, 2.2, 4, 8, 40],
      chances: [0.1, 0.05, 0.1, 0.35, 1, 5, 3.5, 79.8, 3.5, 5, 1, 0.35, 0.1, 0.05, 0.1]
    },
    red: {
      label: "Red",
      color: "#EF4444",
      glow: "rgba(239,68,68,0.48)",
      rtp: 20,
      multipliers: [150, 20, 6, 2, 0.75, 0.2, 0.1, 0, 0.1, 0.2, 0.75, 2, 6, 20, 150],
      chances: [0.01, 0.02, 0.1, 0.75, 2, 10, 25, 24.24, 25, 10, 2, 0.75, 0.1, 0.02, 0.01]
    }
  },
  riskOrder: ["green", "yellow", "red"]
};

const canvas = document.getElementById("boardCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  balance: document.getElementById("balance"),
  activeRisks: document.getElementById("activeRisks"),
  lastResult: document.getElementById("lastResult"),
  profit: document.getElementById("profit"),
  multiplierGrid: document.getElementById("multiplierGrid"),
  recentList: document.getElementById("recentList"),
  roundCount: document.getElementById("roundCount"),
  betInput: document.getElementById("betInput"),
  ballInput: document.getElementById("ballInput"),
  dropBtn: document.getElementById("dropBtn"),
  turboBtn: document.getElementById("turboBtn"),
  soundBtn: document.getElementById("soundBtn"),
  statsBtn: document.getElementById("statsBtn"),
  resetBtn: document.getElementById("resetBtn"),
  statsDialog: document.getElementById("statsDialog"),
  statsGrid: document.getElementById("statsGrid"),
  closeStats: document.getElementById("closeStats")
};

const state = {
  balance: CONFIG.startingBalance,
  wager: 10,
  ballCount: 1,
  activeRisks: ["green"],
  turbo: false,
  sound: true,
  balls: [],
  particles: [],
  pulses: [],
  recentRounds: [],
  pendingRounds: new Map(),
  hit: null,
  stats: {
    bets: 0,
    wins: 0,
    wagered: 0,
    paid: 0,
    biggestWin: 0,
    highestMultiplier: 0,
    byRisk: {
      green: emptyRiskStats(),
      yellow: emptyRiskStats(),
      red: emptyRiskStats()
    }
  },
  size: { width: 900, height: 620 },
  metrics: null,
  pegPositions: []
};

let audioContext = null;
let ballId = 1;
let roundId = 1;

function emptyRiskStats() {
  return {
    bets: 0,
    wins: 0,
    wagered: 0,
    paid: 0,
    biggestWin: 0,
    highestMultiplier: 0
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatMoney(value) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatMultiplier(value) {
  return Number.isInteger(value) ? value + "x" : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "x";
}

function riskConfig(risk) {
  return CONFIG.risks[risk];
}

function chooseWeightedSlot(risk) {
  const chances = riskConfig(risk).chances;
  let cursor = Math.random() * 100;

  for (let index = 0; index < chances.length; index += 1) {
    cursor -= chances[index];
    if (cursor <= 0) return index;
  }

  return chances.length - 1;
}

function normalizeBallCount(value) {
  const riskCount = state.activeRisks.length || 1;
  let count = Math.round(clamp(Number(value) || 1, riskCount, CONFIG.maxBalls));

  if (riskCount > 1) {
    const nextMultiple = Math.ceil(count / riskCount) * riskCount;
    count = nextMultiple <= CONFIG.maxBalls ? nextMultiple : Math.floor(CONFIG.maxBalls / riskCount) * riskCount;
  }

  return clamp(count, 1, CONFIG.maxBalls);
}

function riskSequence(count) {
  const ordered = CONFIG.riskOrder.filter((risk) => state.activeRisks.includes(risk));
  return Array.from({ length: count }, (_, index) => ordered[index % ordered.length]);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.size = { width: rect.width, height: rect.height };
  calculateBoard();
  renderMultipliers();
}

function calculateBoard() {
  const width = state.size.width;
  const height = state.size.height;
  const boardWidth = clamp(Math.min(width * 0.76, 780), 300, Math.max(300, width - 34));
  const centerX = width / 2;
  const left = centerX - boardWidth / 2;
  const slotCount = CONFIG.rows + 1;
  const slotWidth = boardWidth / slotCount;
  const multiplierReserve = width < 520 ? 92 : 108;
  const slotBottom = height - multiplierReserve;
  const pocketHeight = width < 520 ? 30 : 38;
  const slotTop = slotBottom - pocketHeight;
  const rowGap = Math.min((slotTop - 58) / CONFIG.rows, (boardWidth / CONFIG.rows) * 0.72);
  const pegGap = boardWidth / CONFIG.rows;
  const lastPegY = slotTop - rowGap * 0.42;
  const top = lastPegY - (CONFIG.rows - 1) * rowGap;
  const pegRadius = clamp(pegGap * 0.105, 3.2, 5.2);
  const ballRadius = clamp(pegGap * 0.19, 7.5, 10.5);

  const pegPositions = [];
  for (let row = 0; row < CONFIG.rows; row += 1) {
    const count = row + 2;
    const y = top + row * rowGap;
    const startX = centerX - ((count - 1) * pegGap) / 2;

    for (let index = 0; index < count; index += 1) {
      pegPositions.push({ x: startX + index * pegGap, y, row });
    }
  }

  state.metrics = {
    left,
    centerX,
    boardWidth,
    top,
    lastPegY,
    pegGap,
    rowGap,
    pegRadius,
    ballRadius,
    slotCount,
    slotWidth,
    slotTop,
    slotBottom,
    pocketHeight
  };
  state.pegPositions = pegPositions;
}

function makePath(targetSlot, seed) {
  const m = state.metrics;
  const targetX = m.left + m.slotWidth * (targetSlot + 0.5);
  const startX = m.centerX + Math.sin(seed * 4.1) * m.pegGap * 0.08;
  const points = [{ x: startX, y: m.top - m.rowGap * 1.45 }];

  for (let row = 0; row < CONFIG.rows; row += 1) {
    const progress = (row + 1) / CONFIG.rows;
    const eased = Math.pow(progress, 1.15);
    const baseX = m.centerX + (targetX - m.centerX) * eased;
    const wave = Math.sin(seed * 2.31 + row * 1.73) * m.pegGap * (0.36 * (1 - progress) + 0.07);
    const side = Math.sin(seed * 7.7 + row * 2.9) > 0 ? 1 : -1;
    const y = m.top + row * m.rowGap + m.rowGap * 0.2;
    let x = baseX + wave + side * m.pegGap * 0.06;

    const rowPegs = state.pegPositions.filter((peg) => peg.row === row);
    const nearest = rowPegs.reduce((best, peg) => {
      if (!best) return peg;
      return Math.abs(peg.x - x) < Math.abs(best.x - x) ? peg : best;
    }, null);

    if (nearest && Math.abs(nearest.x - x) < m.ballRadius + m.pegRadius + 2) {
      x = nearest.x + Math.sign(x - nearest.x || side) * (m.ballRadius + m.pegRadius + 3);
    }

    x = clamp(x, m.left + m.slotWidth * 0.45, m.left + m.boardWidth - m.slotWidth * 0.45);
    points.push({ x, y });
  }

  points.push({ x: targetX, y: m.slotTop + m.pocketHeight * 0.46 });
  return preparePath(points);
}

function preparePath(points) {
  let total = 0;
  const segments = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    total += length;
    segments.push({ a, b, length, end: total });
  }

  return { points, segments, total };
}

function positionOnPath(path, t, wobbleSeed) {
  const distance = clamp(t, 0, 1) * path.total;
  const segment = path.segments.find((item) => distance <= item.end) || path.segments[path.segments.length - 1];
  const startDistance = segment.end - segment.length;
  const local = segment.length ? (distance - startDistance) / segment.length : 1;
  const ease = local * local * (3 - 2 * local);
  const x = segment.a.x + (segment.b.x - segment.a.x) * ease;
  const y = segment.a.y + (segment.b.y - segment.a.y) * ease;
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  const wobble = Math.sin(t * Math.PI * 34 + wobbleSeed) * (1 - t) * 3.3;

  return {
    x: x + normalX * wobble,
    y: y + normalY * wobble
  };
}

function launchRound() {
  state.ballCount = normalizeBallCount(ui.ballInput.value);
  ui.ballInput.value = state.ballCount;

  let wager = Math.max(1, Math.floor(Number(ui.betInput.value) || state.wager));
  const totalRequested = wager * state.ballCount;

  if (totalRequested > state.balance) {
    wager = Math.floor(state.balance / state.ballCount);
    if (wager < 1) return;
    ui.betInput.value = wager;
  }

  state.wager = wager;
  const stake = wager * state.ballCount;
  state.balance -= stake;

  const id = "round-" + roundId;
  roundId += 1;

  const round = {
    id,
    stake,
    payout: 0,
    completed: 0,
    ballCount: state.ballCount,
    risks: [],
    bestMultiplier: 0,
    startedAt: Date.now()
  };
  state.pendingRounds.set(id, round);

  const risks = riskSequence(state.ballCount);
  const spawnGap = state.turbo ? 38 : 85;

  risks.forEach((risk, index) => {
    window.setTimeout(() => spawnBall(id, risk, wager, index), index * spawnGap);
  });

  playTone(160, 0.055, 0.04);
  renderUi();
}

function spawnBall(round, risk, wager, index) {
  const slot = chooseWeightedSlot(risk);
  const config = riskConfig(risk);
  const multiplier = config.multipliers[slot];
  const seed = Math.random() * 1000 + index * 0.113;
  const path = makePath(slot, seed);

  state.balls.push({
    id: ballId,
    round,
    risk,
    slot,
    multiplier,
    wager,
    payout: Math.round(wager * multiplier * 100) / 100,
    color: config.color,
    path,
    start: performance.now(),
    duration: state.turbo ? 1850 + Math.random() * 240 : 3100 + Math.random() * 520,
    trail: [],
    nextHit: 0,
    settled: false,
    wobbleSeed: seed
  });
  ballId += 1;
}

function settleBall(ball) {
  if (ball.settled) return;
  ball.settled = true;
  state.balance += ball.payout;
  state.hit = { risk: ball.risk, slot: ball.slot, until: performance.now() + 520 };

  const win = ball.payout > ball.wager;
  const riskStats = state.stats.byRisk[ball.risk];
  updateStats(state.stats, ball, win);
  updateStats(riskStats, ball, win);

  const round = state.pendingRounds.get(ball.round);
  if (round) {
    round.payout = Math.round((round.payout + ball.payout) * 100) / 100;
    round.completed += 1;
    round.bestMultiplier = Math.max(round.bestMultiplier, ball.multiplier);
    if (!round.risks.includes(ball.risk)) round.risks.push(ball.risk);

    if (round.completed >= round.ballCount) {
      state.pendingRounds.delete(round.id);
      round.profit = Math.round((round.payout - round.stake) * 100) / 100;
      state.recentRounds.unshift(round);
      state.recentRounds = state.recentRounds.slice(0, 14);
      ui.lastResult.textContent = formatMultiplier(round.bestMultiplier) + " / " + formatMoney(round.payout);
      ui.profit.textContent = (round.profit >= 0 ? "+" : "") + formatMoney(round.profit) + " GAMBA";
    }
  }

  playTone(ball.multiplier >= 10 ? 520 : 320, ball.multiplier >= 10 ? 0.18 : 0.08, 0.04);
  renderMultipliers();
  renderUi();
}

function updateStats(stats, ball, win) {
  stats.bets += 1;
  stats.wins += win ? 1 : 0;
  stats.wagered = Math.round((stats.wagered + ball.wager) * 100) / 100;
  stats.paid = Math.round((stats.paid + ball.payout) * 100) / 100;
  stats.biggestWin = Math.max(stats.biggestWin, ball.payout);
  stats.highestMultiplier = Math.max(stats.highestMultiplier, ball.multiplier);
}

function tick(now) {
  updateBalls(now);
  updateParticles(now);
  draw(now);
  requestAnimationFrame(tick);
}

function updateBalls(now) {
  state.balls.forEach((ball) => {
    if (ball.settled) return;
    const t = clamp((now - ball.start) / ball.duration, 0, 1);
    const position = positionOnPath(ball.path, t, ball.wobbleSeed);
    ball.position = position;
    ball.trail.push(position);
    if (ball.trail.length > 9) ball.trail.shift();

    while (ball.nextHit < CONFIG.rows) {
      const pegY = state.metrics.top + ball.nextHit * state.metrics.rowGap;
      if (position.y < pegY) break;
      addPegHit(position.x, pegY, ball.risk);
      ball.nextHit += 1;
    }

    if (t >= 1) settleBall(ball);
  });

  state.balls = state.balls.filter((ball) => !ball.settled || now - (state.hit ? state.hit.until : 0) < 800);
}

function addPegHit(x, y, risk) {
  const nearest = state.pegPositions.reduce((best, peg) => {
    if (!best) return peg;
    return Math.hypot(peg.x - x, peg.y - y) < Math.hypot(best.x - x, best.y - y) ? peg : best;
  }, null);

  if (!nearest) return;

  state.pulses.push({
    x: nearest.x,
    y: nearest.y,
    color: riskConfig(risk).color,
    life: 1
  });

  for (let index = 0; index < 4; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    state.particles.push({
      x: nearest.x,
      y: nearest.y,
      vx: Math.cos(angle) * (0.5 + Math.random() * 0.9),
      vy: Math.sin(angle) * (0.5 + Math.random() * 0.9),
      color: riskConfig(risk).color,
      life: 1
    });
  }

  if (Math.random() < 0.2) playTone(220 + Math.random() * 160, 0.02, 0.012);
}

function updateParticles() {
  state.particles = state.particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx,
      y: particle.y + particle.vy,
      vy: particle.vy + 0.035,
      life: particle.life - 0.035
    }))
    .filter((particle) => particle.life > 0);

  state.pulses = state.pulses
    .map((pulse) => ({ ...pulse, life: pulse.life - 0.05 }))
    .filter((pulse) => pulse.life > 0);
}

function draw(now) {
  const width = state.size.width;
  const height = state.size.height;
  const m = state.metrics;
  if (!m) return;

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#080d13");
  bg.addColorStop(0.5, "#101926");
  bg.addColorStop(1, "#070b10");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width / 2, height * 0.28, 20, width / 2, height * 0.36, height * 0.58);
  glow.addColorStop(0, "rgba(6,182,212,0.18)");
  glow.addColorStop(0.6, "rgba(34,197,94,0.045)");
  glow.addColorStop(1, "rgba(6,182,212,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  drawBoardLines(m);
  drawPegs(m);
  drawParticles();
  drawBalls(now, m);
}

function drawBoardLines(m) {
  ctx.save();
  ctx.strokeStyle = "rgba(148,163,184,0.34)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(m.left, m.slotTop);
  ctx.lineTo(m.left + m.boardWidth, m.slotTop);
  ctx.stroke();

  for (let index = 0; index <= m.slotCount; index += 1) {
    const x = m.left + index * m.slotWidth;
    ctx.beginPath();
    ctx.moveTo(x, m.slotTop);
    ctx.lineTo(x, m.slotBottom);
    ctx.stroke();
  }

  ctx.restore();
}

function drawPegs(m) {
  state.pegPositions.forEach((peg) => {
    const pulse = state.pulses.find((item) => Math.hypot(item.x - peg.x, item.y - peg.y) < m.pegRadius * 2);
    const radius = m.pegRadius;

    const glow = ctx.createRadialGradient(peg.x, peg.y, 1, peg.x, peg.y, radius * (pulse ? 7 : 4.4));
    glow.addColorStop(0, pulse ? "rgba(255,255,255,0.52)" : "rgba(255,255,255,0.22)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(peg.x, peg.y, radius * (pulse ? 7 : 4.4), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(peg.x, peg.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(100,116,139,0.72)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

function drawParticles() {
  state.particles.forEach((particle) => {
    ctx.globalAlpha = particle.life;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 2.2 * particle.life, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawBalls(now, m) {
  state.balls.forEach((ball) => {
    if (!ball.position || ball.settled) return;
    const radius = m.ballRadius;

    ball.trail.forEach((point, index) => {
      const alpha = index / Math.max(1, ball.trail.length);
      ctx.globalAlpha = alpha * 0.18;
      ctx.fillStyle = ball.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * alpha * 0.72, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.shadowColor = ball.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = ball.color;
    ctx.beginPath();
    ctx.arc(ball.position.x, ball.position.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.88)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(ball.position.x, ball.position.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  });

  if (state.hit && now > state.hit.until) {
    state.hit = null;
    renderMultipliers();
  }
}

function renderMultipliers() {
  const m = state.metrics;
  if (!m) return;
  ui.multiplierGrid.style.width = m.boardWidth + "px";
  ui.multiplierGrid.innerHTML = "";

  CONFIG.riskOrder.forEach((risk) => {
    const config = riskConfig(risk);
    const row = document.createElement("div");
    row.className = "multiplier-row";

    config.multipliers.forEach((multiplier, index) => {
      const cell = document.createElement("div");
      const active = state.activeRisks.includes(risk);
      const hit = state.hit && state.hit.risk === risk && state.hit.slot === index;
      cell.className = "multiplier-cell" + (active ? "" : " dim") + (hit ? " hit" : "");
      cell.style.background = "linear-gradient(180deg, " + config.color + ", rgba(11,15,20,0.72))";
      cell.style.color = config.color;
      cell.style.borderColor = hit ? "#ffffff" : config.color + "66";
      cell.style.boxShadow = hit ? "0 0 26px " + config.glow : "0 0 8px " + config.glow;
      cell.textContent = formatMultiplier(multiplier);
      row.appendChild(cell);
    });

    ui.multiplierGrid.appendChild(row);
  });
}

function renderUi() {
  ui.balance.textContent = formatMoney(state.balance);
  ui.betInput.value = state.wager;
  ui.ballInput.value = state.ballCount;
  ui.turboBtn.textContent = state.turbo ? "Turbo on" : "Turbo off";
  ui.soundBtn.textContent = state.sound ? "Sound on" : "Sound off";
  ui.dropBtn.textContent = "Drop " + (state.ballCount > 1 ? state.ballCount : "");

  document.querySelectorAll(".risk-btn").forEach((button) => {
    button.classList.toggle("active", state.activeRisks.includes(button.dataset.risk));
  });

  ui.activeRisks.innerHTML = "";
  state.activeRisks.forEach((risk) => {
    const pill = document.createElement("span");
    pill.className = "risk-pill";
    pill.style.color = riskConfig(risk).color;
    pill.textContent = riskConfig(risk).label;
    ui.activeRisks.appendChild(pill);
  });

  renderRecent();
  renderMultipliers();
}

function renderRecent() {
  ui.roundCount.textContent = state.recentRounds.length;
  ui.recentList.innerHTML = "";

  if (!state.recentRounds.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No rounds yet.";
    ui.recentList.appendChild(empty);
    return;
  }

  state.recentRounds.forEach((round) => {
    const item = document.createElement("div");
    item.className = "recent-item";
    const profitColor = round.profit >= 0 ? "var(--green)" : "var(--red)";
    const riskText = round.risks.map((risk) => riskConfig(risk).label).join(" / ");
    item.innerHTML =
      "<strong style=\"color:" + profitColor + "\"><span>" +
      (round.profit >= 0 ? "+" : "") + formatMoney(round.profit) +
      "</span><span>" + formatMoney(round.payout) + "</span></strong>" +
      "<p>" + round.ballCount + " circles - stake " + formatMoney(round.stake) + " - best " + formatMultiplier(round.bestMultiplier) + "</p>" +
      "<p>" + riskText + "</p>";
    ui.recentList.appendChild(item);
  });
}

function renderStats() {
  const rows = [
    ["Total bets", state.stats.bets],
    ["Total wins", state.stats.wins],
    ["Wagered", formatMoney(state.stats.wagered)],
    ["Paid", formatMoney(state.stats.paid)],
    ["Live RTP", state.stats.wagered > 0 ? ((state.stats.paid / state.stats.wagered) * 100).toFixed(2) + "%" : "0.00%"],
    ["Biggest win", formatMoney(state.stats.biggestWin)],
    ["Highest multiplier", formatMultiplier(state.stats.highestMultiplier || 0)]
  ];

  CONFIG.riskOrder.forEach((risk) => {
    const stats = state.stats.byRisk[risk];
    rows.push([riskConfig(risk).label + " paid", formatMoney(stats.paid)]);
    rows.push([riskConfig(risk).label + " RTP", stats.wagered > 0 ? ((stats.paid / stats.wagered) * 100).toFixed(2) + "%" : "0.00%"]);
  });

  ui.statsGrid.innerHTML = "";
  rows.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = "<span>" + label + "</span><strong>" + value + "</strong>";
    ui.statsGrid.appendChild(card);
  });
}

function playTone(frequency, duration, volume) {
  if (!state.sound) return;
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gain.gain.value = volume;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.stop(audioContext.currentTime + duration);
  } catch (_error) {
    state.sound = false;
  }
}

function resetDemo() {
  state.balance = CONFIG.startingBalance;
  state.wager = 10;
  state.ballCount = 1;
  state.activeRisks = ["green"];
  state.balls = [];
  state.particles = [];
  state.pulses = [];
  state.recentRounds = [];
  state.pendingRounds.clear();
  state.hit = null;
  state.stats = {
    bets: 0,
    wins: 0,
    wagered: 0,
    paid: 0,
    biggestWin: 0,
    highestMultiplier: 0,
    byRisk: {
      green: emptyRiskStats(),
      yellow: emptyRiskStats(),
      red: emptyRiskStats()
    }
  };
  ui.lastResult.textContent = "Ready";
  ui.profit.textContent = "0.00 GAMBA";
  renderUi();
}

function bindEvents() {
  document.querySelectorAll(".risk-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const risk = button.dataset.risk;
      const active = state.activeRisks.includes(risk);

      if (active && state.activeRisks.length === 1) return;
      state.activeRisks = active
        ? state.activeRisks.filter((item) => item !== risk)
        : CONFIG.riskOrder.filter((item) => item === risk || state.activeRisks.includes(item));
      state.ballCount = normalizeBallCount(state.ballCount);
      renderUi();
    });
  });

  ui.dropBtn.addEventListener("click", launchRound);
  ui.turboBtn.addEventListener("click", () => {
    state.turbo = !state.turbo;
    renderUi();
  });
  ui.soundBtn.addEventListener("click", () => {
    state.sound = !state.sound;
    renderUi();
  });
  ui.resetBtn.addEventListener("click", resetDemo);

  document.getElementById("betMinus").addEventListener("click", () => setWager(state.wager - 1));
  document.getElementById("betPlus").addEventListener("click", () => setWager(state.wager + 1));
  document.getElementById("halfBet").addEventListener("click", () => setWager(Math.max(1, Math.floor(state.wager / 2))));
  document.getElementById("doubleBet").addEventListener("click", () => setWager(Math.min(Math.floor(state.balance), state.wager * 2)));
  document.getElementById("maxBet").addEventListener("click", () => setWager(Math.max(1, Math.floor(state.balance / state.ballCount))));

  document.getElementById("ballMinus").addEventListener("click", () => setBallCount(state.ballCount - 1));
  document.getElementById("ballPlus").addEventListener("click", () => setBallCount(state.ballCount + 1));

  ui.betInput.addEventListener("change", () => setWager(ui.betInput.value));
  ui.ballInput.addEventListener("change", () => setBallCount(ui.ballInput.value));

  ui.statsBtn.addEventListener("click", () => {
    renderStats();
    ui.statsDialog.showModal();
  });
  ui.closeStats.addEventListener("click", () => ui.statsDialog.close());

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      launchRound();
    }
  });
}

function setWager(value) {
  state.wager = Math.max(1, Math.floor(Number(value) || 1));
  renderUi();
}

function setBallCount(value) {
  state.ballCount = normalizeBallCount(value);
  renderUi();
}

bindEvents();
resizeCanvas();
renderUi();
requestAnimationFrame(tick);
