# Live updates

- All token detail pages use `/api/live/:address`, independent of candle backfills, burned-supply RPCs and timeframe changes.
- The browser checks this read-only endpoint 1.5 seconds after the previous response. Requests do not overlap; failures back off and hidden tabs pause.
- Active token provider requests are shared per process, bounded to eight simultaneous refreshes, with 3-second trade and 5-second detail caches. This is polling, not a promise of block-time delivery or a WebSocket feed.
- Existing indexed swaps can supply the tape when newer. Cross-quote markets do not mix a secondary USDC pool into their primary quote data.
- New rows preserve existing DOM nodes. The current chart bar updates incrementally; historical corrections trigger a full series refresh. Idle periods do not create fake candles.
- DYOR's last execution price is computed from its reported USDC/token amounts. It is a last-trade price, not a guaranteed executable quote.
- Complete 24h breakdowns are displayed where available. Otherwise explicitly labelled **Recent** buy/sell figures describe only received transactions inside the window; they are not advertised as complete 24h totals.
- Pools lacking both a first-party transaction feed and indexed swaps remain unavailable; the UI does not invent activity. API/RPC publication delays remain outside the browser's control.

Validation: `node --test --test-force-exit test/*.test.mjs`; isolated browser fixture: `node scripts/live-browser-check.mjs` (requires Playwright and a browser).
The fixture never contacts production feeds. No Lighthouse/Core Web Vitals trace was collected; available tooling was used for source inspection and functional browser checks, not measured production latency claims.
