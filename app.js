(function () {
  "use strict";

  const STARTING_BALANCE = 1000;
  const MAX_BALLS = 20;
  const TARGET_RTP = 0.925;

  const defaultConfig = {
    appName: "Gamba Side Rush",
    network: "devnet",
    apiBaseUrl: "",
    liveTokenWagering: false,
    token: {
      name: "Gamba",
      symbol: "GAMBA",
      mintAddress: "",
      decimals: 6,
      treasuryAddress: ""
    }
  };

  const config = Object.assign({}, defaultConfig, window.GAMBA_CONFIG || {});
  config.token = Object.assign({}, defaultConfig.token, (window.GAMBA_CONFIG || {}).token || {});

  const TOKEN_SYMBOL = config.token.symbol || "GAMBA";
  const liveReady = Boolean(
    config.liveTokenWagering &&
    config.apiBaseUrl &&
    config.token.mintAddress &&
    config.token.treasuryAddress
  );

  const riskConfigs = {
    low: {
      multipliers: [0.5, 0.8, 0.95, 1.05, 1.2, 1.5, 2, 4],
      weights: [0.2098571429, 0.25, 0.22, 0.15, 0.09, 0.05, 0.025, 0.0051428571]
    },
    medium: {
      multipliers: [0, 0.2, 0.5, 0.9, 1.4, 2.5, 5, 15],
      weights: [0.1019333333, 0.25, 0.22, 0.18, 0.13, 0.08, 0.035, 0.0030666667]
    },
    high: {
      multipliers: [0, 0.1, 0.25, 0.6, 1.5, 5, 18, 75],
      weights: [0.3032933333, 0.25, 0.2, 0.14, 0.07, 0.025, 0.006, 0.0057066667]
    }
  };

  const physicsByRisk = {
    low: { spread: 0.05, restitution: 0.58, drag: 0.994, pegKick: 18 },
    medium: { spread: 0.08, restitution: 0.7, drag: 0.996, pegKick: 28 },
    high: { spread: 0.12, restitution: 0.82, drag: 0.998, pegKick: 40 }
  };

  const state = {
    balance: STARTING_BALANCE,
    liveBalance: null,
    profit: 0,
    risk: "medium",
    selectedSides: ["left", "center", "right"],
    mode: "demo",
    ballCount: 1,
    playing: false,
    lastPockets: [],
    history: [],
    animation: null,
    restingBalls: [],
    wallet: {
      provider: null,
      publicKey: "",
      connected: false
    },
    view: {
      width: 0,
      height: 0
    }
  };

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const balanceEl = document.getElementById("balance");
  const balanceLabelEl = document.getElementById("balanceLabel");
  const profitEl = document.getElementById("profit");
  const wagerInput = document.getElementById("wager");
  const wagerUnitEl = document.getElementById("wagerUnit");
  const ballCountInput = document.getElementById("ballCount");
  const ballCountValueEl = document.getElementById("ballCountValue");
  const ballsMinusButton = document.getElementById("ballsMinusButton");
  const ballsPlusButton = document.getElementById("ballsPlusButton");
  const playButton = document.getElementById("playButton");
  const resetButton = document.getElementById("resetButton");
  const halfButton = document.getElementById("halfButton");
  const maxButton = document.getElementById("maxButton");
  const connectWalletButton = document.getElementById("connectWalletButton");
  const lastResultEl = document.getElementById("lastResult");
  const tokenTickerEl = document.getElementById("tokenTicker");
  const walletStatusEl = document.getElementById("walletStatus");
  const networkStatusEl = document.getElementById("networkStatus");
  const mintStatusEl = document.getElementById("mintStatus");
  const treasuryStatusEl = document.getElementById("treasuryStatus");
  const multiplierStrip = document.getElementById("multiplierStrip");
  const historyList = document.getElementById("historyList");
  const roundCount = document.getElementById("roundCount");
  const sideButtons = Array.from(document.querySelectorAll("[data-side]"));
  const riskButtons = Array.from(document.querySelectorAll("[data-risk]"));
  const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));

  function money(value) {
    return Number(value).toFixed(2);
  }

  function roundMoney(value) {
    return Math.round(value * 100) / 100;
  }

  function amountLabel(value) {
    return money(value) + " " + TOKEN_SYMBOL;
  }

  function shortAddress(address) {
    if (!address) {
      return "Unset";
    }

    return address.length > 12 ? address.slice(0, 4) + "..." + address.slice(-4) : address;
  }

  function multiplierLabel(value) {
    return Number.isInteger(value) ? value + "x" : value.toFixed(2).replace(/0$/, "") + "x";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function secureRandom() {
    if (window.crypto && window.crypto.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0] / 4294967296;
    }

    return Math.random();
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function selectedWager() {
    const value = Number(wagerInput.value);
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.floor(value * 100) / 100;
  }

  function selectedBallCount() {
    const value = Number(ballCountInput.value);
    if (!Number.isFinite(value)) {
      return 1;
    }

    return clamp(Math.round(value), 1, MAX_BALLS);
  }

  function configuredBalance() {
    return state.mode === "demo" ? state.balance : state.liveBalance || 0;
  }

  function findSolanaWallet() {
    if (window.solana && window.solana.isPhantom) {
      return window.solana;
    }

    if (window.phantom && window.phantom.solana) {
      return window.phantom.solana;
    }

    return null;
  }

  async function connectWallet() {
    const provider = findSolanaWallet();

    if (!provider) {
      walletStatusEl.textContent = "Install wallet";
      lastResultEl.textContent = "No Solana wallet";
      return;
    }

    try {
      const response = await provider.connect();
      state.wallet.provider = provider;
      state.wallet.publicKey = response.publicKey ? response.publicKey.toString() : "";
      state.wallet.connected = Boolean(state.wallet.publicKey);
      walletStatusEl.textContent = shortAddress(state.wallet.publicKey);
      connectWalletButton.querySelector("span").textContent = "Wallet connected";
      if (state.mode === "live") {
        lastResultEl.textContent = liveReady ? "Token mode ready" : "Token config needed";
      }
    } catch (error) {
      walletStatusEl.textContent = "Rejected";
      lastResultEl.textContent = "Wallet rejected";
    }
  }

  function setMode(mode) {
    if (state.playing) {
      return;
    }

    state.mode = mode;
    modeButtons.forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.mode === mode);
    });

    lastResultEl.textContent = mode === "live"
      ? liveReady ? "Token mode ready" : "Token config needed"
      : "Ready";
    updateDisplay();
  }

  function activeMultipliers() {
    return riskConfigs[state.risk].multipliers;
  }

  function activeWeights() {
    return riskConfigs[state.risk].weights;
  }

  function stripSlots() {
    const multipliers = activeMultipliers();
    return multipliers.concat(multipliers.slice(0, -1).reverse());
  }

  function weightedTier(weights) {
    const total = weights.reduce(function (sum, weight) {
      return sum + weight;
    }, 0);
    let roll = secureRandom() * total;

    for (let index = 0; index < weights.length; index += 1) {
      roll -= weights[index];
      if (roll <= 0) {
        return index;
      }
    }

    return weights.length - 1;
  }

  function expectedRtpForRisk(risk) {
    const riskConfig = riskConfigs[risk];
    return riskConfig.weights.reduce(function (sum, weight, index) {
      return sum + weight * riskConfig.multipliers[index];
    }, 0);
  }

  function targetPocketFromTier(side, tier) {
    if (side === "left") {
      return tier;
    }

    if (side === "right") {
      return 14 - tier;
    }

    if (tier === 7) {
      return 7;
    }

    return secureRandom() >= 0.5 ? tier : 14 - tier;
  }

  function boardMetrics(width, height) {
    const minSide = Math.min(width, height);
    const pocketCount = 15;
    const slotStep = width / pocketCount;
    return {
      width,
      height,
      left: width * 0.035,
      right: width * 0.965,
      top: height * 0.09,
      gateY: height * 0.47,
      slotY: height * 0.86,
      centerX: width * 0.5,
      ballRadius: clamp(minSide * 0.021, 7, 12),
      pegRadius: clamp(minSide * 0.014, 5, 8.5),
      pocketCount,
      slotStep,
      slotLeft: slotStep * 0.5
    };
  }

  function slotWidth(metrics) {
    return metrics.slotStep;
  }

  function slotCenterX(index, metrics) {
    return metrics.slotLeft + metrics.slotStep * index;
  }

  function createPegs(width, height) {
    const metrics = boardMetrics(width, height);
    const rows = [
      { y: 0.18, count: 9, inset: 0.24 },
      { y: 0.27, count: 10, inset: 0.2 },
      { y: 0.36, count: 11, inset: 0.16 },
      { y: 0.45, count: 12, inset: 0.13 },
      { y: 0.54, count: 13, inset: 0.105 },
      { y: 0.63, count: 14, inset: 0.085 },
      { y: 0.72, count: 15, inset: 0.065 },
      { y: 0.8, count: 16, inset: 0.045 }
    ];
    const pegs = [];

    rows.forEach(function (row, rowIndex) {
      const start = width * row.inset;
      const end = width * (1 - row.inset);
      const gap = row.count > 1 ? (end - start) / (row.count - 1) : 0;

      for (let index = 0; index < row.count; index += 1) {
        const stagger = rowIndex % 2 === 0 ? 0 : gap * 0.5;
        const x = start + gap * index + stagger;
        if (x > width * 0.965) {
          continue;
        }

        pegs.push({
          x,
          y: height * row.y,
          r: metrics.pegRadius
        });
      }
    });

    return pegs;
  }

  function updateDisplay() {
    const balance = configuredBalance();
    const ballCount = selectedBallCount();
    const maxPerBall = Math.max(1, Math.floor(((balance || state.balance) / ballCount) * 100) / 100);

    balanceLabelEl.textContent = state.mode === "demo" ? "Demo balance" : "Wallet balance";
    balanceEl.textContent = amountLabel(balance);
    profitEl.textContent = amountLabel(state.profit);
    roundCount.textContent = String(state.history.length);
    wagerInput.max = String(maxPerBall);
    ballCountValueEl.textContent = String(ballCount);
    playButton.querySelector("span").textContent = ballCount > 1 ? "Launch " + ballCount : "Launch";
    playButton.title = "RTP " + ((expectedRtpForRisk(state.risk) || TARGET_RTP) * 100).toFixed(2) + "%";
  }

  function renderStrip() {
    const hits = state.lastPockets;
    multiplierStrip.innerHTML = "";

    stripSlots().forEach(function (multiplier, index) {
      const pocket = document.createElement("div");
      pocket.className = "pocket";
      pocket.textContent = multiplierLabel(multiplier);

      if (index === 7) {
        pocket.classList.add("is-center");
      }

      if (hits.indexOf(index) !== -1) {
        pocket.classList.add("is-hit");
      }

      multiplierStrip.appendChild(pocket);
    });
  }

  function renderHistory() {
    historyList.innerHTML = "";

    state.history.slice(0, 10).forEach(function (round) {
      const item = document.createElement("li");
      item.className = round.payout >= round.totalWager ? "is-win" : "is-loss";

      const main = document.createElement("span");
      main.className = "history-main";
      main.textContent = round.balls > 1 ? round.balls + " balls" : multiplierLabel(round.bestMultiplier);

      const side = document.createElement("span");
      side.className = "history-side";
      side.textContent = round.sideLabel.toUpperCase() + " / " + round.risk.toUpperCase();

      const wager = document.createElement("span");
      wager.className = "history-side";
      wager.textContent = "Stake " + amountLabel(round.totalWager);

      const payout = document.createElement("span");
      payout.className = "history-pay";
      payout.textContent = amountLabel(round.payout);

      item.append(main, payout, side, wager);
      historyList.appendChild(item);
    });
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
    bg.addColorStop(0.55, "#182019");
    bg.addColorStop(1, "#101514");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    drawLaunchGates(width, height);
    drawPegs(width, height);
    drawCenterBeacon(width, height);
    drawBalls(width, height);
  }

  function drawLaunchGates(width, height) {
    const metrics = boardMetrics(width, height);
    const gateWidth = clamp(width * 0.07, 42, 58);
    const gateHeight = clamp(height * 0.1, 38, 52);

    ctx.save();
    drawGate(metrics.left, metrics.gateY, "L", gateWidth, gateHeight);
    drawGate(metrics.centerX, metrics.gateY, "C", gateWidth, gateHeight);
    drawGate(metrics.right, metrics.gateY, "R", gateWidth, gateHeight);
    ctx.restore();
  }

  function drawGate(x, y, label, width, height) {
    ctx.save();
    ctx.translate(x, y);
    drawRoundedRect(-width / 2, -height / 2, width, height, 8);
    ctx.fillStyle = "rgba(244,239,227,0.07)";
    ctx.fill();
    ctx.strokeStyle = "rgba(244,239,227,0.18)";
    ctx.stroke();
    ctx.fillStyle = "#f4efe3";
    ctx.font = "800 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  function drawPegs(width, height) {
    const pegs = createPegs(width, height);

    ctx.save();
    pegs.forEach(function (peg, index) {
      const radius = peg.r;
      const glow = ctx.createRadialGradient(peg.x, peg.y, 1, peg.x, peg.y, radius * 4);
      glow.addColorStop(0, "rgba(77,184,200,0.34)");
      glow.addColorStop(1, "rgba(77,184,200,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, radius * 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = index % 4 === 0 ? "rgba(227,180,72,0.86)" : "rgba(77,184,200,0.92)";
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(244,239,227,0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawCenterBeacon(width, height) {
    const metrics = boardMetrics(width, height);
    const pulse = state.animation ? 0.14 + Math.sin(performance.now() / 120) * 0.07 : 0.12;
    const glow = ctx.createRadialGradient(metrics.centerX, metrics.slotY - 28, 2, metrics.centerX, metrics.slotY - 28, width * 0.1);
    glow.addColorStop(0, "rgba(227,180,72," + pulse + ")");
    glow.addColorStop(1, "rgba(227,180,72,0)");

    ctx.save();
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(metrics.centerX, metrics.slotY - 28, width * 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(227,180,72,0.56)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(metrics.centerX, metrics.slotY - 28, clamp(width * 0.035, 18, 30), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBalls(width, height) {
    const balls = state.animation ? state.animation.balls : state.restingBalls;
    if (!balls.length) {
      return;
    }

    balls.forEach(function (ball) {
      if (!ball.active && !ball.settled) {
        drawQueuedBall(ball, width, height);
        return;
      }

      drawTrail(ball);
      drawBall(ball);
    });
  }

  function drawQueuedBall(ball, width, height) {
    const metrics = boardMetrics(width, height);
    const direction = ball.side === "left" ? 1 : ball.side === "right" ? -1 : 0;
    const x = ball.side === "left"
      ? metrics.left + direction * 18
      : ball.side === "right"
        ? metrics.right + direction * 18
        : metrics.centerX;
    const y = metrics.gateY + ball.queueOffset;

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#e3b448";
    ctx.beginPath();
    ctx.arc(x, y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTrail(ball) {
    ctx.save();
    for (let index = 0; index < ball.trail.length; index += 1) {
      const point = ball.trail[index];
      const alpha = (index + 1) / ball.trail.length;
      ctx.fillStyle = "rgba(71,199,143," + alpha * 0.12 + ")";
      ctx.beginPath();
      ctx.arc(point.x, point.y, ball.r * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBall(ball) {
    ctx.save();
    const shadow = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, ball.r * 3.2);
    shadow.addColorStop(0, "rgba(71,199,143,0.32)");
    shadow.addColorStop(1, "rgba(71,199,143,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r * 3.2, 0, Math.PI * 2);
    ctx.fill();

    const fill = ctx.createRadialGradient(ball.x - ball.r * 0.38, ball.y - ball.r * 0.5, 1, ball.x, ball.y, ball.r);
    fill.addColorStop(0, "#fff7d0");
    fill.addColorStop(0.34, "#e3b448");
    fill.addColorStop(1, "#d85f45");
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(244,239,227,0.65)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function chooseSide() {
    const sides = state.selectedSides.length ? state.selectedSides : ["center"];
    return sides[Math.floor(secureRandom() * sides.length)];
  }

  function createBall(index, total, wager, side, now, targetTier) {
    const width = state.view.width;
    const height = state.view.height;
    const metrics = boardMetrics(width, height);
    const risk = physicsByRisk[state.risk];
    const queueOffset = (index - (total - 1) / 2) * metrics.ballRadius * 0.38;
    const verticalJitter = (secureRandom() - 0.5) * height * risk.spread;
    const speedJitter = (secureRandom() - 0.5) * width * risk.spread;
    const targetPocket = targetPocketFromTier(side, targetTier);
    const multiplier = stripSlots()[targetPocket];
    const targetDirection = Math.sign(slotCenterX(targetPocket, metrics) - metrics.centerX) || (secureRandom() >= 0.5 ? 1 : -1);
    const spawnDelay = total > 10 ? 64 : 92;
    const launchX = side === "left"
      ? metrics.left + metrics.ballRadius + 4
      : side === "right"
        ? metrics.right - metrics.ballRadius - 4
        : metrics.centerX;

    return {
      id: index,
      side,
      risk: state.risk,
      wager,
      targetTier,
      targetPocket,
      r: metrics.ballRadius,
      x: launchX,
      y: metrics.gateY + queueOffset + verticalJitter * 0.16,
      vx: targetDirection * (width * 0.2 + Math.abs(speedJitter)),
      vy: height * (0.05 + secureRandom() * 0.08),
      spawnAt: now + index * spawnDelay,
      queueOffset,
      active: false,
      settled: false,
      pocket: null,
      multiplier,
      payout: roundMoney(wager * multiplier),
      trail: []
    };
  }

  function stepPhysics(animation, timestamp) {
    if (!animation.lastTime) {
      animation.lastTime = timestamp;
    }

    const rawDt = clamp((timestamp - animation.lastTime) / 1000, 0, 0.032);
    const steps = Math.max(1, Math.ceil(rawDt / 0.008));
    const dt = rawDt / steps;
    animation.lastTime = timestamp;

    for (let step = 0; step < steps; step += 1) {
      animation.balls.forEach(function (ball) {
        if (ball.settled || timestamp < ball.spawnAt) {
          return;
        }

        if (!ball.active) {
          ball.active = true;
        }

        integrateBall(ball, dt);
      });

      animation.balls.forEach(function (ball) {
        if (ball.active && !ball.settled) {
          collideWithWalls(ball);
          collideWithPegs(ball);
        }
      });

      collideBalls(animation.balls);

      animation.balls.forEach(function (ball) {
        if (ball.active && !ball.settled) {
          settleIfReady(ball);
        }
      });
    }

    animation.balls.forEach(function (ball) {
      if (!ball.active || ball.settled) {
        return;
      }

      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 12) {
        ball.trail.shift();
      }
    });
  }

  function integrateBall(ball, dt) {
    const width = state.view.width;
    const height = state.view.height;
    const metrics = boardMetrics(width, height);
    const risk = physicsByRisk[ball.risk];
    const gravity = height * 1.22;
    const sideBias = ball.side === "left" ? 1 : ball.side === "right" ? -1 : 0;
    const centerBias = (state.view.width * 0.5 - ball.x) * 0.12;
    const targetX = slotCenterX(ball.targetPocket, metrics);
    const captureStart = metrics.slotY - Math.max(54, height * 0.18);
    const targetY = metrics.slotY - ball.r * 0.25;
    const targetPull = clamp((ball.y - height * 0.38) / (height * 0.38), 0, 1);
    const capture = clamp((ball.y - captureStart) / Math.max(1, targetY - captureStart), 0, 1);

    ball.vx += (centerBias + sideBias * width * 0.03) * dt;
    ball.vx += (targetX - ball.x) * (2.6 + capture * 12) * targetPull * dt;
    ball.vy += (targetY - ball.y) * capture * 8 * dt;
    ball.vy += gravity * dt;
    ball.vx *= risk.drag * (1 - capture * 0.045);
    ball.vy *= 0.999 * (1 - capture * 0.06);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  }

  function collideWithWalls(ball) {
    const metrics = boardMetrics(state.view.width, state.view.height);
    const restitution = physicsByRisk[ball.risk].restitution;

    if (ball.x < metrics.left + ball.r) {
      ball.x = metrics.left + ball.r;
      ball.vx = Math.abs(ball.vx) * restitution;
    }

    if (ball.x > metrics.right - ball.r) {
      ball.x = metrics.right - ball.r;
      ball.vx = -Math.abs(ball.vx) * restitution;
    }

    if (ball.y < metrics.top + ball.r) {
      ball.y = metrics.top + ball.r;
      ball.vy = Math.abs(ball.vy) * restitution;
    }
  }

  function collideWithPegs(ball) {
    const pegs = createPegs(state.view.width, state.view.height);
    const risk = physicsByRisk[ball.risk];
    const restitution = risk.restitution;

    pegs.forEach(function (peg) {
      const dx = ball.x - peg.x;
      const dy = ball.y - peg.y;
      const dist = Math.hypot(dx, dy);
      const minDist = ball.r + peg.r;

      if (!dist || dist >= minDist) {
        return;
      }

      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;
      const velocityAlongNormal = ball.vx * nx + ball.vy * ny;

      ball.x += nx * overlap;
      ball.y += ny * overlap;

      if (velocityAlongNormal < 0) {
        ball.vx -= (1 + restitution) * velocityAlongNormal * nx;
        ball.vy -= (1 + restitution) * velocityAlongNormal * ny;
      }

      ball.vx += ny * (secureRandom() - 0.5) * risk.pegKick;
      ball.vx += nx * risk.pegKick * 0.22;
      ball.vy -= Math.abs(nx) * risk.pegKick * 0.5;
    });
  }

  function collideBalls(balls) {
    for (let i = 0; i < balls.length; i += 1) {
      const a = balls[i];
      if (!a.active || a.settled) {
        continue;
      }

      for (let j = i + 1; j < balls.length; j += 1) {
        const b = balls[j];
        if (!b.active || b.settled) {
          continue;
        }

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.r + b.r;

        if (!dist || dist >= minDist) {
          continue;
        }

        const metrics = boardMetrics(state.view.width, state.view.height);
        const captureLine = metrics.slotY - Math.max(54, state.view.height * 0.18);
        if (a.y > captureLine || b.y > captureLine) {
          continue;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        const relVx = b.vx - a.vx;
        const relVy = b.vy - a.vy;
        const separatingVelocity = relVx * nx + relVy * ny;

        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;

        if (separatingVelocity > 0) {
          continue;
        }

        const impulse = -(1 + 0.72) * separatingVelocity / 2;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
      }
    }
  }

  function settleIfReady(ball) {
    const metrics = boardMetrics(state.view.width, state.view.height);
    const targetX = slotCenterX(ball.targetPocket, metrics);
    const targetY = metrics.slotY - ball.r * 0.25;
    const distanceToTarget = Math.abs(ball.x - targetX);

    if (ball.y < targetY - 2 || ball.vy < -8) {
      return;
    }

    if (distanceToTarget > ball.r * 0.55) {
      ball.y = targetY;
      ball.vy = 0;
      ball.vx += (targetX - ball.x) * 0.18;
      ball.vx *= 0.82;
      return;
    }

    const pocket = ball.targetPocket;
    const multiplier = ball.multiplier;

    ball.settled = true;
    ball.pocket = pocket;
    ball.multiplier = multiplier;
    ball.x = targetX;
    ball.y = targetY;
    ball.vx = 0;
    ball.vy = 0;
    ball.trail = [];

    state.lastPockets = state.animation.balls
      .filter(function (candidate) {
        return candidate.settled;
      })
      .map(function (candidate) {
        return candidate.pocket;
      });
    renderStrip();
  }

  function animate(timestamp) {
    if (!state.animation) {
      drawBoard();
      return;
    }

    stepPhysics(state.animation, timestamp);
    drawBoard();

    if (state.animation.balls.every(function (ball) { return ball.settled; })) {
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
    const balls = selectedBallCount();
    const totalWager = roundMoney(wager * balls);

    if (wager <= 0) {
      wagerInput.value = "1";
      return;
    }

    if (state.mode === "live") {
      startLiveRound(wager, balls);
      return;
    }

    if (totalWager > state.balance) {
      wagerInput.value = money(Math.max(1, state.balance / balls));
      return;
    }

    const now = performance.now();
    const ballList = [];
    for (let index = 0; index < balls; index += 1) {
      const side = chooseSide();
      const targetTier = weightedTier(activeWeights());
      ballList.push(createBall(index, balls, wager, side, now, targetTier));
    }

    state.balance = roundMoney(state.balance - totalWager);
    state.playing = true;
    state.lastPockets = [];
    state.restingBalls = [];
    state.animation = {
      balls: ballList,
      risk: state.risk,
      requestedSides: state.selectedSides.slice(),
      ballWager: wager,
      totalWager,
      startedAt: now,
      lastTime: null
    };

    playButton.disabled = true;
    lastResultEl.textContent = balls > 1 ? balls + " balls launched" : ballList[0].side.toUpperCase() + " launch";
    updateDisplay();
    renderStrip();
    window.requestAnimationFrame(animate);
  }

  function sideLabelForBalls(balls) {
    const sides = balls.reduce(function (set, ball) {
      if (set.indexOf(ball.side) === -1) {
        set.push(ball.side);
      }
      return set;
    }, []);

    return sides.length > 1 ? "mixed" : sides[0];
  }

  function finishRound() {
    const animation = state.animation;
    const totalPayout = roundMoney(animation.balls.reduce(function (sum, ball) {
      return sum + ball.payout;
    }, 0));
    const net = roundMoney(totalPayout - animation.totalWager);
    const bestMultiplier = Math.max.apply(null, animation.balls.map(function (ball) {
      return ball.multiplier;
    }));
    const sideLabel = sideLabelForBalls(animation.balls);

    state.balance = roundMoney(state.balance + totalPayout);
    state.profit = roundMoney(state.profit + net);
    state.history.unshift({
      balls: animation.balls.length,
      sideLabel,
      risk: animation.risk,
      wager: animation.ballWager,
      totalWager: animation.totalWager,
      bestMultiplier,
      payout: totalPayout
    });

    state.restingBalls = animation.balls.map(function (ball) {
      return Object.assign({}, ball, { trail: [] });
    });
    state.animation = null;
    state.playing = false;
    playButton.disabled = false;
    lastResultEl.textContent = animation.balls.length > 1
      ? animation.balls.length + " balls / " + amountLabel(totalPayout)
      : multiplierLabel(bestMultiplier) + " / " + amountLabel(totalPayout);
    updateDisplay();
    renderStrip();
    renderHistory();
    drawBoard();
  }

  async function startLiveRound(wager, balls) {
    if (!state.wallet.connected) {
      await connectWallet();
      if (!state.wallet.connected) {
        return;
      }
    }

    if (!liveReady) {
      lastResultEl.textContent = "Token config needed";
      return;
    }

    state.playing = true;
    playButton.disabled = true;
    lastResultEl.textContent = "Preparing wager";

    try {
      const response = await fetch(config.apiBaseUrl.replace(/\/$/, "") + "/api/rounds/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          wallet: state.wallet.publicKey,
          wager,
          balls,
          totalWager: roundMoney(wager * balls),
          risk: state.risk,
          sides: state.selectedSides.slice(),
          tokenMint: config.token.mintAddress
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Wager prepare failed");
      }

      lastResultEl.textContent = "Round " + shortAddress(payload.roundId);
    } catch (error) {
      lastResultEl.textContent = error.message || "Token wager failed";
    } finally {
      state.playing = false;
      playButton.disabled = false;
    }
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(280, Math.floor(rect.height));

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    state.view.width = width;
    state.view.height = height;
    drawBoard();
  }

  function syncSideButtons() {
    sideButtons.forEach(function (button) {
      button.classList.toggle("is-active", state.selectedSides.indexOf(button.dataset.side) !== -1);
    });
  }

  function toggleSide(side) {
    if (state.playing) {
      return;
    }

    const selectedIndex = state.selectedSides.indexOf(side);
    if (selectedIndex === -1) {
      state.selectedSides.push(side);
    } else if (state.selectedSides.length > 1) {
      state.selectedSides.splice(selectedIndex, 1);
    }

    syncSideButtons();
  }

  function setRisk(risk) {
    if (state.playing) {
      return;
    }

    state.risk = risk;
    riskButtons.forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.risk === risk);
    });
    state.lastPockets = [];
    state.restingBalls = [];
    renderStrip();
    drawBoard();
  }

  function setBallCount(value) {
    if (state.playing) {
      ballCountInput.value = String(state.ballCount);
      return;
    }

    state.ballCount = clamp(Math.round(Number(value) || 1), 1, MAX_BALLS);
    ballCountInput.value = String(state.ballCount);
    updateDisplay();
  }

  sideButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      toggleSide(button.dataset.side);
    });
  });

  riskButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setRisk(button.dataset.risk);
    });
  });

  modeButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setMode(button.dataset.mode);
    });
  });

  playButton.addEventListener("click", startRound);
  connectWalletButton.addEventListener("click", connectWallet);

  ballCountInput.addEventListener("input", function () {
    setBallCount(ballCountInput.value);
  });

  ballsMinusButton.addEventListener("click", function () {
    setBallCount(state.ballCount - 1);
  });

  ballsPlusButton.addEventListener("click", function () {
    setBallCount(state.ballCount + 1);
  });

  halfButton.addEventListener("click", function () {
    const balance = configuredBalance() || state.balance;
    wagerInput.value = money(Math.max(1, balance / (2 * selectedBallCount())));
  });

  maxButton.addEventListener("click", function () {
    const balance = configuredBalance() || state.balance;
    wagerInput.value = money(Math.max(1, balance / selectedBallCount()));
  });

  resetButton.addEventListener("click", function () {
    if (state.playing) {
      return;
    }

    state.balance = STARTING_BALANCE;
    state.profit = 0;
    state.lastPockets = [];
    state.history = [];
    state.animation = null;
    state.restingBalls = [];
    lastResultEl.textContent = "Ready";
    updateDisplay();
    renderStrip();
    renderHistory();
    drawBoard();
  });

  wagerInput.addEventListener("blur", function () {
    const maxPerBall = Math.max(1, (configuredBalance() || state.balance) / selectedBallCount());
    const fixed = clamp(selectedWager(), 1, maxPerBall);
    wagerInput.value = money(fixed);
  });

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }

  tokenTickerEl.textContent = TOKEN_SYMBOL;
  wagerUnitEl.textContent = TOKEN_SYMBOL;
  networkStatusEl.textContent = config.network || "devnet";
  mintStatusEl.textContent = shortAddress(config.token.mintAddress);
  treasuryStatusEl.textContent = shortAddress(config.token.treasuryAddress);
  walletStatusEl.textContent = findSolanaWallet() ? "Ready" : "Not found";
  syncSideButtons();
  setBallCount(1);
  updateDisplay();
  renderStrip();
  renderHistory();
  resizeCanvas();
}());
