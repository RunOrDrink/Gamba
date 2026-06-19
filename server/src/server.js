const express = require("express");
const cors = require("cors");
const { Connection, PublicKey } = require("@solana/web3.js");
const config = require("./config");
const { createPreparedRound, resolveRound, riskConfigs } = require("./game-engine");
const {
  buildWagerTransferTransaction,
  decimalToRaw,
  getTreasuryTokenBalanceRaw,
  rawToDecimal,
  sendTokenPayout,
  verifyTokenPayment
} = require("./settlement");

const app = express();
const rounds = new Map();
const settledSignatures = new Set();
const connection = new Connection(config.rpcUrl, "confirmed");

function requireConfigured() {
  if (!config.tokenMint || !config.treasuryWallet) {
    throw new Error("TOKEN_MINT and TREASURY_WALLET are required");
  }
}

function corsOrigin(origin, callback) {
  if (!origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error("Origin blocked"));
}

function scaledPoolRatio() {
  const boundedRatio = Math.max(0, Math.min(1, config.maxPayoutPoolRatio));
  return BigInt(Math.floor(boundedRatio * 1_000_000));
}

function maxPotentialPayout(wager, balls, risk) {
  const riskConfig = riskConfigs[risk];
  if (!riskConfig) {
    throw new Error("Invalid risk");
  }

  const maxMultiplier = Math.max(...riskConfig.multipliers);
  return Math.round(wager * balls * maxMultiplier * 100) / 100;
}

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    rpcUrl: config.rpcUrl,
    tokenMint: config.tokenMint ? config.tokenMint.toBase58() : "",
    treasuryWallet: config.treasuryWallet ? config.treasuryWallet.toBase58() : ""
  });
});

app.post("/api/rounds/prepare", async (req, res) => {
  try {
    requireConfigured();

    const wager = Number(req.body.wager);
    const balls = Math.min(20, Math.max(1, Math.round(Number(req.body.balls) || 1)));
    const totalWager = Math.round(wager * balls * 100) / 100;

    if (!Number.isFinite(wager) || wager < config.minWager || wager > config.maxWager) {
      res.status(400).json({ error: "Invalid wager" });
      return;
    }

    if (!Number.isFinite(totalWager) || totalWager < config.minWager || totalWager > config.maxWager) {
      res.status(400).json({ error: "Invalid total wager" });
      return;
    }

    const player = new PublicKey(req.body.wallet);
    const requestedMint = new PublicKey(req.body.tokenMint);

    if (!requestedMint.equals(config.tokenMint)) {
      res.status(400).json({ error: "Wrong token mint" });
      return;
    }

    const rawWager = decimalToRaw(totalWager, config.tokenDecimals);
    const maxPayout = maxPotentialPayout(wager, balls, req.body.risk);
    const rawMaxPayout = decimalToRaw(maxPayout, config.tokenDecimals);
    const reserveRaw = decimalToRaw(config.minTreasuryReserve, config.tokenDecimals);
    const treasuryRaw = await getTreasuryTokenBalanceRaw(connection, {
      mint: config.tokenMint.toBase58(),
      treasury: config.treasuryWallet.toBase58()
    });
    const poolAfterWager = treasuryRaw + rawWager;
    const exposedPool = poolAfterWager > reserveRaw ? poolAfterWager - reserveRaw : 0n;
    const allowedPayout = exposedPool * scaledPoolRatio() / 1_000_000n;

    if (rawMaxPayout > allowedPayout) {
      res.status(409).json({
        error: "Treasury pool cannot cover this wager's max payout",
        maxPayout,
        rawMaxPayout: rawMaxPayout.toString(),
        rawTreasuryPool: treasuryRaw.toString(),
        rawPoolAfterWager: poolAfterWager.toString(),
        rawAllowedPayout: allowedPayout.toString()
      });
      return;
    }

    const wagerTransfer = await buildWagerTransferTransaction(connection, {
      player: player.toBase58(),
      mint: config.tokenMint.toBase58(),
      treasury: config.treasuryWallet.toBase58(),
      rawAmount: rawWager
    });

    const round = createPreparedRound({
      wallet: player.toBase58(),
      wager,
      balls,
      totalWager,
      risk: req.body.risk,
      sides: req.body.sides || req.body.side,
      tokenMint: config.tokenMint.toBase58()
    });
    round.paymentBlockhash = wagerTransfer.blockhash;
    round.paymentLastValidBlockHeight = wagerTransfer.lastValidBlockHeight;

    rounds.set(round.roundId, round);

    res.json({
      roundId: round.roundId,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      tokenMint: config.tokenMint.toBase58(),
      treasuryWallet: config.treasuryWallet.toBase58(),
      wager,
      balls,
      totalWager,
      rawWager: rawWager.toString(),
      maxPayout,
      rawMaxPayout: rawMaxPayout.toString(),
      rawTreasuryPool: treasuryRaw.toString(),
      rawAllowedPayout: allowedPayout.toString(),
      wagerTransactionBase64: wagerTransfer.transactionBase64,
      wagerBlockhash: wagerTransfer.blockhash,
      lastValidBlockHeight: wagerTransfer.lastValidBlockHeight
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/rounds/settle", async (req, res) => {
  try {
    requireConfigured();

    const round = rounds.get(req.body.roundId);
    if (!round) {
      res.status(404).json({ error: "Round not found" });
      return;
    }

    if (settledSignatures.has(req.body.paymentSignature)) {
      res.status(409).json({ error: "Payment signature already used" });
      return;
    }

    const rawWager = decimalToRaw(round.totalWager, config.tokenDecimals);
    await verifyTokenPayment(connection, {
      signature: req.body.paymentSignature,
      player: round.wallet,
      mint: config.tokenMint.toBase58(),
      treasury: config.treasuryWallet.toBase58(),
      rawAmount: rawWager,
      blockhash: round.paymentBlockhash,
      lastValidBlockHeight: round.paymentLastValidBlockHeight
    });

    const result = resolveRound(round, req.body.paymentSignature);
    const rawPayout = decimalToRaw(result.payout, config.tokenDecimals);
    let payoutSignature = "";

    if (rawPayout > 0n) {
      if (!config.treasuryKeypair) {
        throw new Error("TREASURY_KEYPAIR_JSON is required for payouts");
      }

      const treasuryRaw = await getTreasuryTokenBalanceRaw(connection, {
        mint: config.tokenMint.toBase58(),
        treasury: config.treasuryWallet.toBase58()
      });

      if (treasuryRaw < rawPayout) {
        throw new Error("Treasury pool is insufficient for payout");
      }

      payoutSignature = await sendTokenPayout(connection, {
        rawAmount: rawPayout,
        mint: config.tokenMint.toBase58(),
        recipientOwner: round.wallet,
        treasuryKeypair: config.treasuryKeypair
      });
    }

    rounds.delete(round.roundId);
    settledSignatures.add(req.body.paymentSignature);

    res.json({
      result,
      rawWager: rawWager.toString(),
      rawPayout: rawPayout.toString(),
      payout: rawToDecimal(rawPayout, config.tokenDecimals),
      payoutSignature
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(config.port, () => {
  console.log(`Gamba settlement API listening on ${config.port}`);
});
