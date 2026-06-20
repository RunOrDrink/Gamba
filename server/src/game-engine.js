const crypto = require("node:crypto");

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

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomSeed() {
  return crypto.randomBytes(32).toString("hex");
}

const validSides = ["left", "center", "right"];

function normalizeSides(sides) {
  const source = Array.isArray(sides) ? sides : [sides];
  const normalized = source.filter((side) => validSides.includes(side));
  return normalized.length ? Array.from(new Set(normalized)) : validSides;
}

function normalizeSide(sides, entropyHex) {
  const normalizedSides = normalizeSides(sides);
  if (normalizedSides.length === 1) {
    return normalizedSides[0];
  }

  const roll = Number.parseInt(entropyHex.slice(0, 2), 16) % normalizedSides.length;
  return normalizedSides[roll];
}

function weightedTier(weights, entropyHex) {
  const entropy = BigInt("0x" + entropyHex.slice(0, 16));
  const total = weights.reduce((sum, weight) => sum + Math.round(weight * 1_000_000), 0);
  let roll = Number(entropy % BigInt(total));

  for (let index = 0; index < weights.length; index += 1) {
    roll -= Math.round(weights[index] * 1_000_000);
    if (roll <= 0) {
      return index;
    }
  }

  return weights.length - 1;
}

function targetPocketFromTier(tier, entropyHex) {
  if (tier === 7) {
    return 7;
  }

  return Number.parseInt(entropyHex.slice(2, 4), 16) % 2 === 0 ? tier : 14 - tier;
}

function createPreparedRound({ wallet, wager, balls = 1, totalWager = wager, risk, sides, side, tokenMint }) {
  if (!riskConfigs[risk]) {
    throw new Error("Invalid risk");
  }

  const serverSeed = randomSeed();
  const clientSeed = crypto.randomUUID();
  const roundId = crypto.randomUUID();

  return {
    roundId,
    wallet,
    wager,
    balls,
    totalWager,
    risk,
    requestedSides: normalizeSides(sides || side),
    tokenMint,
    clientSeed,
    serverSeed,
    serverSeedHash: hash(serverSeed),
    createdAt: Date.now(),
    status: "prepared"
  };
}

function resolveRound(round, paymentSignature) {
  const config = riskConfigs[round.risk];
  const balls = Math.min(100, Math.max(1, Number(round.balls) || 1));
  const results = [];
  let payout = 0;

  for (let index = 0; index < balls; index += 1) {
    const entropy = hash([round.serverSeed, round.clientSeed, round.roundId, paymentSignature, index].join(":"));
    const tier = weightedTier(config.weights, entropy.slice(16) + entropy.slice(0, 16));
    const multiplier = config.multipliers[tier];
    const side = normalizeSide(round.requestedSides, entropy);
    const pocket = targetPocketFromTier(tier, entropy);
    const ballPayout = Math.floor(round.wager * multiplier * 100) / 100;

    payout += ballPayout;
    results.push({
      index,
      side,
      tier,
      pocket,
      multiplier,
      wager: round.wager,
      payout: ballPayout
    });
  }

  payout = Math.floor(payout * 100) / 100;

  return {
    roundId: round.roundId,
    side: results.length > 1 ? "mixed" : results[0].side,
    risk: round.risk,
    balls,
    results,
    multiplier: Math.max(...results.map((result) => result.multiplier)),
    wager: round.wager,
    totalWager: round.totalWager || round.wager * balls,
    payout,
    serverSeed: round.serverSeed,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    paymentSignature
  };
}

module.exports = {
  createPreparedRound,
  resolveRound,
  riskConfigs
};
