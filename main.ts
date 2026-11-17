// Washout-recovery bot for make.fun btc-race-24h-20261117-0603 (bars-replay/v1).
//
// Idea: on a 24h cbBTC window the money is in sharp washouts followed by a
// multi-hour recovery, not in chasing the trend with fast moving-average
// crossovers (every momentum variant loses on the dev window, and the kit's
// EMA/momentum baselines lose too). So this bot only buys a deep dip once
// the bounce has already started, scales in if the washout deepens, and
// banks the recovery with a target plus a trailing stop.
//
// Entry (flat only): the 30-minute return is below -80 bps AND the 5-minute
// return has turned positive above +30 bps -- the dip is deep and the bounce
// has just started.
// Scale-in: a further tranche only when the same signal fires again AND the
// price is at least 50 bps below the previous tranche's entry, so the bot
// averages down into a deepening washout instead of chasing a rebound.
// Exits (whole position): +400 bps profit target above the average entry,
// 150 bps trailing stop below the peak close since entry, 150 bps hard stop
// below the average entry, or a 120-bar (2 hour) time stop -- recoveries
// exhaust in about 2 hours, holding longer only gives gains back.
//
// Validation (offline replay of the harness fill model: fill at next bar's
// open, 4 bps fee, 2 bps slippage, constant-product impact vs pool depth):
// the parameter set below is net positive on ALL THREE frozen dev windows
// I could test -- this race's window (+$1.67), the 2026-11-15 race's window
// (+$25.13, which the server's own dev grade confirmed at +$25.10 for the
// same strategy family), and the 2026-11-13 race's window (+$2.02) -- while
// mean-reversion wins on this window alone but loses ~$20 on each of the
// two falling windows, and momentum loses everywhere. The parameters sit at
// the top of a 486-combination grid ranked by worst-case window, so they
// are a robust plateau, not a sharp peak fitted to one window.
//
// Orders: buy = one third of the $1,000 starting cash per tranche, sell =
// the full position. Long only, no shorts, no leverage. Deterministic:
// decisions use only the closes seen so far; no randomness, no wall clock,
// no network, standard library only (plus the kit's bars SDK shim).
//
// Fill reconciliation: a buy/sell decided on bar k fills at bar k+1's open.
// The bot notes the decision when it sends the order and confirms it
// against the account in the next batch (quantity moved = filled, quantity
// unchanged = rejected, e.g. a missing bar); a rejected buy's tranche is
// dropped, a rejected sell is retried. This keeps the internal state in
// sync with the account even if a fill is rejected.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy parameters (see the header comment for validation).
const DROP_BPS = 80; // 30-min return must be below -80 bps to buy
const BOUNCE_BPS = 30; // 5-min return must be above +30 bps to buy
const STEP_BPS = 50; // next tranche only 50+ bps below the previous entry
const MAX_TRANCHES = 3; // at most 3 tranches of one third of the starting cash
const TRAIL_BPS = 150; // trailing stop below the peak close since entry
const STOP_BPS = 150; // hard stop below the average entry price
const TARGET_BPS = 400; // profit target above the average entry price
const TIME_STOP = 120; // bars from the first tranche, then exit
const TRANCHE_SIZE = 1_000_000_000n / 3n; // $333.33 in micro-USDC
const MAX_SLIPPAGE_BPS = 50; // cap the fill slippage the bot accepts: the dev fill
// model assumes 2 bps, so 50 bps still allows 25x the modeled slippage
// while rejecting extreme fills in the live race if liquidity thins out

/** State for one run: the closes seen and the open position, if any. */
class WashoutBot {
  closes: number[] = []; // closes of bars seen, in order (price units)
  entries: number[] = []; // decision closes of the tranches held
  openedAt = 0; // index in closes of the first tranche
  unconfirmed: 'buy' | 'sell' | null = null; // order sent last batch, not yet confirmed
  prevQty = 0n; // quantity seen at the previous onBatch

  heldQty(state: BarsState): bigint {
    return state.positions.get(SYMBOL)?.qty ?? 0n;
  }

  buyOrder(): [BuyInput] {
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: TRANCHE_SIZE, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }

  sellOrder(state: BarsState): [SellInput] {
    return [{ side: 'sell', symbol: SYMBOL, qty: this.heldQty(state), max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }

  /** Fold the previous batch's order into the tranche list. */
  confirmLastOrder(qty: bigint): void {
    if (this.unconfirmed === 'buy') {
      if (qty <= this.prevQty && this.entries.length > 0) {
        // Rejected buy: drop the tranche that never filled.
        this.entries.pop();
        if (this.entries.length === 0) this.openedAt = this.closes.length;
      }
    } else if (this.unconfirmed === 'sell') {
      if (qty === 0n) this.entries = []; // filled: the position is closed
      // else rejected: keep the entries, the exit logic retries
    }
    this.unconfirmed = null;
  }

  onBatch(state: BarsState, batch: Batch): (BuyInput | SellInput)[] {
    const qty = this.heldQty(state);
    this.confirmLastOrder(qty);

    // Record this batch's close, if the symbol has a bar.
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) this.closes.push(Number(bar.c));
    }
    this.prevQty = qty;

    if (state.warmingUp) return [];
    const k = this.closes.length - 1;
    if (k < 30) return [];
    const closes = this.closes;
    const ret30m = closes[k] / closes[k - 30] - 1;
    const ret5m = closes[k] / closes[k - 5] - 1;
    const dipping = ret30m < -DROP_BPS / 10000;
    const bouncing = ret5m > BOUNCE_BPS / 10000;

    if (qty === 0n && this.entries.length === 0) {
      // Flat: enter only on a deep dip whose bounce has started.
      if (dipping && bouncing && state.cash >= TRANCHE_SIZE) {
        this.entries = [closes[k]];
        this.openedAt = k;
        this.unconfirmed = 'buy';
        return this.buyOrder();
      }
      return [];
    }

    if (this.entries.length === 0) return [];

    // Holding (or a buy is still pending): exits first, then scale-in.
    const avgEntry = this.entries.reduce((a, x) => a + x, 0) / this.entries.length;
    const peak = Math.max(...closes.slice(this.openedAt, k + 1));
    if (closes[k] >= avgEntry * (1 + TARGET_BPS / 10000)) {
      this.unconfirmed = 'sell';
      return this.sellOrder(state);
    }
    if (closes[k] <= peak * (1 - TRAIL_BPS / 10000)) {
      this.unconfirmed = 'sell';
      return this.sellOrder(state);
    }
    if (closes[k] <= avgEntry * (1 - STOP_BPS / 10000)) {
      this.unconfirmed = 'sell';
      return this.sellOrder(state);
    }
    if (k - this.openedAt >= TIME_STOP) {
      this.unconfirmed = 'sell';
      return this.sellOrder(state);
    }
    if (this.entries.length < MAX_TRANCHES) {
      if (
        dipping && bouncing
        && closes[k] <= this.entries[this.entries.length - 1] * (1 - STEP_BPS / 10000)
        && state.cash >= TRANCHE_SIZE
      ) {
        this.entries.push(closes[k]);
        this.unconfirmed = 'buy';
        return this.buyOrder();
      }
    }
    return [];
  }
}

const bot = new WashoutBot();
await runBars({ onBatch: (state, batch) => bot.onBatch(state, batch) });
