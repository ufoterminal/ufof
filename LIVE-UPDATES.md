# Live updates

## Worker-owned live packets and coherent timeframes (2026-09-15)

- `/api/live`, SSE, and token-detail reads no longer run the live collector or start direct chart rebuilds. They read persisted `live_packets` and enqueue unique database jobs. Missing token names are left to the registry worker. Wallet and holder endpoints remain separate on-demand readers.
- Two bounded live worker loops refresh interested tokens, with shared database leases and last-good packet retention. The highest-volume 32 markets are warmed without visitors. The default embedded worker starts automatically with `npm start`; external worker mode requires a shared PostgreSQL database and a running `npm run worker`. PGlite remains single-process.
- Homepage and detail valuations consume the same stored live market packet. Complete per-frame sets derived from one stored tape publish atomically with one generation; provider-bootstrap histories retain the existing per-frame fallback until sufficient tape exists.
- Empty time buckets carry the last execution at zero volume with an explicit empty flag. No fake transactions are created. The viewport uses the displayed bar count.
- Liquidity-bearing pool descriptors select a primary pool with a 10% switching margin; absent comparable liquidity, a declared/previous pool is retained. This is not a claim of fresh on-chain liquidity coverage for every pool.
- Warp's first-party detail explicitly identifies its migrated pair. Only trades labelled WarpDex receive that pair's provenance; other venues cannot enter the primary-pool tail. A source-reported pool label is not an independent RPC verification.
- Last primary-pool execution prices the market overview and its valuation; a different reserve spot quote is not substituted merely because a token has been inactive for three minutes. Unknown circulating supply remains unknown.
- `scripts/verify-live-warp.mjs` uses an isolated in-memory database and live first-party data. Verification produced 898 stored executions, six equal closes and equal displayed price. Archive coverage was still partial; this was not an all-token production test.
- Live RPC probes: Arcscan/Thirdweb returned eth_call errors, Blockdaemon required authorization, the supplied Infura project reported quota exceeded, and the supplied Blockscout route returned 404. These outages were not bypassed. No new dependency on ARC Screener's API was introduced.
- Performance skill used for request-path inspection; no DevTools trace/Lighthouse measurement or public load-capacity certification was collected. No production deployment or user database deletion occurred.

## Shared live reads and same-second candle updates (2026-09-15)

- HTTP fallback and SSE now share the complete per-token live computation, including database reads, with a one-second result cache and bounded concurrent computations. This is process-local; it is not a distributed indexer migration.
- Locally sourced chart snapshots carry a block/log cursor. Later swaps within the same second are no longer discarded by the live candle overlay. Older snapshots without that cursor remain conservative until refreshed.
- During timeframe loading, live prices and transaction rows keep rendering, while a snapshot for another timeframe cannot repaint the selected chart.
- Verification: 155 automated tests and the isolated six-frame browser fixture passed. No production load capacity or universal live-token accuracy is claimed. Public RPC failures, provider history gaps, and cross-quote limitations remain external/coverage risks.

## Progressive wallet balances (2026-09-15)

- Wallet scans now use page/offset (100 per page), continue across bounded four-page passes, deduplicate contracts, and explicitly report pending/incomplete/error states. The [Etherscan-compatible holding endpoint](https://docs.etherscan.io/api-reference/endpoint/addresstokenbalance) documents these pagination parameters; Arcscan must support and serve them successfully for complete coverage.
- Native USDC, ERC-20 pages and pricing no longer block one another. Cold responses wait at most 1 second for balance progress plus 750 ms for price lookup; these are application wait budgets, not measured production response times. Later requests share work and reuse a 30-second balance cache. Up to four source jobs run simultaneously. Native RPC rank probing was removed.
- No top-market/list-page cap applies to pricing held assets. Unpriced and unknown-decimal holdings stay visible, tiny balances remain nonzero, exact decimal/raw quantities are retained, and native USDC is not counted again through its ERC-20 alias.
- Address search offers the wallet link before token search completes; an exact token match still ranks before it when returned. Unknown tokens link to the explorer instead of an unavailable detail page.
- Safety bounds: 100 cached wallets and 50,000 contracts per wallet. Hitting a bound or repeated page is explicitly incomplete, never a claim that all holdings were found. NFTs and other chains are outside this ERC-20/native view.
- Live Arcscan testing returned Internal server error; the supplied Blockscout host returned 404. Therefore complete production balance coverage is not verified. A working compatible Arc endpoint can be configured with WALLET_EXPLORER_API. No Lighthouse/production latency benchmark was collected. Simulated pagination, failure recovery and browser tests cover the application behavior.

## Live chart head (2026-09-15)

- The live valuation packet, not the selected timeframe snapshot, owns current price and MC. A quiet SSE connection no longer expires this packet after 20 seconds.
- The axis marker explicitly shows Latest / Last known valuation in every timeframe. Historical candle closes are not replaced with a quote: `withLivePrice` has been removed. If history differs from the current quote, a visible note explains the mismatch.
- Confirmed same-pool executions are appended to immutable snapshots using a timestamp watermark and transaction/log deduplication. Secondary and unlabelled pools cannot enter this live overlay. Snapshots without pool provenance wait for a rebuild. Same-second boundary executions wait for the next snapshot to avoid double counting.
- A separate bounded RPC head reader runs independently of archive backfills (maximum four flights, 3-second retry interval after success, 15-second backoff on failure). It retains the existing 12-block confirmation buffer. It starts with at most 2048 blocks; it is not an unlimited archival scan.
- The live endpoint recovers a missing pool from stored discovery. Fresh primary-pool executions price the market and its verified supply-based valuation together; when supply is unknown, MC/FDV stay unknown rather than preserving an inconsistent number.
- Tested with simulated six-frame changes, quiet SSE, duplicate trades and foreign-pool spikes. Production Coqui API confirmed missing live pool and lagging chart head. Direct public-RPC validation returned an HTTP failure; block-time latency and complete history across all tokens are not guaranteed. Rebuilds and provider/RPC availability still matter; no production deployment was performed.

## Stabilization pass (2026-09-15)

- Older timestamped valuation packets cannot replace newer price/MC/pool packets in the detail UI.
- Timeframe responses are cached per page. An uncached switch clears the previous frame while loading; live messages cannot repaint the old frame under a new label.
- Local transaction queries are scoped to the selected pool. Chart RPC selection prefers the displayed pool instead of independently selecting a different one.
- Completed paged histories continue fetching their newest trades rather than stopping when backfill completes.
- This is not a complete canonical-pool architecture: provider trades without pool identifiers remain unverified, automatic liquidity-based primary-pool selection is not implemented, and existing bad historical trades are not deleted. Production RPC/API verification was blocked by network access in this pass. No production latency benchmark is claimed.

Launchpad labels are restored in the market list, search results and token heading, with a Launched on filter. The label uses the stored launch record, not the price provider. Currently mapped: RadarDEX, DYOR, CircleWarp, Sharc, Tolly, Archemist, pools.trade, Noxa, ArgusPad, Long and o1. Other pads are not guessed. This UI change adds no RPC scanning.

- All token detail pages use `/api/live/:address`, independent of candle backfills, burned-supply RPCs and timeframe changes.
- `/api/events` delivers live token updates over SSE. One server read is shared by viewers of the same token, with four concurrent topic reads maximum, bounded connections and backpressure protection. Hidden tabs disconnect. If SSE is unavailable, the browser falls back to the existing 1.5-second endpoint polling with backoff.
- Completed source batches notify homepage viewers immediately, without waiting for every launchpad. Three launchpad list requests run concurrently. Stored chart snapshots notify matching token viewers; existing list/detail polling remains a safety net. Homepage updates preserve existing row nodes.
- Notifications and read sharing are process-local. Separate indexer processes or multiple Railway replicas rely on the polling safety net for database changes; cross-process push would require a shared broker. SSE reduces transport waiting, not upstream publication delays.
- Active token provider requests are shared per process, bounded to eight simultaneous refreshes, with 3-second trade and 5-second detail caches. The upstream feed still uses polling; SSE is the server-to-browser transport, not a promise of block-time delivery.
- Existing indexed swaps can supply the tape when newer. Cross-quote markets do not mix a secondary USDC pool into their primary quote data.
- New rows preserve existing DOM nodes. The current chart bar updates incrementally; historical corrections trigger a full series refresh. Idle periods do not create fake candles.
- DYOR's last execution price is computed from its reported USDC/token amounts. It is a last-trade price, not a guaranteed executable quote.
- The volume/traders cards show totals only. Recent buy/sell volume and buyer/seller splits are hidden at the user's request.
- Burned shows the dead-address balance divided by current total supply, formatted as `%4`. Successful readings persist in the token record and are delivered by the independent live endpoint. Temporary read failures retain the last verified value; unknown is never shown as zero.
- During verification on 2026-09-14 the configured public RPCs returned unavailable/quota errors for contract reads. A working `RPC_HTTP` endpoint is necessary to populate tokens without a previous verified burn reading. A block-number response alone does not prove `eth_call` works.
- Pools lacking both a first-party transaction feed and indexed swaps remain unavailable; the UI does not invent activity. API/RPC publication delays remain outside the browser's control.

Validation: `node --test --test-force-exit test/*.test.mjs`; isolated browser fixture: `node scripts/live-browser-check.mjs` (requires Playwright and a browser).
The fixture never contacts production feeds. No Lighthouse/Core Web Vitals trace was collected; available tooling was used for source inspection and functional browser checks, not measured production latency claims.
