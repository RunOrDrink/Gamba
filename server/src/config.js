require("dotenv").config();

const fs = require("node:fs");
const { Keypair, PublicKey } = require("@solana/web3.js");

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function parseNumber(name, fallback) {
  const value = Number(env(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function loadKeypair(value) {
  if (!value || value === "[1,2,3]") {
    return null;
  }

  const raw = value.trim().startsWith("[") ? value : fs.readFileSync(value, "utf8");
  const secret = JSON.parse(raw);
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function optionalPublicKey(value) {
  if (!value || value.startsWith("REPLACE_")) {
    return null;
  }

  return new PublicKey(value);
}

const treasuryKeypair = loadKeypair(env("TREASURY_KEYPAIR_JSON"));
const treasuryWallet = optionalPublicKey(env("TREASURY_WALLET")) || (treasuryKeypair && treasuryKeypair.publicKey);

module.exports = {
  port: parseNumber("PORT", 8787),
  rpcUrl: env("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
  tokenMint: optionalPublicKey(env("TOKEN_MINT")),
  tokenDecimals: parseNumber("TOKEN_DECIMALS", 6),
  treasuryWallet,
  treasuryKeypair,
  minWager: parseNumber("MIN_WAGER", 1),
  maxWager: parseNumber("MAX_WAGER", 100000),
  allowedOrigins: env("ALLOWED_ORIGINS", "").split(",").map((origin) => origin.trim()).filter(Boolean)
};
