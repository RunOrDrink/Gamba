# Gamba Side Rush

Static prototype plus the starting scaffold for wagering with a Solana SPL token launched through Pump.fun.

## What is here

- `index.html`, `styles.css`, `app.js`: playable browser prototype.
- `config.js`: token, network, treasury, and API settings.
- `server/`: settlement API scaffold for real token wagers.
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

The live flow should be:

1. Player connects a Solana wallet.
2. Backend prepares a round and commits to a hidden server seed.
3. Player sends the wager token transfer to the treasury or escrow.
4. Backend verifies the SPL token transfer on-chain.
5. Backend resolves the round and pays the player from treasury/escrow.
6. Frontend animates the verified result.

Do not run mainnet token wagering without legal review, geofencing, KYC/AML decisions, responsible gambling controls, and a security review of the settlement wallet or on-chain escrow.
