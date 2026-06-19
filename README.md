# Gamba Side Rush

Static prototype plus the starting scaffold for wagering with a Solana SPL token launched through Pump.fun.

## What is here

- `index.html`, `styles.css`, `app.js`: playable browser prototype.
- `config.js`: token, network, treasury, and API settings.
- `server/`: settlement API for real token wagers, payment verification, and treasury payouts.
- `docs/PRODUCTION_CHECKLIST.md`: launch checklist for real-money/token play.

## Local demo

Open `index.html` in a browser. It runs with demo `GAMBA` coins and does not move real tokens.

## Token setup

After the Pump.fun coin exists, update `config.js`:

```js
window.GAMBA_CONFIG = {
  network: "mainnet-beta",
  apiBaseUrl: "https://your-api.example.com",
  liveTokenWagering: true,
  token: {
    name: "Your Coin",
    symbol: "YOUR",
    mintAddress: "YOUR_PUMPFUN_TOKEN_MINT",
    decimals: 6,
    treasuryAddress: "YOUR_HOUSE_TREASURY_WALLET"
  }
};
```

The live flow is:

1. Player connects a Solana wallet.
2. Backend prepares a round and commits to a hidden server seed.
3. Backend returns a ready-to-sign SPL token transfer from player wallet to treasury.
4. Backend verifies the SPL token transfer on-chain.
5. Backend resolves each ball against the published payout table.
6. Backend pays the player from treasury/escrow.
7. Frontend animates the verified result.

## Game math

Gamba follows the normal online-casino structure: the random outcome and payout table determine the result first, then the frontend animation displays that result. The demo tables are set to 98.5% RTP, or a 1.5% house edge, across low, medium, and high risk modes. Low, medium, and high use about 95%, 70%, and 40% hit rates.

## Treasury pool

Live token play uses a pooled treasury model:

1. Player wager transfers into the treasury token account.
2. The result is resolved from the server/provably-fair round.
3. Any win is paid back out from the same treasury token account.
4. Over long volume, 98.5% of wagers are expected to return to players and 1.5% remains in the pool.

Short-term variance can still produce wins before enough losing wagers arrive. For that reason, the backend rejects a live wager when its worst-case payout is too large for the treasury pool. Configure this with:

```txt
MIN_TREASURY_RESERVE=0
MAX_PAYOUT_POOL_RATIO=0.8
```

`MIN_TREASURY_RESERVE` keeps a fixed amount of tokens untouched. `MAX_PAYOUT_POOL_RATIO` limits how much of the available pool any round may expose.

For mainnet, keep the treasury funded above the largest allowed payout and protect the treasury keypair like production hot-wallet infrastructure.
