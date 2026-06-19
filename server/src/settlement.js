const {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  transfer
} = require("@solana/spl-token");
const { PublicKey } = require("@solana/web3.js");

function decimalToRaw(amount, decimals) {
  const [wholePart, decimalPart = ""] = String(amount).split(".");
  const whole = BigInt(wholePart || "0") * 10n ** BigInt(decimals);
  const fraction = BigInt((decimalPart + "0".repeat(decimals)).slice(0, decimals) || "0");
  return whole + fraction;
}

function rawToDecimal(raw, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = String(raw % base).padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function ownerDeltaFromBalances(meta, owner, mint) {
  const ownerAddress = owner.toBase58();
  const mintAddress = mint.toBase58();

  function sum(balances) {
    return balances
      .filter((balance) => balance.owner === ownerAddress && balance.mint === mintAddress)
      .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), 0n);
  }

  return sum(meta.postTokenBalances || []) - sum(meta.preTokenBalances || []);
}

async function verifyTokenPayment(connection, params) {
  const signature = params.signature;
  const player = new PublicKey(params.player);
  const mint = new PublicKey(params.mint);
  const treasury = new PublicKey(params.treasury);
  const rawAmount = params.rawAmount;

  const tx = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });

  if (!tx) {
    throw new Error("Payment transaction not found");
  }

  if (tx.meta && tx.meta.err) {
    throw new Error("Payment transaction failed");
  }

  const signedByPlayer = tx.transaction.message.accountKeys.some((account) => {
    return account.pubkey.toBase58() === player.toBase58() && account.signer;
  });

  if (!signedByPlayer) {
    throw new Error("Payment was not signed by player wallet");
  }

  const treasuryDelta = ownerDeltaFromBalances(tx.meta, treasury, mint);
  const playerDelta = ownerDeltaFromBalances(tx.meta, player, mint);

  if (treasuryDelta < rawAmount || playerDelta > -rawAmount) {
    throw new Error("Payment amount, mint, or treasury did not match round");
  }

  return true;
}

async function sendTokenPayout(connection, params) {
  const rawAmount = params.rawAmount;

  if (rawAmount <= 0n) {
    return "";
  }

  const mint = new PublicKey(params.mint);
  const recipientOwner = new PublicKey(params.recipientOwner);
  const treasuryKeypair = params.treasuryKeypair;
  const treasuryTokenAccount = getAssociatedTokenAddressSync(mint, treasuryKeypair.publicKey);
  const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    treasuryKeypair,
    mint,
    recipientOwner
  );

  return transfer(
    connection,
    treasuryKeypair,
    treasuryTokenAccount,
    recipientTokenAccount.address,
    treasuryKeypair,
    rawAmount
  );
}

module.exports = {
  decimalToRaw,
  rawToDecimal,
  verifyTokenPayment,
  sendTokenPayout
};
