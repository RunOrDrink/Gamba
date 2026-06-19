const crypto = require("node:crypto");

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

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomSeed() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeSide(side) {
  if (side === "left" || side === "right") {
    return side;
  }

  return crypto.randomInt(0, 2) === 0 ? "left" : "right";
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

function createPreparedRound({ wallet, wager, risk, side, tokenMint }) {
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
  const entropy = hash([round.serverSeed, round.clientSeed, round.roundId, paymentSignature].join(":"));
  const tier = weightedTier(config.weights, entropy);
  const multiplier = config.multipliers[tier];
  const side = normalizeSide(round.requestedSide);
  const payout = Math.floor(round.wager * multiplier * 100) / 100;

  return {
    roundId: round.roundId,
    side,
    risk: round.risk,
    tier,
    multiplier,
    wager: round.wager,
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
