const crypto = require("node:crypto");

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

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomSeed() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeSide(side, entropyHex) {
  if (side === "left" || side === "right") {
    return side;
  }

  return Number.parseInt(entropyHex.slice(0, 2), 16) % 2 === 0 ? "left" : "right";
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

function createPreparedRound({ wallet, wager, balls = 1, totalWager = wager, risk, side, tokenMint }) {
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
    requestedSide: side,
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
  const balls = Math.min(10, Math.max(1, Number(round.balls) || 1));
  const results = [];
  let payout = 0;

  for (let index = 0; index < balls; index += 1) {
    const entropy = hash([round.serverSeed, round.clientSeed, round.roundId, paymentSignature, index].join(":"));
    const tier = weightedTier(config.weights, entropy.slice(16) + entropy.slice(0, 16));
    const multiplier = config.multipliers[tier];
    const side = normalizeSide(round.requestedSide, entropy);
    const ballPayout = Math.floor(round.wager * multiplier * 100) / 100;

    payout += ballPayout;
    results.push({
      index,
      side,
      tier,
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
