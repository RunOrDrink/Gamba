(function () {
  "use strict";

  const STARTING_BALANCE = 1000;
  const MAX_BALLS = 100;
  const PLINKO_ROWS = 14;
  const WEIGHT_SCALE = 1000000;

  const defaultConfig = {
    appName: "Gamba Plinko",
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

  const riskConfigs = {
    low: {
      multipliers: [0, 0.75, 0.9, 1, 1.01, 1.05, 1.25, 2],
      weights: [0.05425, 0.08, 0.12, 0.63575, 0.05, 0.04, 0.015, 0.005]
    },
    medium: {
      multipliers: [0, 0.2, 0.5, 0.8, 1, 1.5, 3, 12],
      weights: [0.331, 0.1, 0.08, 0.07, 0.269, 0.12, 0.025, 0.005]
    },
    high: {
      multipliers: [0, 0.1, 0.25, 0.6, 1.5, 5, 18, 75],
      weights: [0.704667, 0.12, 0.07, 0.05, 0.040333, 0.008, 0.005, 0.002]
    }
  };

  const riskOrder = ["low", "medium", "high"];
  const riskColors = {
    low: "#4faa1b",
    medium: "#d99a10",
    high: "#e0181f"
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

  const state = {
    balance: STARTING_BALANCE,
    liveBalance: null,
    profit: 0,
    risk: "medium",
    mode: "demo",
    ballCount: 1,
    playing: false,
    lastPockets: [],
    history: [],
    animation: null,
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

  function multiplierLabel(value) {
    return Number.isInteger(value) ? value + "x" : value.toFixed(2).replace(/0$/, "") + "x";
  }

  function shortAddress(address) {
    if (!address) {
      return "Unset";
    }

    return address.length > 12 ? address.slice(0, 4) + "..." + address.slice(-4) : address;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function secureRandom() {
    if (window.crypto && window.crypto.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0] / 4294967296;
    }

    return Math.random();
  }

  function randomSeed() {
    return Math.floor(secureRandom() * 4294967295) >>> 0;
  }

  function seededRandom(seed) {
    let value = seed >>> 0;

    return function () {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function ease(kind, t) {
    if (kind === "bounce") {
      return 1 - Math.pow(1 - t, 2);
    }

    if (kind === "settle") {
      return t * t * (3 - 2 * t);
    }

    return t;
  }

  function selectedWager() {
    const value = Number(wagerInput.value);
    return Number.isFinite(value) ? Math.floor(value) : 0;
  }

  function selectedBallCount() {
    const value = Number(ballCountInput.value);
    return clamp(Math.round(Number.isFinite(value) ? value : 1), 1, MAX_BALLS);
  }

  function configuredBalance() {
    return state.mode === "demo" ? state.balance : state.liveBalance || 0;
  }

  function maxWholeWagerPerBall(balance, balls) {
    return Math.floor(Math.max(0, Number(balance) || 0) / Math.max(1, balls));
  }

  function activeMultipliers() {
    return riskConfigs[state.risk].multipliers;
  }

  function activeWeights() {
    return riskConfigs[state.risk].weights;
  }

  function stripSlotsForRisk(risk) {
    const multipliers = riskConfigs[risk].multipliers;
    return multipliers.concat(multipliers.slice(0, -1).reverse());
  }

  function stripSlots() {
    return stripSlotsForRisk(state.risk);
  }

  function expectedRtpForRisk(risk) {
    const riskConfig = riskConfigs[risk];
    return riskConfig.weights.reduce(function (sum, weight, index) {
      return sum + weight * riskConfig.multipliers[index];
    }, 0);
  }

  function weightedTier(weights) {
    const scaled = weights.map(function (weight) {
      return Math.round(weight * WEIGHT_SCALE);
    });
    const total = scaled.reduce(function (sum, weight) {
      return sum + weight;
    }, 0);
    let roll = Math.floor(secureRandom() * total);

    for (let index = 0; index < scaled.length; index += 1) {
      roll -= scaled[index];
      if (roll < 0) {
        return index;
      }
    }

    return scaled.length - 1;
  }

  function targetPocketFromTier(tier) {
    if (tier === 7) {
      return 7;
    }

    return secureRandom() >= 0.5 ? tier : 14 - tier;
  }

  function boardMetrics(width, height) {
    const minSide = Math.min(width, height);
    const pocketCount = 15;
    const desiredBoardWidth = width * 0.58;
    const minBoardWidth = Math.min(420, width * 0.86);
    const maxBoardWidth = Math.min(540, width * 0.9);
    const boardWidth = clamp(desiredBoardWidth, minBoardWidth, maxBoardWidth);
    const boardLeft = (width - boardWidth) / 2;
    const slotStep = boardWidth / pocketCount;

    return {
      width,
      height,
      pocketCount,
      boardWidth,
      boardLeft,
      slotStep,
      slotLeft: boardLeft + slotStep * 0.5,
      centerX: width * 0.5,
      gateY: height * 0.04,
      playTop: height * 0.11,
      playBottom: height * 0.91,
      chuteTop: height * 0.935,
      slotY: height * 0.97,
      ballRadius: clamp(minSide * 0.016, 7.5, 11),
      pegRadius: clamp(minSide * 0.0074, 3.5, 5.2),
      pegGlow: clamp(minSide * 0.014, 9, 15)
    };
  }

  function slotCenterX(index, metrics) {
    return metrics.slotLeft + metrics.slotStep * index;
  }

  function plinkoX(stepIndex, rights, metrics) {
    return metrics.centerX + (rights - stepIndex / 2) * metrics.slotStep;
  }

  function pegRows(width, height) {
    const metrics = boardMetrics(width, height);
    const rowGap = (metrics.playBottom - metrics.playTop) / Math.max(1, PLINKO_ROWS - 1);
    const rows = [];

    for (let rowIndex = 0; rowIndex < PLINKO_ROWS; rowIndex += 1) {
      const count = rowIndex + 1;
      const start = metrics.centerX - (rowIndex * metrics.slotStep) / 2;

      rows.push({
        rowIndex,
        count,
        start,
        gap: metrics.slotStep,
        y: metrics.playTop + rowIndex * rowGap
      });
    }

    return rows;
  }

  function createPegs(width, height) {
    const metrics = boardMetrics(width, height);
    const pegs = [];

    pegRows(width, height).forEach(function (row) {
      for (let index = 0; index < row.count; index += 1) {
        pegs.push({
          x: row.start + index * row.gap,
          y: row.y,
          r: metrics.pegRadius,
          rowIndex: row.rowIndex
        });
      }
    });

    return pegs;
  }

  function shuffledSteps(targetPocket, seed) {
    const rng = seededRandom(seed);
    const steps = [];

    for (let index = 0; index < PLINKO_ROWS; index += 1) {
      steps.push(index < targetPocket ? 1 : 0);
    }

    for (let index = steps.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(rng() * (index + 1));
      const value = steps[index];
      steps[index] = steps[swapIndex];
      steps[swapIndex] = value;
    }

    return steps;
  }

  function buildPlinkoTrace(targetPocket, seed) {
    const metrics = boardMetrics(state.view.width, state.view.height);
    const rows = pegRows(state.view.width, state.view.height);
    const pocket = clamp(Math.round(targetPocket), 0, metrics.pocketCount - 1);
    const steps = shuffledSteps(pocket, seed);
    const trace = [];
    const rowTime = 0.34;
    let rights = 0;
    let time = 0;

    trace.push({ x: metrics.centerX, y: metrics.gateY, t: time, ease: "fall" });
    time += 0.32;
    trace.push({ x: metrics.centerX, y: rows[0].y - metrics.pegRadius * 4, t: time, ease: "fall" });

    rows.forEach(function (row, rowIndex) {
      const hitX = plinkoX(rowIndex, rights, metrics);
      const hitY = row.y;
      const nextRights = rights + steps[rowIndex];
      const nextX = plinkoX(rowIndex + 1, nextRights, metrics);
      const nextY = rows[rowIndex + 1] ? rows[rowIndex + 1].y : metrics.chuteTop;
      const exitX = lerp(hitX, nextX, 0.7);
      const exitY = lerp(hitY, nextY, 0.45);

      time += rowTime * 0.3;
      trace.push({ x: hitX, y: hitY - metrics.pegRadius * 2.15, t: time, ease: "fall" });
      time += rowTime * 0.22;
      trace.push({ x: hitX, y: hitY, t: time, ease: "fall", hitRow: rowIndex });
      time += rowTime * 0.48;
      trace.push({ x: exitX, y: exitY, t: time, ease: "bounce" });

      rights = nextRights;
    });

    const targetX = slotCenterX(pocket, metrics);
    time += 0.3;
    trace.push({ x: targetX, y: metrics.chuteTop - metrics.ballRadius * 1.35, t: time, ease: "fall" });
    time += 0.3;
    trace.push({ x: targetX, y: metrics.slotY - metrics.ballRadius * 0.1, t: time, ease: "settle" });

    trace.durationMs = trace[trace.length - 1].t * 1000;
    trace.settleX = targetX;
    trace.settlePocket = pocket;

    return trace;
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
      connectWalletButton.textContent = "Connected";
      lastResultEl.textContent = state.mode === "live" ? liveReady ? "Token mode ready" : "Token config needed" : "Ready";
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
    lastResultEl.textContent = mode === "live" ? liveReady ? "Token mode ready" : "Token config needed" : "Ready";
    updateDisplay();
  }

  function setRisk(risk) {
    if (state.playing || !riskConfigs[risk]) {
      return;
    }

    state.risk = risk;
    state.lastPockets = [];
    riskButtons.forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.risk === risk);
    });
    updateDisplay();
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

  function updateDisplay() {
    const balls = selectedBallCount();
    const balance = configuredBalance();
    const maxPerBall = maxWholeWagerPerBall(balance || state.balance, balls);

    balanceLabelEl.textContent = state.mode === "demo" ? "Demo balance" : "Wallet balance";
    balanceEl.textContent = amountLabel(balance);
    profitEl.textContent = amountLabel(state.profit);
    roundCount.textContent = String(state.history.length);
    wagerInput.max = String(maxPerBall);
    ballCountValueEl.textContent = String(balls);
    playButton.querySelector("span").textContent = balls > 1 ? "Drop " + balls : "Drop";
    playButton.title = "RTP " + (expectedRtpForRisk(state.risk) * 100).toFixed(2) + "%";
  }

  function renderStrip() {
    const hits = state.lastPockets;
    multiplierStrip.innerHTML = "";

    riskOrder.forEach(function (risk) {
      const row = document.createElement("div");
      row.className = "multiplier-row";
      row.dataset.risk = risk;

      if (risk === state.risk) {
        row.classList.add("is-active");
      }

      stripSlotsForRisk(risk).forEach(function (multiplier, index) {
        const pocket = document.createElement("div");
        pocket.className = "pocket";
        pocket.textContent = multiplierLabel(multiplier);

        if (risk === state.risk && hits.indexOf(index) !== -1) {
          pocket.classList.add("is-hit");
        }

        row.appendChild(pocket);
      });

      multiplierStrip.appendChild(row);
    });
  }

  function renderHistory() {
    historyList.innerHTML = "";

    state.history.slice(0, 10).forEach(function (round) {
      const item = document.createElement("li");
      item.className = round.payout >= round.totalWager ? "is-win" : "is-loss";

      const main = document.createElement("span");
      main.className = "history-main";
      main.textContent = round.balls > 1 ? round.balls + " drops" : multiplierLabel(round.bestMultiplier);

      const side = document.createElement("span");
      side.className = "history-side";
      side.textContent = "PLINKO / " + round.risk.toUpperCase();

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
    bg.addColorStop(0, "#159aaa");
    bg.addColorStop(0.58, "#18a9a9");
    bg.addColorStop(1, "#0f8797");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    drawDropGate(width, height);
    drawPegs(width, height);
    drawSlotWalls(width, height);
    drawBalls(width, height);
  }

  function drawDropGate(width, height) {
    const metrics = boardMetrics(width, height);
    const topY = metrics.playTop - metrics.slotStep * 0.9;
    const midY = metrics.playTop + metrics.slotStep * 2.3;
    const bottomY = metrics.playTop + metrics.slotStep * 5.2;
    const sideWidth = metrics.slotStep * 4.2;

    ctx.save();
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(5, 92, 113, 0.58)";
    drawRoundedRect(metrics.boardLeft - sideWidth * 0.36, topY, sideWidth, bottomY - topY, 10);
    ctx.stroke();
    drawRoundedRect(metrics.boardLeft + metrics.boardWidth - sideWidth * 0.64, topY, sideWidth, bottomY - topY, 10);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(5, 92, 113, 0.35)";
    ctx.beginPath();
    ctx.moveTo(metrics.boardLeft + metrics.slotStep * 3.8, topY);
    ctx.quadraticCurveTo(metrics.boardLeft + metrics.slotStep * 3, midY, metrics.boardLeft + metrics.slotStep * 1.2, bottomY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(metrics.boardLeft + metrics.boardWidth - metrics.slotStep * 3.8, topY);
    ctx.quadraticCurveTo(metrics.boardLeft + metrics.boardWidth - metrics.slotStep * 3, midY, metrics.boardLeft + metrics.boardWidth - metrics.slotStep * 1.2, bottomY);
    ctx.stroke();
    ctx.restore();
  }

  function drawPegs(width, height) {
    const metrics = boardMetrics(width, height);
    const pegs = createPegs(width, height);

    ctx.save();
    pegs.forEach(function (peg, index) {
      const glow = ctx.createRadialGradient(peg.x, peg.y, 1, peg.x, peg.y, metrics.pegGlow);
      glow.addColorStop(0, "rgba(255,255,255,0.22)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, metrics.pegGlow, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#edf9ff";
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(5, 68, 82, 0.28)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawSlotWalls(width, height) {
    const metrics = boardMetrics(width, height);
    const floorY = metrics.slotY;

    ctx.save();
    ctx.strokeStyle = "rgba(5, 68, 82, 0.42)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(metrics.boardLeft, floorY);
    ctx.lineTo(metrics.boardLeft + metrics.boardWidth, floorY);
    ctx.stroke();
    ctx.restore();
  }

  function drawBalls(width, height) {
    const balls = state.animation ? state.animation.balls : [];
    const now = state.animation ? state.animation.frameTime || 0 : 0;

    balls.forEach(function (ball) {
      if (ball.settled) {
        return;
      }

      if (!ball.active) {
        if (now && ball.spawnAt - now <= 140) {
          drawQueuedBall(ball);
        }
        return;
      }

      drawTrail(ball);
      drawBall(ball);
    });
  }

  function drawQueuedBall(ball) {
    const point = ball.trace[0];

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#e3b448";
    ctx.beginPath();
    ctx.arc(point.x, point.y, ball.r, 0, Math.PI * 2);
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
    const fill = ctx.createRadialGradient(ball.x - ball.r * 0.38, ball.y - ball.r * 0.5, 1, ball.x, ball.y, ball.r);
    const shadow = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, ball.r * 2.8);

    ctx.save();
    shadow.addColorStop(0, "rgba(0,0,0,0.2)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r * 2.8, 0, Math.PI * 2);
    ctx.fill();

    fill.addColorStop(0, "#fff4c7");
    fill.addColorStop(0.32, ball.color || riskColors[state.risk]);
    fill.addColorStop(1, ball.color || riskColors[state.risk]);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(244,239,227,0.65)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  function createBall(index, total, wager, now, resolved) {
    const metrics = boardMetrics(state.view.width, state.view.height);
    const tier = resolved && Number.isFinite(Number(resolved.tier)) ? Number(resolved.tier) : weightedTier(activeWeights());
    const targetPocket = resolved && Number.isFinite(Number(resolved.pocket)) ? Number(resolved.pocket) : targetPocketFromTier(tier);
    const multiplier = resolved && Number.isFinite(Number(resolved.multiplier)) ? Number(resolved.multiplier) : stripSlots()[targetPocket];
    const trace = buildPlinkoTrace(targetPocket, randomSeed());
    const start = trace[0];
    const spawnDelay = total > 60 ? 72 : total > 30 ? 92 : total > 10 ? 120 : 170;

    return {
      id: index,
      wager,
      targetTier: tier,
      targetPocket,
      multiplier,
      color: riskColors[state.risk] || riskColors.medium,
      payout: resolved && Number.isFinite(Number(resolved.payout))
        ? roundMoney(Number(resolved.payout))
        : roundMoney(wager * multiplier),
      r: metrics.ballRadius,
      x: start.x,
      y: start.y,
      vx: 0,
      vy: 0,
      trace,
      traceIndex: 0,
      duration: trace.durationMs,
      spawnAt: now + index * spawnDelay,
      active: false,
      settled: false,
      pocket: null,
      trail: []
    };
  }

  function stepAnimation(animation, timestamp) {
    animation.frameTime = timestamp;

    animation.balls.forEach(function (ball) {
      if (ball.settled || timestamp < ball.spawnAt) {
        return;
      }

      if (!ball.active) {
        ball.active = true;
      }

      followTrace(ball, timestamp);

      if (!ball.settled) {
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 10) {
          ball.trail.shift();
        }
      }
    });
  }

  function followTrace(ball, timestamp) {
    const elapsed = timestamp - ball.spawnAt;
    const playback = clamp(elapsed / ball.duration, 0, 1);
    const trace = ball.trace;
    const traceTime = trace[trace.length - 1].t * playback;
    let index = ball.traceIndex || 0;

    while (index < trace.length - 2 && trace[index + 1].t < traceTime) {
      index += 1;
    }

    const current = trace[index];
    const next = trace[Math.min(trace.length - 1, index + 1)];
    const rawLocal = next.t > current.t ? clamp((traceTime - current.t) / (next.t - current.t), 0, 1) : 1;
    const local = ease(next.ease, rawLocal);
    const nextX = lerp(current.x, next.x, local);
    const nextY = lerp(current.y, next.y, local);
    const dt = Math.max(0.016, (timestamp - (ball.lastPathTimestamp || timestamp - 16)) / 1000);

    ball.traceIndex = index;
    ball.vx = (nextX - ball.x) / dt;
    ball.vy = (nextY - ball.y) / dt;
    ball.x = nextX;
    ball.y = nextY;
    ball.lastPathTimestamp = timestamp;

    if (playback >= 1) {
      settleBall(ball);
    }
  }

  function settleBall(ball) {
    if (ball.settled) {
      return;
    }

    ball.settled = true;
    ball.pocket = ball.targetPocket;
    ball.x = ball.trace.settleX;
    ball.y = ball.trace[ball.trace.length - 1].y;
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

    stepAnimation(state.animation, timestamp);
    drawBoard();

    if (state.animation.balls.every(function (ball) { return ball.settled; })) {
      finishRound();
      return;
    }

    window.requestAnimationFrame(animate);
  }

  function normalizeWagerForBalance(wager, balls) {
    const balanceForClamp = state.mode === "demo" ? state.balance : state.liveBalance;
    const shouldClamp = state.mode === "demo" || Number.isFinite(state.liveBalance);

    if (!shouldClamp) {
      return wager;
    }

    const maxPerBall = maxWholeWagerPerBall(balanceForClamp, balls);
    if (maxPerBall < 1) {
      return 0;
    }

    return Math.min(wager, maxPerBall);
  }

  function startRound() {
    if (state.playing) {
      return;
    }

    const balls = selectedBallCount();
    let wager = selectedWager();

    if (wager <= 0) {
      wager = 1;
    }

    wager = normalizeWagerForBalance(wager, balls);
    if (wager < 1) {
      wagerInput.value = "0";
      lastResultEl.textContent = "Not enough balance";
      updateDisplay();
      return;
    }

    wagerInput.value = String(wager);

    if (state.mode === "live") {
      startLiveRound(wager, balls);
      return;
    }

    startDemoAnimation(wager, balls);
  }

  function startDemoAnimation(wager, balls) {
    const now = performance.now();
    const totalWager = roundMoney(wager * balls);
    const ballList = [];

    for (let index = 0; index < balls; index += 1) {
      ballList.push(createBall(index, balls, wager, now));
    }

    state.balance = roundMoney(state.balance - totalWager);
    state.playing = true;
    state.lastPockets = [];
    state.animation = {
      balls: ballList,
      risk: state.risk,
      ballWager: wager,
      totalWager,
      startedAt: now,
      frameTime: now
    };

    playButton.disabled = true;
    lastResultEl.textContent = balls > 1 ? balls + " drops launched" : "Drop launched";
    updateDisplay();
    renderStrip();
    window.requestAnimationFrame(animate);
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

    if (animation.live) {
      if (Number.isFinite(state.liveBalance)) {
        state.liveBalance = roundMoney(state.liveBalance - animation.totalWager + totalPayout);
      }
    } else {
      state.balance = roundMoney(state.balance + totalPayout);
    }

    state.profit = roundMoney(state.profit + net);
    state.history.unshift({
      balls: animation.balls.length,
      risk: animation.risk,
      wager: animation.ballWager,
      totalWager: animation.totalWager,
      bestMultiplier,
      payout: totalPayout
    });

    state.animation = null;
    state.playing = false;
    playButton.disabled = false;
    lastResultEl.textContent = animation.balls.length > 1
      ? animation.balls.length + " drops / " + amountLabel(totalPayout)
      : multiplierLabel(bestMultiplier) + " / " + amountLabel(totalPayout);
    updateDisplay();
    renderStrip();
    renderHistory();
    drawBoard();
  }

  function base64ToBytes(value) {
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  async function signAndSendWagerTransaction(transactionBase64) {
    if (!transactionBase64) {
      throw new Error("Missing wager transaction");
    }

    if (!window.solanaWeb3 || !window.solanaWeb3.Transaction) {
      throw new Error("Solana web3 bundle missing");
    }

    if (!state.wallet.provider || !state.wallet.provider.signAndSendTransaction) {
      throw new Error("Wallet cannot send token transaction");
    }

    const transaction = window.solanaWeb3.Transaction.from(base64ToBytes(transactionBase64));
    const sent = await state.wallet.provider.signAndSendTransaction(transaction);

    if (typeof sent === "string") {
      return sent;
    }

    if (sent && sent.signature) {
      return sent.signature;
    }

    throw new Error("Wallet did not return payment signature");
  }

  function startVerifiedAnimation(result, payoutSignature) {
    const results = Array.isArray(result.results) ? result.results : [];

    if (!results.length) {
      throw new Error("Settled round had no ball results");
    }

    const now = performance.now();
    const totalWager = Number(result.totalWager || 0);
    const ballWager = Number(result.wager || results[0].wager || 0);
    const ballList = results.map(function (ballResult, index) {
      return createBall(
        index,
        results.length,
        Number(ballResult.wager || ballWager),
        now,
        ballResult
      );
    });

    state.lastPockets = [];
    state.animation = {
      balls: ballList,
      risk: result.risk || state.risk,
      ballWager,
      totalWager,
      startedAt: now,
      frameTime: now,
      live: true,
      paymentSignature: result.paymentSignature,
      payoutSignature
    };

    lastResultEl.textContent = results.length > 1 ? "Verified " + results.length + " drops" : "Verified drop";
    updateDisplay();
    renderStrip();
    window.requestAnimationFrame(animate);
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
    let animationStarted = false;

    try {
      const apiBase = config.apiBaseUrl.replace(/\/$/, "");
      const response = await fetch(apiBase + "/api/rounds/prepare", {
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
          sides: ["center"],
          tokenMint: config.token.mintAddress
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Wager prepare failed");
      }

      lastResultEl.textContent = "Sign wager";
      const paymentSignature = await signAndSendWagerTransaction(payload.wagerTransactionBase64);

      lastResultEl.textContent = "Settling wager";
      const settleResponse = await fetch(apiBase + "/api/rounds/settle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          roundId: payload.roundId,
          paymentSignature
        })
      });
      const settled = await settleResponse.json();

      if (!settleResponse.ok) {
        throw new Error(settled.error || "Wager settle failed");
      }

      lastResultEl.textContent = "Paid " + amountLabel(Number(settled.payout || 0));
      startVerifiedAnimation(settled.result, settled.payoutSignature);
      animationStarted = true;
    } catch (error) {
      lastResultEl.textContent = error.message || "Token wager failed";
    } finally {
      if (!animationStarted) {
        state.playing = false;
        playButton.disabled = false;
        updateDisplay();
      }
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
    multiplierStrip.style.width = boardMetrics(width, height).boardWidth + "px";
    drawBoard();
  }

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
    wagerInput.value = String(Math.max(0, Math.floor(balance / (2 * selectedBallCount()))));
  });

  maxButton.addEventListener("click", function () {
    const balance = configuredBalance() || state.balance;
    wagerInput.value = String(maxWholeWagerPerBall(balance, selectedBallCount()));
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
    lastResultEl.textContent = "Ready";
    updateDisplay();
    renderStrip();
    renderHistory();
    drawBoard();
  });

  wagerInput.addEventListener("blur", function () {
    const maxPerBall = maxWholeWagerPerBall(configuredBalance() || state.balance, selectedBallCount());
    wagerInput.value = String(maxPerBall < 1 ? 0 : clamp(selectedWager(), 1, maxPerBall));
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
  setBallCount(1);
  updateDisplay();
  renderStrip();
  renderHistory();
  resizeCanvas();
}());
