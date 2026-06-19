# Production Checklist

## Token

- Confirm the Pump.fun token mint address.
- Confirm decimals from the mint account.
- Confirm the treasury wallet that receives wagers and pays wins.
- Keep `config.js` in sync with the final symbol, mint, decimals, network, and API URL.

## Wager Settlement

- Never trust browser math for real payouts.
- Verify every wager by reading the Solana transaction from RPC.
- Require the transfer mint, player wallet, treasury wallet, and raw token amount to match the prepared round.
- Resolve the result only after the wager transaction is confirmed.
- Pay out from escrow/treasury only after verification succeeds.
- Prefer an audited on-chain escrow program before public mainnet launch.

## Fairness

- Use a server seed commitment before the wager is paid.
- Combine server seed, client seed, round id, and payment signature to derive the outcome.
- Reveal the server seed after settlement so users can verify the result.
- For stronger fairness, use a verifiable randomness provider or audited on-chain program.

## Compliance

- Real token wagering can be regulated gambling even if the currency is a memecoin.
- Decide blocked jurisdictions before launch.
- Add age checks, geofencing, responsible gambling limits, self-exclusion, and support flows.
- Review KYC/AML obligations.
- Publish terms, privacy policy, risk disclosures, and house edge.
- Get legal advice before accepting wagers from real users.

## Security

- Do not keep a large treasury in a hot wallet.
- Use withdrawal limits and operational alerts.
- Rate limit wager endpoints.
- Log round id, wallet, wager, signature, result, payout, seed hash, and settlement signature.
- Monitor failed transfers and duplicate signatures.
- Audit dependencies and lock versions before deploy.
