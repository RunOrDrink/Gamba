(function () {
  "use strict";

  const STARTING_BALANCE = 1000;

  const riskConfigs = {
    low: {
      multipliers: [0.5, 0.8, 0.95, 1.05, 1.2, 1.5, 2, 4],
      weights: [0.08, 0.16, 0.22, 0.22, 0.16, 0.1, 0.045, 0.015]
    },
    medium: {
      multipliers: [0, 0.2, 0.5, 0.9, 1.4, 2.5, 5, 15],
      weights: [0.22, 0.21, 0.18, 0.15, 0.11, 0.07, 0.045, 0.015]
    },
    high: {
      multipliers: [0, 0.1, 0.25, 0.6, 1.5, 5, 18, 75],
      weights: [0.32, 0.24, 0.18, 0.12, 0.08, 0.04, 0.015, 0.005]
    }
  };

  const state = {
    balance: STARTING_BALANCE,
    profit: 0,
    risk: "medium",
    side: "random",
    playing: false,
    lastPocket: null,
    history: [],
    animation: null,
    view: {
      width: 0,
      height: 0
    }
  };

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const balanceEl = document.getElementById("balance");
  const profitEl = document.getElementById("profit");
  const wagerInput = document.getElementById("wager");
  const playButton = document.getElementById("playButton");
  const resetButton = document.getElementById("resetButton");
  const halfButton = document.getElementById("halfButton");
  const maxButton = document.getElementById("maxButton");
  const lastResultEl = document.getElementById("lastResult");
  const multiplierStrip = document.getElementById("multiplierStrip");
  const historyList = document.getElementById("historyList");
  const roundCount = document.getElementById("roundCount");
  const sideButtons = Array.from(document.querySelectorAll("[data-side]"));
  const riskButtons = Array.from(document.querySelectorAll("[data-risk]"));

  function money(value) {
    return Number(value).toFixed(2);
  }

  function multiplierLabel(value) {
    return Number.isInteger(value) ? value + "x" : value.toFixed(2).replace(/0$/, "") + "x";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function selectedWager() {
    const value = Number(wagerInput.value);
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.floor(value * 100) / 100;
  }

  function activeMultipliers() {
    return riskConfigs[state.risk].multipliers;
  }

  function stripSlots() {
    const multipliers = activeMultipliers();
    return multipliers.concat(multipliers.slice(0, -1).reverse());
  }

  function pocketIndex(side, tier) {
    return side === "left" ? tier : 14 - tier;
  }

  function targetX(side, tier) {
    const width = state.view.width;
    const outer = width * 0.075;
    const center = width * 0.5;
    const distance = center - outer;
    const progress = tier / 7;
    return side === "left"
      ? outer + distance * progress
      : width - outer - distance * progress;
  }

  function updateDisplay() {
    balanceEl.textContent = money(state.balance);
    profitEl.textContent = money(state.profit);
    roundCount.textContent = String(state.history.length);
    wagerInput.max = String(Math.max(1, Math.floor(state.balance)));
  }

  function renderStrip() {
    multiplierStrip.innerHTML = "";
    stripSlots().forEach(function (multiplier, index) {
      const pocket = document.createElement("div");
      pocket.className = "pocket";
      pocket.textContent = multiplierLabel(multiplier);

      if (index === 7) {
        pocket.classList.add("is-center");
      }

      if (state.lastPocket === index) {
        pocket.classList.add("is-hit");
      }

      multiplierStrip.appendChild(pocket);
    });
  }

  function renderHistory() {
    historyList.innerHTML = "";

    state.history.slice(0, 10).forEach(function (round) {
      const item = document.createElement("li");
      item.className = round.payout >= round.wager ? "is-win" : "is-loss";

      const main = document.createElement("span");
      main.className = "history-main";
      main.textContent = multiplierLabel(round.multiplier);

      const side = document.createElement("span");
      side.className = "history-side";
      side.textContent = round.side.toUpperCase() + " / " + round.risk.toUpperCase();

      const wager = document.createElement("span");
      wager.className = "history-side";
      wager.textContent = "Wager " + money(round.wager);

      const payout = document.createElement("span");
      payout.className = "history-pay";
      payout.textContent = money(round.payout);

      item.append(main, payout, side, wager);
      historyList.appendChild(item);
    });
  }

  function weightedTier(weights) {
    const total = weights.reduce(function (sum, weight) {
      return sum + weight;
    }, 0);
    let roll = Math.random() * total;

    for (let index = 0; index < weights.length; index += 1) {
      roll -= weights[index];
      if (roll <= 0) {
        return index;
      }
    }

    return weights.length - 1;
  }

  function drawRoundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawBoard() {
    const width = state.view.width;
    const height = state.view.height;

    if (!width || !height) {
      return;
    }

    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#101410");
    bg.addColorStop(0.52, "#1a211b");
    bg.addColorStop(1, "#121514");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    drawGrid(width, height);
    drawRails(width, height);
    drawTargets(width, height);
    drawBumpers(width, height);
    drawCenterBeacon(width, height);

    if (state.animation) {
      drawAnimation(width, height);
    }
  }

  function drawGrid(width, height) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "rgba(244,239,227,0.06)";
    ctx.lineWidth = 1;

    for (let x = width * 0.075; x <= width * 0.925; x += width * 0.085) {
      ctx.beginPath();
      ctx.moveTo(x, height * 0.14);
      ctx.lineTo(x, height * 0.88);
      ctx.stroke();
    }

    for (let y = height * 0.18; y <= height * 0.84; y += height * 0.11) {
      ctx.beginPath();
      ctx.moveTo(width * 0.055, y);
      ctx.lineTo(width * 0.945, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawRails(width, height) {
    const y = height * 0.38;
    const bottom = height * 0.76;
    const left = width * 0.075;
    const right = width * 0.925;
    const center = width * 0.5;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 14;

    const leftRail = ctx.createLinearGradient(left, 0, center, 0);
    leftRail.addColorStop(0, "rgba(216,95,69,0.26)");
    leftRail.addColorStop(0.72, "rgba(71,199,143,0.28)");
    leftRail.addColorStop(1, "rgba(227,180,72,0.54)");
    ctx.strokeStyle = leftRail;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.bezierCurveTo(width * 0.2, y + 80, width * 0.34, y - 70, center, bottom);
    ctx.stroke();

    const rightRail = ctx.createLinearGradient(center, 0, right, 0);
    rightRail.addColorStop(0, "rgba(227,180,72,0.54)");
    rightRail.addColorStop(0.28, "rgba(71,199,143,0.28)");
    rightRail.addColorStop(1, "rgba(216,95,69,0.26)");
    ctx.strokeStyle = rightRail;
    ctx.beginPath();
    ctx.moveTo(right, y);
    ctx.bezierCurveTo(width * 0.8, y + 80, width * 0.66, y - 70, center, bottom);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(244,239,227,0.18)";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.bezierCurveTo(width * 0.2, y + 80, width * 0.34, y - 70, center, bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(right, y);
    ctx.bezierCurveTo(width * 0.8, y + 80, width * 0.66, y - 70, center, bottom);
    ctx.stroke();

    drawGate(left, y, "L");
    drawGate(right, y, "R");
    ctx.restore();
  }

  function drawGate(x, y, label) {
    ctx.save();
    ctx.translate(x, y);
    drawRoundedRect(-24, -22, 48, 44, 8);
    ctx.fillStyle = "rgba(244,239,227,0.07)";
    ctx.fill();
    ctx.strokeStyle = "rgba(244,239,227,0.18)";
    ctx.stroke();
    ctx.fillStyle = "#f4efe3";
    ctx.font = "800 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  function drawTargets(width, height) {
    const y = height * 0.84;
    const slots = stripSlots();

    slots.forEach(function (multiplier, index) {
      const x = lerp(width * 0.075, width * 0.925, index / 14);
      const isCenter = index === 7;
      const isHit = state.lastPocket === index;
      const pocketWidth = Math.max(34, width * 0.048);
      const pocketHeight = Math.max(28, height * 0.06);

      drawRoundedRect(x - pocketWidth / 2, y - pocketHeight / 2, pocketWidth, pocketHeight, 8);
      ctx.fillStyle = isCenter ? "rgba(227,180,72,0.18)" : "rgba(244,239,227,0.055)";
      if (isHit) {
        ctx.fillStyle = "rgba(71,199,143,0.24)";
      }
      ctx.fill();
      ctx.strokeStyle = isHit ? "rgba(71,199,143,0.85)" : "rgba(244,239,227,0.12)";
      ctx.lineWidth = isHit ? 2 : 1;
      ctx.stroke();

      if (width > 700 || index % 2 === 0 || isCenter) {
        ctx.fillStyle = isCenter ? "#e3b448" : "#aeb8a7";
        if (isHit) {
          ctx.fillStyle = "#f4efe3";
        }
        ctx.font = "800 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(multiplierLabel(multiplier), x, y);
      }
    });
  }

  function drawBumpers(width, height) {
    const rows = [
      { y: 0.28, spread: 0.18, count: 4 },
      { y: 0.39, spread: 0.28, count: 5 },
      { y: 0.5, spread: 0.37, count: 6 },
      { y: 0.61, spread: 0.43, count: 7 }
    ];

    ctx.save();
    rows.forEach(function (row, rowIndex) {
      for (let i = 0; i < row.count; i += 1) {
        const offset = row.count === 1 ? 0 : (i / (row.count - 1) - 0.5) * row.spread;
        const leftX = width * (0.27 + offset);
        const rightX = width * (0.73 - offset);
        const y = height * row.y + (rowIndex % 2 ? 8 : -6);
        drawBumper(leftX, y, rowIndex);
        drawBumper(rightX, y, rowIndex);
      }
    });
    ctx.restore();
  }

  function drawBumper(x, y, row) {
    const radius = 7 + (row % 2) * 2;
    const glow = ctx.createRadialGradient(x, y, 1, x, y, radius * 3.4);
    glow.addColorStop(0, "rgba(77,184,200,0.32)");
    glow.addColorStop(1, "rgba(77,184,200,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(77,184,200,0.92)";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(244,239,227,0.46)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawCenterBeacon(width, height) {
    const x = width * 0.5;
    const y = height * 0.76;
    const pulse = state.animation ? 0.15 + Math.sin(performance.now() / 120) * 0.08 : 0.12;
    const glow = ctx.createRadialGradient(x, y, 2, x, y, width * 0.13);
    glow.addColorStop(0, "rgba(227,180,72," + pulse + ")");
    glow.addColorStop(1, "rgba(227,180,72,0)");

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, width * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(227,180,72,0.62)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 28, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawAnimation(width, height) {
    const anim = state.animation;
    const position = ballPosition(anim);
    const trailLength = anim.trail.length;

    ctx.save();
    for (let i = 0; i < trailLength; i += 1) {
      const point = anim.trail[i];
      const alpha = (i + 1) / trailLength;
      ctx.fillStyle = "rgba(71,199,143," + alpha * 0.18 + ")";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 9 * alpha, 0, Math.PI * 2);
      ctx.fill();
    }

    const shadow = ctx.createRadialGradient(position.x, position.y, 1, position.x, position.y, 40);
    shadow.addColorStop(0, "rgba(71,199,143,0.34)");
    shadow.addColorStop(1, "rgba(71,199,143,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(position.x, position.y, 40, 0, Math.PI * 2);
    ctx.fill();

    const ball = ctx.createRadialGradient(position.x - 6, position.y - 8, 2, position.x, position.y, 18);
    ball.addColorStop(0, "#fff7d0");
    ball.addColorStop(0.35, "#e3b448");
    ball.addColorStop(1, "#d85f45");
    ctx.fillStyle = ball;
    ctx.beginPath();
    ctx.arc(position.x, position.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(244,239,227,0.65)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    if (position.x < -20 || position.x > width + 20 || position.y > height + 20) {
      return;
    }
  }

  function ballPosition(anim) {
    const elapsed = performance.now() - anim.startedAt;
    const t = clamp(elapsed / anim.duration, 0, 1);
    const forward = easeOutCubic(t);
    const drop = Math.pow(t, 1.8);
    const direction = anim.side === "left" ? 1 : -1;
    const wobble = Math.sin(t * Math.PI * 9 + anim.phase) * 28 * (1 - t);
    const hitJitter = Math.sin(t * Math.PI * 22) * 6 * (1 - t);
    const x = lerp(anim.startX, anim.endX, forward) + wobble * 0.36 * direction;
    const y = lerp(anim.startY, anim.endY, drop) + wobble + hitJitter;

    return { x: x, y: y, done: t >= 1 };
  }

  function animate() {
    if (!state.animation) {
      drawBoard();
      return;
    }

    const position = ballPosition(state.animation);
    state.animation.trail.push({ x: position.x, y: position.y });
    if (state.animation.trail.length > 14) {
      state.animation.trail.shift();
    }

    drawBoard();

    if (position.done) {
      finishRound();
      return;
    }

    window.requestAnimationFrame(animate);
  }

  function startRound() {
    if (state.playing) {
      return;
    }

    const wager = selectedWager();

    if (wager <= 0) {
      wagerInput.value = "1";
      return;
    }

    if (wager > state.balance) {
      wagerInput.value = money(state.balance);
      return;
    }

    const side = state.side === "random" ? (Math.random() >= 0.5 ? "left" : "right") : state.side;
    const config = riskConfigs[state.risk];
    const tier = weightedTier(config.weights);
    const multiplier = config.multipliers[tier];
    const payout = Math.round(wager * multiplier * 100) / 100;

    state.balance = Math.round((state.balance - wager) * 100) / 100;
    state.playing = true;
    state.lastPocket = null;
    playButton.disabled = true;
    lastResultEl.textContent = side.toUpperCase() + " launch";
    updateDisplay();
    renderStrip();

    const width = state.view.width;
    const height = state.view.height;
    state.animation = {
      side: side,
      risk: state.risk,
      tier: tier,
      wager: wager,
      multiplier: multiplier,
      payout: payout,
      startedAt: performance.now(),
      duration: 1400 + Math.random() * 360,
      phase: Math.random() * Math.PI * 2,
      startX: side === "left" ? width * 0.075 : width * 0.925,
      startY: height * 0.38,
      endX: targetX(side, tier),
      endY: height * 0.84,
      trail: []
    };

    window.requestAnimationFrame(animate);
  }

  function finishRound() {
    const anim = state.animation;
    const net = Math.round((anim.payout - anim.wager) * 100) / 100;

    state.balance = Math.round((state.balance + anim.payout) * 100) / 100;
    state.profit = Math.round((state.profit + net) * 100) / 100;
    state.lastPocket = pocketIndex(anim.side, anim.tier);
    state.history.unshift({
      side: anim.side,
      risk: anim.risk,
      wager: anim.wager,
      multiplier: anim.multiplier,
      payout: anim.payout
    });

    state.animation = null;
    state.playing = false;
    playButton.disabled = false;
    lastResultEl.textContent = multiplierLabel(anim.multiplier) + " / " + money(anim.payout);
    updateDisplay();
    renderStrip();
    renderHistory();
    drawBoard();
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(300, Math.floor(rect.height));

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    state.view.width = width;
    state.view.height = height;
    drawBoard();
  }

  function setSide(side) {
    state.side = side;
    sideButtons.forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.side === side);
    });
  }

  function setRisk(risk) {
    state.risk = risk;
    riskButtons.forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.risk === risk);
    });
    state.lastPocket = null;
    renderStrip();
    drawBoard();
  }

  sideButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setSide(button.dataset.side);
    });
  });

  riskButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      if (!state.playing) {
        setRisk(button.dataset.risk);
      }
    });
  });

  playButton.addEventListener("click", startRound);

  halfButton.addEventListener("click", function () {
    wagerInput.value = money(Math.max(1, state.balance / 2));
  });

  maxButton.addEventListener("click", function () {
    wagerInput.value = money(Math.max(1, state.balance));
  });

  resetButton.addEventListener("click", function () {
    if (state.playing) {
      return;
    }

    state.balance = STARTING_BALANCE;
    state.profit = 0;
    state.lastPocket = null;
    state.history = [];
    lastResultEl.textContent = "Ready";
    updateDisplay();
    renderStrip();
    renderHistory();
    drawBoard();
  });

  wagerInput.addEventListener("blur", function () {
    const fixed = clamp(selectedWager(), 1, Math.max(1, state.balance));
    wagerInput.value = money(fixed);
  });

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }

  updateDisplay();
  renderStrip();
  renderHistory();
  resizeCanvas();
}());
