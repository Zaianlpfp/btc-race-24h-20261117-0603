# btc-race-24h-20261117-0603

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Zaianlpfp/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Zaianlpfp/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A washout-recovery trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades Coinbase Wrapped BTC (cbBTC) on 1-minute on-chain bars with $1,000 of paper money: it buys a deep dip only once the bounce has started, scales in if the washout deepens, and banks the recovery with a profit target plus a trailing stop. Long only, no shorts, no leverage, fully deterministic.

Dev grade on the frozen 24h dev window: net PnL **+$1.67** (2 trades, max drawdown 0.19%), passing the dev gate. The same strategy family was net positive on the two previous races' dev windows too (+$25.13 and +$2.02 in offline replay), while mean-reversion and momentum variants lose on falling windows.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=vdteqqjz&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
