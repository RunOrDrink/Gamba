(function () {
  "use strict";

  const STARTING_BALANCE = 1000;
  const MAX_BALLS = 100;
  const TARGET_RTP = 0.985;

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
      multipliers: [0, 0.75, 0.9, 1, 1.01, 1.05, 1.25, 2],
      weights: [0.02, 0.015, 0.015, 0.829, 0.04, 0.067, 0.01, 0.004]
    },
    medium: {
      multipliers: [0, 0.2, 0.5, 0.8, 1, 1.5, 3, 12],
      weights: [0.15, 0.07, 0.05, 0.03, 0.451, 0.214, 0.03, 0.005]
    },
    high: {
      multipliers: [0, 0.1, 0.25, 0.6, 1.5, 5, 18, 75],
      weights: [0.35, 0.13, 0.08, 0.04, 0.376, 0.014, 0.008, 0.002]
    }
  };

  const HONEYCOMB_COLUMNS = 17;
  const TOP_ROW_EXTRA_EACH_SIDE = [0, 2, 2, 2, 1, 1];
  const WEIGHT_SCALE = 1000000;
  const MATTER_STATIC_CATEGORY = 0x0001;
  const MATTER_BALL_CATEGORY = 0x0002;

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

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function traceEase(kind, t) {
    if (kind === "fall") {
      return t;
    }

    if (kind === "bounce") {
      return 1 - Math.pow(1 - t, 2);
    }

    return t;
  }

  function selectedWager() {
    const value = Number(wagerInput.value);
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.floor(value);
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

  function maxWholeWagerPerBall(balance, balls) {
    if (!Number.isFinite(balance)) {
      return 0;
    }

    return Math.floor(Math.max(0, balance) / Math.max(1, balls));
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
    const scaledWeights = weights.map(function (weight) {
      return Math.round(weight * WEIGHT_SCALE);
    });
    const total = scaledWeights.reduce(function (sum, weight) {
      return sum + weight;
    }, 0);
    let roll = Math.floor(secureRandom() * total);

    for (let index = 0; index < scaledWeights.length; index += 1) {
      roll -= scaledWeights[index];
      if (roll <= 0) {
        return index;
      }
    }

    return scaledWeights.length - 1;
  }

  function expectedRtpForRisk(risk) {
    const riskConfig = riskConfigs[risk];
    return riskConfig.weights.reduce(function (sum, weight, index) {
      return sum + weight * riskConfig.multipliers[index];
    }, 0);
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
    const slotStep = width / pocketCount;
    const slotY = height - clamp(height * 0.014, 8, 12);
    const chuteHeight = clamp(height * 0.032, 22, 36);
    const chuteTop = slotY - chuteHeight;
    const playBottom = chuteTop - clamp(height * 0.032, 20, 32);

    return {
      width,
      height,
      left: width * 0.025,
      right: width * 0.975,
      top: height * 0.06,
      gateY: height * 0.09,
      playTop: height * 0.17,
      playBottom,
      chuteTop,
      slotY,
      centerX: width * 0.5,
      pegLeft: slotStep * 0.5,
      pegRight: width - slotStep * 0.5,
      ballRadius: clamp(minSide * 0.0105, 4.2, 6.2),
      pegRadius: clamp(minSide * 0.0068, 3, 4.8),
      pocketCount,
      slotStep,
      slotLeft: slotStep * 0.5
    };
  }

  function slotCenterX(index, metrics) {
    return metrics.slotLeft + metrics.slotStep * index;
  }

  function pegRows(width, height) {
    const metrics = boardMetrics(width, height);
    const fullColumns = HONEYCOMB_COLUMNS;
    const fullGap = (metrics.pegRight - metrics.pegLeft) / (fullColumns - 1);
    const rowGap = fullGap * Math.sqrt(3) / 2;
    const availableHeight = metrics.playBottom - metrics.playTop;
    let rowCount = Math.max(9, Math.floor(availableHeight / rowGap) + 1);
    const topKeepRatio = 0.48;
    const shoulderRows = 8;

    if (rowCount % 2 === 0) {
      rowCount -= 1;
    }

    const startY = metrics.playBottom - (rowCount - 1) * rowGap;
    const rows = [];

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const isOffset = rowIndex % 2 === 1;
      const baseCount = isOffset ? fullColumns - 1 : fullColumns;
      const baseStart = metrics.pegLeft + (isOffset ? fullGap / 2 : 0);
      const rowProgress = clamp(rowIndex / shoulderRows, 0, 1);
      const keepRatio = lerp(topKeepRatio, 1, smoothstep(rowProgress));
      const rowExtra = (TOP_ROW_EXTRA_EACH_SIDE[rowIndex] || 0) * 2;
      const keepCount = Math.min(baseCount, Math.max(7, Math.round(baseCount * keepRatio) + rowExtra));
      const parityAdjustedCount = keepCount % 2 === baseCount % 2 ? keepCount : keepCount + 1;
      const count = Math.min(baseCount, parityAdjustedCount);
      const trim = Math.floor((baseCount - count) / 2);
      const start = baseStart + trim * fullGap;

      rows.push({
        count,
        rowIndex,
        y: startY + rowIndex * rowGap,
        span: fullGap * (count - 1),
        start,
        gap: fullGap
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
          x: row.start + row.gap * index,
          y: row.y,
          r: metrics.pegRadius
        });
      }
    });

    return pegs;
  }

  function launchXForSide(side, metrics) {
    if (side === "left") {
      return metrics.width * 0.37;
    }

    if (side === "right") {
      return metrics.width * 0.63;
    }

    return metrics.centerX;
  }

  function seededRandom(seed) {
    let value = seed >>> 0;

    return function () {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function randomSeed() {
    return Math.floor(secureRandom() * 4294967295) >>> 0;
  }

  function pocketFromX(x, metrics) {
    return clamp(Math.floor(x / metrics.slotStep), 0, metrics.pocketCount - 1);
  }

  function rowDeflection(row, incomingX, side, clearance) {
    const pegIndex = clamp(Math.round((incomingX - side * clearance * 0.7 - row.start) / row.gap), 0, row.count - 1);
    const pegX = row.start + row.gap * pegIndex;

    return {
      x: pegX + side * clearance,
      pegX,
      side
    };
  }

  function matterReady() {
    return Boolean(
      window.Matter &&
      window.Matter.Engine &&
      window.Matter.Bodies &&
      window.Matter.Body &&
      window.Matter.Composite
    );
  }

  function matterProfile(risk) {
    if (risk === "low") {
      return { restitution: 0.78, pegRestitution: 0.84, friction: 0.004, frictionAir: 0.0034, gravityScale: 0.0012 };
    }

    if (risk === "high") {
      return { restitution: 0.88, pegRestitution: 0.94, friction: 0.002, frictionAir: 0.0024, gravityScale: 0.00138 };
    }

    return { restitution: 0.83, pegRestitution: 0.9, friction: 0.003, frictionAir: 0.0028, gravityScale: 0.0013 };
  }

  function matterStaticOptions(profile) {
    return {
      isStatic: true,
      restitution: profile.pegRestitution,
      friction: 0.01,
      frictionStatic: 0,
      collisionFilter: {
        category: MATTER_STATIC_CATEGORY,
        mask: MATTER_BALL_CATEGORY
      }
    };
  }

  function createMatterEngine(metrics, profile) {
    const Matter = window.Matter;
    const engine = Matter.Engine.create({
      enableSleeping: false
    });
    const staticOptions = matterStaticOptions(profile);
    const wallWidth = clamp(metrics.slotStep * 0.035, 2, 4);
    const floorY = metrics.slotY + metrics.ballRadius * 1.1;
    const chuteHeight = Math.max(metrics.ballRadius * 3, floorY - metrics.chuteTop);
    const walls = [
      Matter.Bodies.rectangle(metrics.width / 2, floorY + wallWidth / 2, metrics.width + wallWidth * 2, wallWidth, staticOptions),
      Matter.Bodies.rectangle(-wallWidth, metrics.height / 2, wallWidth * 2, metrics.height * 2, staticOptions),
      Matter.Bodies.rectangle(metrics.width + wallWidth, metrics.height / 2, wallWidth * 2, metrics.height * 2, staticOptions)
    ];

    engine.gravity.x = 0;
    engine.gravity.y = 1;
    engine.gravity.scale = profile.gravityScale;
    engine.positionIterations = 10;
    engine.velocityIterations = 10;
    engine.constraintIterations = 2;

    createPegs(metrics.width, metrics.height).forEach(function (peg) {
      walls.push(Matter.Bodies.circle(peg.x, peg.y, peg.r, staticOptions));
    });

    for (let index = 0; index <= metrics.pocketCount; index += 1) {
      const x = metrics.slotStep * index;
      walls.push(Matter.Bodies.rectangle(
        x,
        metrics.chuteTop + chuteHeight / 2,
        wallWidth,
        chuteHeight,
        staticOptions
      ));
    }

    Matter.Composite.add(engine.world, walls);
    return engine;
  }

  function runMatterCandidate(options, metrics, profile, candidate, captureTrace) {
    const Matter = window.Matter;
    const engine = createMatterEngine(metrics, profile);
    const ball = Matter.Bodies.circle(candidate.x, candidate.y, metrics.ballRadius, {
      restitution: profile.restitution,
      friction: profile.friction,
      frictionStatic: 0,
      frictionAir: profile.frictionAir,
      density: 0.001,
      collisionFilter: {
        category: MATTER_BALL_CATEGORY,
        mask: MATTER_STATIC_CATEGORY
      }
    });
    const stepMs = 1000 / 60;
    const maxSteps = 420;
    const trace = captureTrace ? [{ x: candidate.x, y: candidate.y, t: 0, ease: "fall" }] : null;
    let settled = false;
    let finalX = candidate.x;
    let finalY = candidate.y;

    Matter.Body.setVelocity(ball, { x: candidate.vx, y: candidate.vy });
    Matter.Body.setAngularVelocity(ball, candidate.spin);
    Matter.Composite.add(engine.world, ball);

    for (let step = 1; step <= maxSteps; step += 1) {
      Matter.Engine.update(engine, stepMs);
      finalX = ball.position.x;
      finalY = ball.position.y;

      if (captureTrace && step % 2 === 0) {
        trace.push({
          x: finalX,
          y: finalY,
          t: step * stepMs / 1000,
          ease: "physics"
        });
      }

      if (finalY >= metrics.slotY - metrics.ballRadius * 0.1) {
        settled = true;
        break;
      }

      if (finalY > metrics.height + metrics.ballRadius * 8) {
        break;
      }
    }

    const pocket = pocketFromX(finalX, metrics);
    const settleX = clamp(
      finalX,
      pocket * metrics.slotStep + metrics.ballRadius * 1.35,
      (pocket + 1) * metrics.slotStep - metrics.ballRadius * 1.35
    );

    if (captureTrace) {
      trace.push({
        x: settleX,
        y: metrics.slotY - metrics.ballRadius * 0.1,
        t: Math.max((trace[trace.length - 1] || { t: 0 }).t + 0.08, engine.timing.timestamp / 1000),
        ease: "fall"
      });
      trace.durationMs = clamp(engine.timing.timestamp * 0.78, 2300, 6200);
      trace.settlePocket = pocket;
      trace.settleX = settleX;
    }

    Matter.Composite.clear(engine.world, false);
    Matter.Engine.clear(engine);

    return {
      pocket,
      finalX: settleX,
      settled,
      trace
    };
  }

  function matterCandidate(index, rng, options, metrics) {
    const launchX = launchXForSide(options.side, metrics);
    const launchSpread = metrics.slotStep * 0.42;
    const controlledBias = index < 8 ? (index - 3.5) / 3.5 : rng() * 2 - 1;
    const randomBias = rng() * 2 - 1;

    return {
      x: clamp(
        launchX + controlledBias * launchSpread * 0.45 + randomBias * launchSpread * 0.18,
        metrics.left + metrics.ballRadius,
        metrics.right - metrics.ballRadius
      ),
      y: metrics.gateY + options.queueOffset + options.verticalJitter,
      vx: (rng() - 0.5) * 0.42,
      vy: 0.02 + rng() * 0.06,
      spin: (rng() - 0.5) * 0.035,
      driftSeed: rng() * Math.PI * 2
    };
  }

  function chooseMatterPlan(options, metrics, profile, rng) {
    return matterCandidate(0, rng, options, metrics);
  }

  function buildMatterDropTrace(options) {
    if (!matterReady()) {
      return null;
    }

    const metrics = boardMetrics(state.view.width, state.view.height);
    const profile = matterProfile(options.risk);
    const rng = seededRandom(options.seed);
    const plan = chooseMatterPlan(options, metrics, profile, rng);
    const result = runMatterCandidate(options, metrics, profile, plan, true);

    return result.trace;
  }

  function buildDropTrace(options) {
    return buildPlannedDropTrace(options);
  }

  function createLiveMatterPhysics(width, height, risk) {
    const metrics = boardMetrics(width, height);

    return {
      engine: createMatterEngine(metrics, matterProfile(risk)),
      metrics,
      profile: matterProfile(risk),
      accumulator: 0,
      lastTime: null
    };
  }

  function createLiveMatterBody(ball, physics) {
    const Matter = window.Matter;
    const launch = ball.matterLaunch;
    const body = Matter.Bodies.circle(launch.x, launch.y, ball.r, {
      restitution: physics.profile.restitution,
      friction: physics.profile.friction,
      frictionStatic: 0,
      frictionAir: physics.profile.frictionAir,
      density: 0.001,
      collisionFilter: {
        category: MATTER_BALL_CATEGORY,
        mask: MATTER_STATIC_CATEGORY
      }
    });

    Matter.Body.setVelocity(body, { x: launch.vx, y: launch.vy });
    Matter.Body.setAngularVelocity(body, launch.spin);
    Matter.Composite.add(physics.engine.world, body);

    ball.body = body;
    ball.active = true;
    ball.x = launch.x;
    ball.y = launch.y;
  }

  function settleMatterBall(ball, animation) {
    if (ball.settled) {
      return;
    }

    const Matter = window.Matter;
    const metrics = animation.physics.metrics;
    const body = ball.body;
    const pocket = pocketFromX(body.position.x, metrics);
    const settleX = clamp(
      body.position.x,
      pocket * metrics.slotStep + ball.r * 1.35,
      (pocket + 1) * metrics.slotStep - ball.r * 1.35
    );
    const multiplier = stripSlots()[pocket];

    if (!ball.lockedPayout) {
      ball.targetPocket = pocket;
      ball.multiplier = multiplier;
      ball.payout = roundMoney(ball.wager * multiplier);
    }

    ball.settled = true;
    ball.pocket = ball.targetPocket;
    ball.settleX = settleX;
    ball.x = settleX;
    ball.y = metrics.slotY - ball.r * 0.1;
    ball.vx = 0;
    ball.vy = 0;
    ball.trail = [];

    Matter.Composite.remove(animation.physics.engine.world, body);
    ball.body = null;

    state.lastPockets = animation.balls
      .filter(function (candidate) {
        return candidate.settled;
      })
      .map(function (candidate) {
        return candidate.pocket;
      });
    renderStrip();
  }

  function applyNaturalDrift(ball, physics, timestamp) {
    if (!ball.body || ball.settled) {
      return;
    }

    const body = ball.body;
    const metrics = physics.metrics;

    if (body.position.y < metrics.playTop || body.position.y > metrics.playBottom) {
      return;
    }

    const dx = clamp((ball.driftTargetX - body.position.x) / metrics.width, -0.7, 0.7);
    const progress = clamp((body.position.y - metrics.playTop) / Math.max(1, metrics.playBottom - metrics.playTop), 0, 1);
    const fade = 1 - smoothstep(clamp((progress - 0.72) / 0.28, 0, 1));
    const wobble = Math.sin(timestamp * 0.004 + ball.driftSeed) * 0.28;
    const forceX = body.mass * 0.00012 * ball.driftStrength * fade * (dx + wobble * 0.12);

    window.Matter.Body.applyForce(body, body.position, {
      x: forceX,
      y: 0
    });
  }

  function stepLiveMatterPhysics(animation, timestamp) {
    const physics = animation.physics;
    const stepMs = 1000 / 60;

    if (!physics.lastTime) {
      physics.lastTime = timestamp;
    }

    animation.frameTime = timestamp;

    animation.balls.forEach(function (ball) {
      if (!ball.active && !ball.settled && timestamp >= ball.spawnAt) {
        createLiveMatterBody(ball, physics);
      }

      if (ball.active && !ball.settled) {
        applyNaturalDrift(ball, physics, timestamp);
      }
    });

    physics.accumulator += clamp(timestamp - physics.lastTime, 0, 50);
    physics.lastTime = timestamp;

    while (physics.accumulator >= stepMs) {
      window.Matter.Engine.update(physics.engine, stepMs);
      physics.accumulator -= stepMs;
    }

    animation.balls.forEach(function (ball) {
      if (!ball.active || ball.settled || !ball.body) {
        return;
      }

      ball.x = ball.body.position.x;
      ball.y = ball.body.position.y;
      ball.vx = ball.body.velocity.x;
      ball.vy = ball.body.velocity.y;

      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 12) {
        ball.trail.shift();
      }

      if (
        ball.y >= physics.metrics.slotY - ball.r * 0.1 ||
        (timestamp - ball.spawnAt > 9000 && ball.y > physics.metrics.playBottom)
      ) {
        settleMatterBall(ball, animation);
      }
    });
  }

  function plannedRowStep(row, x, side, metrics, profile, clearance, noise) {
    const impact = rowDeflection(row, x, side, clearance);
    const hitX = clamp(
      impact.x,
      metrics.left + metrics.ballRadius,
      metrics.right - metrics.ballRadius
    );
    const maxStep = row.gap * 1.35;
    const boundedHitX = clamp(hitX, x - maxStep, x + maxStep);
    const sameSideKick = impact.side * row.gap * profile.bounce;
    const exitDesiredX = boundedHitX + sameSideKick + noise.wobble * row.gap * profile.wobble;
    const exitX = clamp(
      exitDesiredX,
      Math.max(metrics.left + metrics.ballRadius, x - maxStep),
      Math.min(metrics.right - metrics.ballRadius, x + maxStep)
    );

    return {
      hitX: boundedHitX,
      exitX,
      side: impact.side
    };
  }

  function pocketDistance(x, pocketLeft, pocketRight, targetX) {
    if (x < pocketLeft) {
      return pocketLeft - x + Math.abs(targetX - x) * 0.25;
    }

    if (x > pocketRight) {
      return x - pocketRight + Math.abs(targetX - x) * 0.25;
    }

    return Math.abs(targetX - x) * 0.05;
  }

  function chooseBouncePlan(rows, metrics, launchX, targetPocket, profile, clearance, rng) {
    const targetX = slotCenterX(targetPocket, metrics);
    const pocketLeft = targetPocket * metrics.slotStep + metrics.ballRadius * 1.35;
    const pocketRight = (targetPocket + 1) * metrics.slotStep - metrics.ballRadius * 1.35;
    const noise = rows.map(function () {
      return {
        wobble: rng() - 0.5,
        rowTime: profile.rowTime + rng() * 0.05
      };
    });
    let states = [{
      x: launchX,
      sides: [],
      score: 0,
      lastSide: 0
    }];

    rows.forEach(function (row, rowIndex) {
      const progress = (rowIndex + 1) / (rows.length + 1);
      const guideX = lerp(launchX, targetX, smoothstep(progress));
      const remainingRows = Math.max(0, rows.length - rowIndex - 1);
      const naturalReach = remainingRows * row.gap * (0.42 + profile.bounce);
      const expanded = [];

      states.forEach(function (stateItem) {
        [-1, 1].forEach(function (side) {
          const step = plannedRowStep(row, stateItem.x, side, metrics, profile, clearance, noise[rowIndex]);
          const corridorCost = Math.abs(step.exitX - guideX) * 0.18;
          const recoveryCost = Math.max(0, Math.abs(step.exitX - targetX) - naturalReach) * 0.85;
          const switchCost = stateItem.lastSide && stateItem.lastSide !== side ? row.gap * 0.018 : 0;
          const randomness = (rng() - 0.5) * row.gap * 0.03;

          expanded.push({
            x: step.exitX,
            sides: stateItem.sides.concat(side),
            score: stateItem.score * 0.94 + corridorCost + recoveryCost + switchCost + randomness,
            lastSide: side
          });
        });
      });

      expanded.sort(function (a, b) {
        return a.score - b.score;
      });
      states = expanded.slice(0, 64);
    });

    states.sort(function (a, b) {
      const aScore = a.score + pocketDistance(a.x, pocketLeft, pocketRight, targetX) * 4;
      const bScore = b.score + pocketDistance(b.x, pocketLeft, pocketRight, targetX) * 4;
      return aScore - bScore;
    });

    return {
      sides: states[0] ? states[0].sides : [],
      noise
    };
  }

  function buildPlannedDropTrace(options) {
    const width = state.view.width;
    const height = state.view.height;
    const metrics = boardMetrics(width, height);
    const rows = pegRows(width, height);
    const rng = seededRandom(options.seed);
    const launchX = launchXForSide(options.side, metrics);
    const profile = {
      low: { wobble: 0.04, rowTime: 0.27, bounce: 0.32 },
      medium: { wobble: 0.06, rowTime: 0.25, bounce: 0.44 },
      high: { wobble: 0.09, rowTime: 0.23, bounce: 0.56 }
    }[options.risk] || { wobble: 0.06, rowTime: 0.25, bounce: 0.44 };
    const clearance = metrics.pegRadius + metrics.ballRadius * 0.9;
    const pocketLeft = options.targetPocket * metrics.slotStep + metrics.ballRadius * 1.35;
    const pocketRight = (options.targetPocket + 1) * metrics.slotStep - metrics.ballRadius * 1.35;
    const trace = [{
      x: launchX,
      y: metrics.gateY + options.queueOffset + options.verticalJitter,
      t: 0
    }];
    let x = launchX;
    let time = 0;

    if (rows.length) {
      const firstRowY = rows[0].y;

      time += 0.16;
      trace.push({
        x: launchX,
        y: lerp(metrics.gateY, firstRowY, 0.12),
        t: time,
        ease: "fall"
      });
      time += 0.2;
      trace.push({
        x: launchX,
        y: lerp(metrics.gateY, firstRowY, 0.45),
        t: time,
        ease: "fall"
      });
      time += 0.26;
      trace.push({
        x: launchX,
        y: firstRowY - metrics.pegRadius * 3.8,
        t: time,
        ease: "fall"
      });
      x = launchX;
    }

    const plan = chooseBouncePlan(rows, metrics, launchX, options.targetPocket, profile, clearance, rng);

    rows.forEach(function (row, rowIndex) {
      const noise = plan.noise[rowIndex] || {
        wobble: rng() - 0.5,
        rowTime: profile.rowTime + rng() * 0.05
      };
      const side = plan.sides[rowIndex] || (rng() >= 0.5 ? 1 : -1);
      const step = plannedRowStep(row, x, side, metrics, profile, clearance, noise);
      const rowTime = noise.rowTime * (rowIndex < 3 ? 1.28 : 1);
      const aboveY = row.y - metrics.pegRadius * 2.3;
      const exitY = row.y + metrics.pegRadius * 2.4;

      time += rowTime * 0.36;
      trace.push({ x, y: aboveY, t: time, ease: "fall" });
      time += rowTime * 0.28;
      trace.push({ x: step.hitX, y: row.y, t: time });
      time += rowTime * 0.36;
      trace.push({ x: step.exitX, y: exitY, t: time, ease: "bounce" });
      x = step.exitX;
    });

    const chuteX = clamp(x, pocketLeft, pocketRight);

    time += 0.22;
    trace.push({
      x: chuteX,
      y: metrics.chuteTop - metrics.ballRadius * 1.6,
      t: time,
      ease: "fall"
    });
    time += 0.18;
    trace.push({
      x: chuteX,
      y: metrics.chuteTop + metrics.ballRadius * 1.2,
      t: time,
      ease: "fall"
    });
    time += 0.22;
    trace.push({
      x: chuteX,
      y: lerp(metrics.chuteTop, metrics.slotY, 0.56),
      t: time,
      ease: "fall"
    });
    time += 0.22;
    trace.push({
      x: chuteX,
      y: metrics.slotY - metrics.ballRadius * 0.1,
      t: time,
      ease: "fall"
    });

    return trace;
  }

  function updateDisplay() {
    const balance = configuredBalance();
    const ballCount = selectedBallCount();
    const maxPerBall = maxWholeWagerPerBall(balance || state.balance, ballCount);

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
    drawSlotWalls(width, height);
    drawBalls(width, height);
  }

  function drawLaunchGates(width, height) {
    const metrics = boardMetrics(width, height);
    const gateWidth = clamp(width * 0.052, 38, 54);
    const gateHeight = clamp(height * 0.07, 30, 42);
    const bandX = width * 0.31;
    const bandY = metrics.gateY - gateHeight * 0.95;
    const bandWidth = width * 0.38;
    const bandHeight = gateHeight * 1.9;

    ctx.save();
    drawRoundedRect(bandX, bandY, bandWidth, bandHeight, 8);
    ctx.fillStyle = "rgba(244,239,227,0.035)";
    ctx.fill();
    ctx.strokeStyle = "rgba(244,239,227,0.1)";
    ctx.stroke();
    drawGate(launchXForSide("left", metrics), metrics.gateY, "L", gateWidth, gateHeight, state.selectedSides.indexOf("left") !== -1);
    drawGate(metrics.centerX, metrics.gateY, "C", gateWidth, gateHeight, state.selectedSides.indexOf("center") !== -1);
    drawGate(launchXForSide("right", metrics), metrics.gateY, "R", gateWidth, gateHeight, state.selectedSides.indexOf("right") !== -1);
    ctx.restore();
  }

  function drawGate(x, y, label, width, height, active) {
    ctx.save();
    ctx.translate(x, y);
    drawRoundedRect(-width / 2, -height / 2, width, height, 8);
    ctx.fillStyle = active ? "rgba(71,199,143,0.18)" : "rgba(244,239,227,0.07)";
    ctx.fill();
    ctx.strokeStyle = active ? "rgba(71,199,143,0.6)" : "rgba(244,239,227,0.18)";
    ctx.stroke();
    ctx.fillStyle = active ? "#47c78f" : "#f4efe3";
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

  function drawSlotWalls(width, height) {
    const metrics = boardMetrics(width, height);
    const wallWidth = clamp(metrics.slotStep * 0.035, 2, 4);
    const floorY = metrics.slotY + metrics.ballRadius * 1.1;

    ctx.save();
    ctx.fillStyle = "rgba(244,239,227,0.018)";
    ctx.fillRect(0, metrics.chuteTop, width, Math.max(0, floorY - metrics.chuteTop));
    ctx.strokeStyle = "rgba(244,239,227,0.12)";
    ctx.lineWidth = wallWidth;
    ctx.lineCap = "round";

    for (let index = 0; index <= metrics.pocketCount; index += 1) {
      const x = metrics.slotStep * index;
      ctx.beginPath();
      ctx.moveTo(x, metrics.chuteTop);
      ctx.lineTo(x, floorY);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(227,180,72,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, metrics.chuteTop);
    ctx.lineTo(width, metrics.chuteTop);
    ctx.stroke();
    ctx.restore();
  }

  function drawBalls(width, height) {
    const balls = state.animation ? state.animation.balls : state.restingBalls;
    const frameTime = state.animation ? state.animation.frameTime || 0 : 0;
    if (!balls.length) {
      return;
    }

    balls.forEach(function (ball) {
      if (ball.settled) {
        return;
      }

      if (!ball.active && !ball.settled) {
        if (frameTime && ball.spawnAt - frameTime <= 130) {
          drawQueuedBall(ball, width, height);
        }

        return;
      }

      drawTrail(ball);
      drawBall(ball);
    });
  }

  function drawQueuedBall(ball, width, height) {
    const metrics = boardMetrics(width, height);
    const x = ball.matterLaunch ? ball.matterLaunch.x : launchXForSide(ball.side, metrics);
    const y = ball.matterLaunch ? ball.matterLaunch.y : metrics.gateY + ball.queueOffset;

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
    const shadow = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, ball.r * 2.8);
    shadow.addColorStop(0, "rgba(71,199,143,0.32)");
    shadow.addColorStop(1, "rgba(71,199,143,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r * 2.8, 0, Math.PI * 2);
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
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  function chooseSide() {
    const sides = state.selectedSides.length ? state.selectedSides : ["center"];
    return sides[Math.floor(secureRandom() * sides.length)];
  }

  function createBall(index, total, wager, side, now, targetTier, resolved) {
    const height = state.view.height;
    const metrics = boardMetrics(state.view.width, height);
    const queueOffset = 0;
    const verticalJitter = 0;
    const targetPocket = resolved && Number.isFinite(Number(resolved.pocket))
      ? Number(resolved.pocket)
      : targetPocketFromTier(targetTier);
    const spawnDelay = total > 60 ? 75 : total > 30 ? 95 : total > 10 ? 125 : 180;
    const traceOptions = {
      side,
      targetPocket,
      ballIndex: index,
      totalBalls: total,
      queueOffset,
      verticalJitter,
      risk: state.risk,
      seed: randomSeed()
    };
    const canUseLiveMatter = matterReady();
    const matterLaunch = canUseLiveMatter
      ? matterCandidate(index, seededRandom(traceOptions.seed), traceOptions, metrics)
      : null;
    const trace = canUseLiveMatter ? null : buildDropTrace(traceOptions);
    const start = canUseLiveMatter ? matterLaunch : trace[0];
    const displayPocket = targetPocket;
    const multiplier = resolved && Number.isFinite(Number(resolved.multiplier))
      ? Number(resolved.multiplier)
      : stripSlots()[displayPocket];
    const duration = trace ? trace.durationMs || Math.max(3200, trace[trace.length - 1].t * 1250) : 0;

    return {
      id: index,
      side,
      risk: state.risk,
      wager,
      targetTier,
      targetPocket: displayPocket,
      settleX: trace && Number.isFinite(Number(trace.settleX)) ? Number(trace.settleX) : start.x,
      r: metrics.ballRadius,
      x: start.x,
      y: start.y,
      vx: 0,
      vy: 0,
      trace,
      duration,
      traceIndex: 0,
      spawnAt: now + index * spawnDelay,
      queueOffset,
      active: false,
      settled: false,
      pocket: null,
      multiplier,
      payout: resolved && Number.isFinite(Number(resolved.payout))
        ? roundMoney(Number(resolved.payout))
        : roundMoney(wager * multiplier),
      lockedPayout: Boolean(resolved),
      matterLaunch,
      driftTargetX: slotCenterX(displayPocket, metrics),
      driftSeed: matterLaunch ? matterLaunch.driftSeed : randomSeed(),
      driftStrength: resolved ? 1 : 0.45,
      trail: []
    };
  }

  function stepPhysics(animation, timestamp) {
    if (animation.physics) {
      stepLiveMatterPhysics(animation, timestamp);
      return;
    }

    if (!animation.lastTime) {
      animation.lastTime = timestamp;
    }

    animation.frameTime = timestamp;
    animation.lastTime = timestamp;

    animation.balls.forEach(function (ball) {
      if (ball.settled || timestamp < ball.spawnAt) {
        return;
      }

      if (!ball.active) {
        ball.active = true;
      }

      followBallTrace(ball, timestamp);

      if (!ball.settled) {
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 12) {
          ball.trail.shift();
        }
      }
    });
  }

  function followBallTrace(ball, timestamp) {
    const metrics = boardMetrics(state.view.width, state.view.height);
    const elapsed = Math.max(0, timestamp - ball.spawnAt);
    const trace = ball.trace;
    const traceEnd = trace[trace.length - 1].t;
    const playback = clamp(elapsed / ball.duration, 0, 1);
    const traceTime = traceEnd * playback;
    let index = ball.traceIndex || 0;

    while (index < trace.length - 2 && trace[index + 1].t < traceTime) {
      index += 1;
    }

    const current = trace[index];
    const next = trace[Math.min(trace.length - 1, index + 1)];
    const rawLocal = next.t > current.t ? clamp((traceTime - current.t) / (next.t - current.t), 0, 1) : 1;
    const local = traceEase(next.ease, rawLocal);
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
      ball.x = Number.isFinite(ball.settleX) ? ball.settleX : slotCenterX(ball.targetPocket, metrics);
      ball.y = metrics.slotY - ball.r * 0.1;
      settleBall(ball);
    }
  }

  function settleBall(ball) {
    if (ball.settled) {
      return;
    }

    const metrics = boardMetrics(state.view.width, state.view.height);
    const targetX = Number.isFinite(ball.settleX) ? ball.settleX : slotCenterX(ball.targetPocket, metrics);
    const targetY = metrics.slotY - ball.r * 0.1;
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

    let wager = selectedWager();
    const balls = selectedBallCount();

    if (wager <= 0) {
      wager = 1;
    }

    const balanceForClamp = state.mode === "demo" ? state.balance : state.liveBalance;
    const shouldClampToBalance = state.mode === "demo" || Number.isFinite(state.liveBalance);

    if (shouldClampToBalance) {
      const maxPerBall = maxWholeWagerPerBall(balanceForClamp, balls);

      if (maxPerBall < 1) {
        wagerInput.value = "0";
        lastResultEl.textContent = "Not enough balance";
        updateDisplay();
        return;
      }

      if (wager > maxPerBall) {
        wager = maxPerBall;
      }
    }

    wagerInput.value = String(wager);
    const totalWager = roundMoney(wager * balls);

    if (wager <= 0) {
      wagerInput.value = "1";
      return;
    }

    if (state.mode === "live") {
      startLiveRound(wager, balls);
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
      lastTime: null,
      physics: matterReady() ? createLiveMatterPhysics(state.view.width, state.view.height, state.risk) : null
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
      sideLabel,
      risk: animation.risk,
      wager: animation.ballWager,
      totalWager: animation.totalWager,
      bestMultiplier,
      payout: totalPayout
    });

    if (animation.physics && window.Matter) {
      window.Matter.Composite.clear(animation.physics.engine.world, false);
      window.Matter.Engine.clear(animation.physics.engine);
    }

    state.restingBalls = [];
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
        ballResult.side,
        now,
        Number(ballResult.tier),
        ballResult
      );
    });

    state.lastPockets = [];
    state.restingBalls = [];
    state.animation = {
      balls: ballList,
      risk: result.risk || state.risk,
      requestedSides: state.selectedSides.slice(),
      ballWager,
      totalWager,
      startedAt: now,
      lastTime: null,
      physics: matterReady() ? createLiveMatterPhysics(state.view.width, state.view.height, result.risk || state.risk) : null,
      live: true,
      paymentSignature: result.paymentSignature,
      payoutSignature
    };

    lastResultEl.textContent = results.length > 1
      ? "Verified " + results.length + " balls"
      : "Verified " + ballResultLabel(results[0]);
    updateDisplay();
    renderStrip();
    window.requestAnimationFrame(animate);
  }

  function ballResultLabel(ballResult) {
    return multiplierLabel(Number(ballResult.multiplier || 0));
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

      lastResultEl.textContent = "Sign wager";
      const paymentSignature = await signAndSendWagerTransaction(payload.wagerTransactionBase64);

      lastResultEl.textContent = "Settling wager";
      const settleResponse = await fetch(config.apiBaseUrl.replace(/\/$/, "") + "/api/rounds/settle", {
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
    state.restingBalls = [];
    lastResultEl.textContent = "Ready";
    updateDisplay();
    renderStrip();
    renderHistory();
    drawBoard();
  });

  wagerInput.addEventListener("blur", function () {
    const maxPerBall = maxWholeWagerPerBall(configuredBalance() || state.balance, selectedBallCount());
    const fixed = maxPerBall < 1 ? 0 : clamp(selectedWager(), 1, maxPerBall);
    wagerInput.value = String(fixed);
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
