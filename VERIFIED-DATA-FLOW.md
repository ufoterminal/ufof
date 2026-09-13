# Doğrulanan veri akışı

10 Eylül 2026 tarihinde yayımlanan frontend kodları ve canlı JSON yanıtları incelendi. Bu not, önceki RADARDEX-RESEARCH.md içindeki doğrulanmamış mimari çıkarımların yerine geçer.

## RadarDEX

[RadarDEX frontend](https://radardex.pro/) doğrudan kendi API'sini kullanıyor. Görülen uçlar:

- Liste: /tokens?sort=volume24&dir=desc&limit=500&window=24h
- Kendi launchları: aynı sorguda launchpad=radar
- Arama: /tokens?q=...; üst listedeki sonuçlardan bağımsız
- Detay: /token/{address}
- Grafik: /token/{address}/chart?tf=3600&limit=1000
- İşlemler: /token/{address}/swaps?limit=60
- Genel istatistikler: /stats

Liste 15 saniye, açık detay 8 saniye, genel istatistikler 60 saniyede yenileniyor. Liste/detay yenilemesi görünür sekmeye bağlı. Grafik lightweight-charts 4.1.3 kullanıyor. Bu gözlemler frontend davranışını kanıtlar; RadarDEX'in sunucu içindeki indeksleme mimarisini kanıtlamaz.

Genel /tokens yanıtı Tolly ve diğer padleri de içeriyor. Bu projede Radar listesi launchpad=radar filtresi, launch kaydı eşleşmesi ve launched kontrolüyle sınırlandı. Token detayında aynı aidiyet tekrar kontrol ediliyor.

## Doğrudan pad kaynakları

| Kaynak | Liste | Grafik | İşlemler |
|---|---|---|---|
| [Tolly API](https://api.tollylabs.com/tokens?scope=ours&limit=2) | /tokens?scope=ours | /candles?token=ADDRESS&tf=1h | /swaps?token=ADDRESS |
| [Sharc API](https://sharc.fun/api/tokens) | /api/tokens | /api/tokens/ADDRESS/candles?interval=3600 | /api/tokens/ADDRESS/trades |
| [DYOR Arc API](https://arc-api-production-ef9c.up.railway.app/api/arc/v1/tokens?limit=2) | /api/arc/v1/tokens | Token detail; mumlar gerçek trade kayıtlarından üretilir | /api/arc/v1/tokens/ADDRESS/trades |
| [CircleWarp API](https://warp-arc-production.up.railway.app/api/tokens) | /api/tokens (Arc) | /api/tokens/ADDRESS/candles?interval=3600 | /api/tokens/ADDRESS/trades |
| [Archemist launch API](https://api.archemist.fun/api/tokens?chain=arc-mainnet&limit=2) | /api/tokens?chain=arc-mainnet (kendi launch registry) | /api/tokens/ADDRESS/chart?chain=arc-mainnet&tf=3600 | /api/tokens/ADDRESS/trades?chain=arc-mainnet |
| pools.trade | `launchpad=poolstrade` ile sınırlı 30 kayıtlık keşif feed'i | `pools.trade/api/trpc` → `prices.getOhlc` (Arc 5042) | Kaynak prosedürü şu an boş envelope döndürüyor; işlem uydurulmaz |

Tolly listesinde tolly=true kontrolü yapılır; scope=all kullanılmaz. Sayfalama yanıtı 200 kayıtta kesildiği için sınırlı ek sayfalar alınır. Sharc'ta chainKey=arc kontrol edilir.

CircleWarp'ın `/api/tokens` yanıtı doğrudan `warp-arc-production.up.railway.app` üzerinde çalışır ve Arc launch kayıtlarını `chain`, `createdAt`, `price`, `mcap`, `volume`, `txCount`, `holders` ve `liquidity` alanlarıyla sağlar. Archemist'in `api.archemist.fun` launch registry'si `launch_factory_address`, `pool_address`, `protocol_version` ve canlı snapshot alanlarını birlikte döndürür; genel Arc/Uniswap token listesi yerine bu endpoint kullanılır. Archemist V2 factory `0x297Cebc4de347347205CD08667b56ee951dd8810` olarak kayıtlara işlenir.

Pools.trade frontend bundle'ı launcher ekranında `VITE_ENABLED_CHAINS=robinhood:trade+create` ilan etse de tRPC fiyat prosedürleri Arc chainId 5042 için çalışıyor. Screener keşfi yalnızca RadarDEX'in `launchpad=poolstrade` ile döndürdüğü kayıtları kabul eden dar bir mirror'dır; başka RadarDEX tokenleri pools.trade kaynağına karışmaz. Detay grafiği first-party `prices.getTokens` ve `prices.getOhlc` yanıtlarından alınır. `activity.getTradeHistory` Arc için boş envelope döndürdüğü için işlem listesi boş bırakılır; sahte işlem üretilmez. Pools.trade kendi Arc liste endpoint'ini yayınladığında `POOLS_TRADE_ARC_API` ile mirror kolayca değiştirilebilir.

[Sharc yapılandırması](https://sharc.fun/api/config/arc) factory adresini 0x2b2b76d365c76a9226d436746746bcf62cdf5634 olarak veriyor. Sanal curve rezervleri gerçek likidite kabul edilmez.

Sharc priceE18 / 10^18; marketCap ve volume24h / 10^6; değişimler basis-point / 100 olarak dönüştürülür. tradesCount ve tradersCount toplam sayılardır, 24 saat sütunlarında kullanılmaz.

## Çalışan proje davranışı

Liste backend'de dakikada bir kaynak başına güncellenir. Detay istekleri 30 saniye önbellekte tutulur, eşzamanlı aynı istek birleştirilir. Radar launch arşivi 15 dakika önbelleğe alınır. Tarayıcı listeyi ve açık detayı 15 saniyede bir, yalnızca sekme görünürken yeniler.

Sunucu indexer çalıştırmaz. Liste/grafik için kullanıcı başına zincir taraması yapılmaz. Eski deneysel dosyalar ZIP'e dahil edilmez.

Ana listede son 24 saatte hacmi veya işlemi bildirilen kaynak kayıtları gösterilir. Arama yerel arşivi de tarar; tüm Arc geçmişinin eksiksiz kapsandığı iddia edilmez. DYOR canlı listesindeki chain=arc ve chainId=5042 doğrulanır. API'nin `*Eth` alanları Arc'ta 6 decimal USDC çiftini ifade eder; mcap, likidite ve hacim 10^6'ya bölünür. Sabit arz 1B olduğundan fiyat mcap / 1B olarak gösterilir. Grafik endpoint'i yayınlanmadığı için mumlar DYOR `/trades` yanıtındaki gerçek fiyat ve hacimlerle seçilen timeframe bucket'larına gruplanır; işlemler yine aynı `/trades` kaynağından okunur.

## Canlı kontroller

- RadarDEX / COOL: 500 mum, 60 işlem; fiyat ve token zamanı dolu.
- Tolly / TOLLY: 500 mum, 60 işlem; kendi API'sinden fiyat ve zaman.
- Sharc / SHARC: 169 kapanış kaydı, 60 işlem görüldü. Kaynağın çoğu mumunda açılış, yüksek/düşük aralığı dışındaydı. Tutarsız OHLC'yi tamir edip gerçekmiş gibi sunmak yerine gerçek kapanışlardan çizgi grafik gösteriliyor; uyarı görünür.
- 20 otomatik test geçti. Canlı tarayıcı akışında arşiv, kaynak filtresi, watchlist, tam token arama, TOLLY grafik/işlemleri, zaman aralığı, mobil taşma ve kesinti sonrası son listenin korunması doğrulandı; JavaScript sayfa hatası görülmedi.

Test sayıları canlı duruma bağlı değişebilir. Bu sonuçlar yerel kod içindir; Railway deploy'u yapılmadı.

## Arcts referansı

[Arcts screener](https://arcts.fun/screener) ve yayımladığı [feed.js](https://arcts.fun/feed.js) incelendi. Frontend, kendi indexer'ının hazırladığı JSON beslemesini https://api.arcts.fun/api üzerinden okuyor; aynı origin geri dönüşü, kısa süreli önbellek ve eşzamanlı istek birleştirme kullanıyor. Kod içindeki 3 saniyelik indexer açıklaması yayıncının beyanıdır; sunucusunun iç uygulamasını bağımsız olarak doğrulamadık.

Bu mimari fikirden alınan ders: ortak backend beslemesi ve önbellek; her ziyaretçiye geçmiş zincir taraması yaptırmamak. Arcts'nin toplu market beslemesi bizim kaynağımız yapılmadı, özel frontend kodu kopyalanmadı. Ürünümüz yalnızca bağlı padlerin kendi verisini kullanır.

## Kapsam / sürüm notu

Radar kendi market sayfası en fazla 500 kayıt; tüm kendi launch kataloğu ayrıca arşivlenir. Tolly sayfalaması en fazla 1.000 kayıtla sınırlandırılmıştır. DYOR listelemesi `nextCursor` ile 100'lük sayfaları takip eder; cursor sayfaları cache'lenir ve tek senkronizasyonda güvenli bir üst sınırla alınır. Önceden görülen katalog kayıtları korunur; API'nin üst sınırının ötesindeki kayıtlar bir sonraki genişletme/senkronizasyon çalışmasına kalır. PGlite/PG veritabanının kalıcı olması gerekir.

Veritabanı yazıları 250 kayıtlık toplu sorgulara çevrildi. Eski yanlış importlar feed_schema/catalog_schema işaretleri ile yeni beslemelerden ayrılır; eski veri silinmez. Bildirilen fiyat/holder/likidite rakamları sağlayıcı verileridir; bağımsız zincir denetimi veya fiyat doğruluğu garantisi değildir.
# Noxa historical markets

Noxa discovery uses RadarDEX's `tokens?launchpad=noxa&window=24h&limit=500` feed, strictly accepting `launchpad: noxa`. The feed currently includes 70 records, including inactive markets. No Noxa factory address has been verified or configured. Charts and trades use RadarDEX's token endpoints and detail attribution must also match Noxa. Historical records remain searchable; the default active list only shows recent activity. This is a market-indexer integration, not a direct Noxa API.
# Local chart engine (2026-09-11)

All detail charts pass through `chart-engine.js`. Sharc and CircleWarp do not request upstream candles: their paginated raw trades are stored in `chart_trades`, with progress in `chart_sync`. History loads on demand with bounded requests and persists across restarts. Burns, zero-value transfers and duplicate trades cannot change price or inflate volume. All six UTC intervals are generated from the same tape. Each active candle opens at the previous recorded close (first candle uses its first trade), and its high/low includes that opening mark. No empty candles or synthetic volume are inserted.

For other sources, raw recent trades are stored and aggregated locally; earlier provider candles remain explicitly marked as bootstrap history until local coverage expands. Verified token/USDC V2/V3 and V4 pools can be backfilled through public RPC in bounded 10,000-block windows. V4 pool keys are hashed and checked against the pool ID; swaps are scoped to that ID at the verified PoolManager. Native USDC uses 18 decimals, ERC20 USDC uses 6; V4 swap signs differ from V3. Unsupported quote currencies are rejected. API and RPC trades are selected from non-overlapping time ranges. `history` in the detail response exposes completeness, bootstrap status and RPC failures. This is incremental coverage, not a claim of complete on-chain history for every listed token.
# Source and venue contract (2026-09-11)

`public/sources.js` is the shared source/capability registry used by the terminal and chart engine. Register a new source there, then supply normalized trades (stable ID, Unix timestamp, USD price/volume, optional block/log ordering) and/or OHLC history through its adapter. The common engine owns ordering, deduplication, time buckets, opening-mark continuity, high/low bounds, and persistence. A new source still needs a verified data adapter; the registry cannot manufacture missing history.

Uniswap V3/V4 and DYORSwap V2 discovery uses RadarDEX's version-filtered market index, checking returned versions and V2 DEX IDs. Known launchpad attribution wins over DEX classification. Unknown launchpad tags are skipped, not renamed Uniswap. Independent markets are labelled Uniswap or DYORSwap V2. Discovery refreshes three bounded top pages; search queries the full upstream index on demand because its offset parameter does not paginate. This does not claim every chain token is indexed locally.

pools.trade OHLC is bucketed before its volume bins are attached. Coarser volume bins are never split into finer candle volumes; unknown values remain null. All providers, including historical bootstrap candles, share the same opening-mark continuity. Archemist rolling 24-hour volume snapshots are not candle volume. RPC history is isolated by pool, and checkpoints are reset when the selected pool or checkpoint schema changes. Run `node scripts/audit-charts.mjs` for a live representative-source/six-timeframe contract audit.
# ArgusPad (2026-09-12)

ArgusPad (https://arguspad.io) has no public token list endpoint; its `/api/candles` and `/api/trades` routes serve its general Arc token index, not its launches. The launch list is on chain. Each Portal exposes `tokenCount()` and `allTokens(uint256)`. The six Portals and their lines come from ArgusPad's integrator bundle `/argus-v4.json`: current hooked-v4 `0xa5628a11...49d6`, hooked-v4 `0x07a688a0...6cc6e`, `0xa36c443a...0862`, `0x7a17ab01...8338`, legacy-v3 `0xbed9880a...246c` and `0x0f1c7cb2...587a` (the first, which launched ARGUS).

`src/argus.js` reads that registry incrementally with batching disabled (Arc returns -32600 on batches). Discovery accepts a RadarDEX `launchpad=argus` row only when a Portal lists the address; the Portal becomes the row's factory. Registry tokens missing from the feed are named from their ERC-20 contract and keep null market fields. Detail uses RadarDEX token, chart and swaps endpoints and rejects a detail whose launchpad is not `argus`.

Live check: 42 launches on chain, 42 in the feed, 42 with an icon. ARGUS detail served 219 candles and 60 trades; the last close matched the listed price.

# Self-indexed markets (2026-09-12)

Discovery no longer depends on another screener's token list. Uniswap v3's factory and the v4 PoolManager both publish pool creation events, so `src/onchain.js` reads them directly and keeps every USDC-quoted pool. Measured live: the v3 factory emitted 31 PoolCreated in the last 10,000 blocks and has been active since early history; the v4 PoolManager emitted 9 Initialize in the same span, 7 of them USDC-paired. Swap volume is equally cheap to read, 171 v4 logs and 545 v3 logs per 10,000 blocks, under a second each, so a full day is 34 requests.

Prices come from each swap's sqrtPriceX96 through the existing converter, with the v4 sign convention handled separately from v3. Pool liquidity for v3 is the pool's own USDC balance: the TOLLY pool read 105,119 USDC against RadarDEX's reported 112,771, the difference being how each side is counted. v4 pools hold their funds in the shared PoolManager and are left unknown.

Totals are gated on real coverage. A 24 hour figure is published only when the stored tape covers 24 hours or the token is younger than the tape. Otherwise price and last trade time are published alone.

v2 pairs are discovered the same way. The three factories in use were found by asking a live pair which factory built it, not from a list: `0x942bd5bf...5c10` and `0x8e79e9e7...b664` emit the standard PairCreated, while `0x32330c24...577a` is a proxy whose implementation emits a five argument variant, `PairCreated(address,address,address,address,uint256)`. Both are accepted. Checked against a known pair: the WARP/USDC pair `0x507a494f...7ea7` was located at its real creation block 12,912,789 by binary search over archive state, and discovery returned it from that window along with five other v2 pairs. A v2 swap carries four unsigned amounts and no price of its own, so the price is what the trade paid; decoding a live WARP swap gave 0.000618 USDC against RadarDEX's reported pool price of 0.000630.

Markets whose upstream launchpad tag is not one we have integrated are no longer dropped from discovery. The pool exists and trades, so the row is kept and attributed to the venue we can verify, with the raw tag recorded and never read as one of our own pads. This restored 235 markets, 498 of them on v4, including the o1, klik and pegd clusters.

Holder lists come from the chain explorer's own balance index first, which covers every token regardless of pad, then from the token's pad, then from a general index. Measured: TOLLY, WARP, ARGUS and SHARCFUN were served by the explorer with holder counts of 1,269, 1,089, 404 and 513; ACAT and BARC returned a persistent internal error there and were served by the fallback with 284 and 495. When no source answers, the panel says the list is unavailable instead of showing anything invented.

The chart no longer carries an informational banner. How the candles were assembled, and whether a background refresh is still pending, are not things the reader acts on; only a failed chart refresh is reported.

Burned supply is read from the token contract, not taken from a feed: the balances of the dead and zero addresses are summed against total supply. ARGUS read 35,684,189 burned, 3.57 percent, against RadarDEX's reported 3.5. In the holder list the pools we indexed and the v4 PoolManager are tagged Pool, and the burn addresses are tagged Burned, so neither reads as the token's largest wallet.

The detail chart can be read as price or as market cap. The multiplier is the row's own market cap divided by its price, so the chart cannot disagree with the overview beside it. Checked on BARC: price candles closed at $0.000263226 and the same candles in market cap mode closed at $262.75K against a reported market cap of $262.75K.

The OG mark goes to the earliest creation date recorded under a ticker, and only when one contract is outright earliest: an unknown date keeps a token out of the comparison and a shared earliest second gives the mark to nobody. Checked on ARC, where 66 contracts share the ticker: the mark landed on 0xd703…04b6, created 2026-07-17, both in its own heading and against it in the same-ticker list of a newer ARC.

Holder Maps are built from the token's own Transfer log, from the contract's creation block to the head, in 10,000 block windows with the progress stored so a scan resumes rather than restarts. Measured lifetimes: BARC 47 windows, ARGUS 167, TOLLY 692, which is minutes of background work per token and only new blocks afterwards. The creation block is found by binary search over archive state.

Clustering runs over plain wallets only. The first build linked every holder into one cluster through the v4 PoolManager, which every trader touches; excluding addresses that carry code, along with the burn addresses, left BARC with two real clusters, two wallets at 4.39 percent and three at 3.64 percent. Contracts and burn addresses are still drawn and still counted, they are simply not joined through. An edge means one mapped holder sent the token to another and the panel says so, including that an exchange or router leaves the same trace.

Scanning is parallel because latency, not volume, was the cost: a single RPC call takes about a second and eight together still take about one. Batching the window fetches, the per-holder code checks and the creation-block search brought a full build to 22 seconds for BARC, 29 for ARGUS and 83 for TOLLY, whose history is 692 windows. The parallel creation-block search was verified against the sequential one, both returning block 20,019,032 for BARC. Maps are also seeded ahead of demand: with the server running, the busiest tokens built themselves unprompted, six of the top ten within seven minutes, and a token opened by a reader jumps the queue.

The slow part was never the amount of data, it was which endpoint served it. The same 10,000 block query took 646 ms on one provider and 190 ms on another, and the plain fallback order always used the first that answered rather than the fastest. Ranking the providers by measured latency and raising concurrency to 16 read TOLLY's whole history, 694 windows and 16,562 transfers, in 3.9 seconds with no failures. End to end a map now takes 2.1 seconds for ARGUS and 5.6 for TOLLY, against 29 and 83 before.

Bubblemaps itself keeps an indexed transfer database rather than scanning per request, and hides contracts and exchanges by default for the same reason we exclude them from clustering. The explorer's own transfer index was measured as an alternative and rejected: it is complete but pages 100 records at a time behind a cursor with no block-range parameter, which is 62 sequential pages for BARC and 164 for TOLLY, slower than parallel RPC windows.

Map building is paused while a market sync is in flight. Both draw on the same endpoints, and sixteen parallel window reads starved the startup sync badly enough that it never finished.

The header price used to be read off the last candle of whichever timeframe was open. Each timeframe's snapshot is prepared at its own moment, so the same token reported 0.0025767 on 1m and 0.0025566 on 15m, and the market cap scale moved with it. The figure now comes from the market row and is refreshed on every serve. Checked across 1m, 5m, 15m, 1h, 4h and 1d on the five busiest tokens: one distinct price each, none disagreeing.

# long.supply and the o1 launchpad (2026-09-12)

Neither publishes a token list, so membership is read from their factories. Both were found on chain, not from the sites: for several tokens the creation block was located by binary search over archive state, the transaction in that block that created the token named the factory, and the factory log in that block whose first topic held the new token's address named the launch event. long.supply launches from `0x3324d45d...24b5` with event `0x50aaba7c...`, the o1 launchpad from `0xee3e862e...4605` with event `0x207384e8...`.

The node returned every log of a factory regardless of the topic filter sent with the request, and each factory emits several events per launch, so the first scan put pool addresses and USDC into the o1 registry. The event is now matched in our own code and its signature is part of the scan cursor, so changing which event is read rescans rather than trusting old rows. After the fix: long 181 launches, o1 36, no junk entries, and o1 matches RadarDEX's count for the same tag exactly. Through the pipeline long produced 181 rows with 129 priced and 15 registry-only, o1 36 rows with 34 priced.

A deployment showed the sync never completing: the market list stayed empty, the chain cursors kept moving and nothing errored. The cause was naming launches that the feeds do not list. Each unknown token's name and symbol were read from its contract one after another, and long.supply alone has around 150 of them, so a single round took many minutes. Those reads are now bounded per pass and issued in parallel, ArgusPad's Portal indices likewise, and every source runs against a deadline so one slow source can no longer hold the round. Measured on an empty database: the first sync finished in 91 seconds with all fourteen sources reporting ok, against never finishing before. Holder maps were also changed from stopping during a sync to running at reduced concurrency, because on that deployment the sync was rarely idle and no map was ever built; with the change the ten busiest tokens had finished maps while syncs continued.

Two further problems surfaced on the deployment. The chain-backed registries ran inside the sync and, from a host further from the RPC endpoints, took longer than the sync's own deadline, so ArgusPad, long and o1 were dropped every round; they now fill from a background task and a sync reads only what has been found. And the factory scan was fetching every log of a factory because the topic filter sent through the client helper never reached the node: sent as a raw eth_getLogs call the node filters it, a window returns a handful of records instead of everything, and a full history scan went from stalling to about three seconds per round. Measured after both changes on an empty database: first sync 46 seconds, fourteen of fourteen sources ok, and within two minutes long held 181 launches, ArgusPad 126 and o1 37.

# Dropping the screener feeds (2026-09-13)

The DYOR feed and RadarDEX's version pages are gone. Uniswap markets come from our own factory scan, and search no longer makes a remote discovery call. Checked live: eleven of eleven sources ok, first sync 45 seconds, 4,657 markets in the list.

Logos and links are now read from the chain first. long.supply records an ipfs:// metadata document in its launch event; the strings are recovered from the log data without needing the event's ABI, and the document yields name, description, image, external_url, twitter and telegram. Of the first 106 launches examined, 64 carried usable metadata on chain. The o1 launch event records no strings, so those tokens still take their logo from a pad API. Nothing is invented: a token whose metadata is absent keeps empty fields.

Wallet balances were added. Token holdings come from the explorer's address index, which is the one thing we cannot reproduce cheaply, and the native USDC balance is read from the chain in a single call. Holdings are valued with the same prices the market list shows; a token we do not price keeps its balance and an empty value. Checked live against 0x6a3b…1e02: 90,559.96 USDC and 43,443,048 ARGUS priced at 0.00214766, totalling $183.86K, with the wallet reachable from the search box and a token address still resolving to the token rather than a wallet.

Chart history: measured across the thirty busiest tokens, charts reach back to each token's first day once the backfill has run, and WARP went from 5 days of history to its full 45 while it loaded. One real gap was found and closed: the chain backfill only ran for sources with no paged history, so a token on a paged source whose API stops handing out older pages kept a chart that began partway through its life. The chain now takes over when the pages run out or finish. A separate attempt to deepen the chain backfill several windows per pass was reverted: it stopped the backfill from running at all in testing and was not shipped unverified.

The chain backfill was slow for three separate reasons, all found by tracing inside it. It asked the node for every log's block timestamp although Arc returns it on the log; it advanced one 10,000 block window per pass; and one endpoint answers contract reads and deep log queries with a JSON-RPC error rather than a transport failure, which a fallback transport treats as a real answer, so the backfill stopped instead of trying the next endpoint. Contract reads are now also issued one at a time, because sending them together made the first endpoint reply with something that is not JSON-RPC at all. Measured on the TOLLY pool afterwards: each pass reaches 0.6 days further back in about 13 seconds, against 0.06 days before. One pool, ARCH's, still fails its contract read against every endpoint; it is a single token and was left rather than papered over.

Search results now show and rank by market cap rather than the day's volume or the unit price, because dozens of contracts share a ticker and what separates the real market from a copy is what it is worth. An exact address or ticker match still leads regardless of size. Checked live on "arc" and "the b": results descend by market cap.

The chart now takes the pool to read from our own discovery, with the feed's answer only as a fallback, so a token's history no longer depends on a provider naming its pool. Checked live across the six busiest tokens: charts cover each token's full life. An attempt to go further and read the chain for every source, including those that page their own history, was reverted: in testing it left several charts with no candles at all, and it is not worth shipping a regression to remove one more dependency.

DYOR is now read from its factories rather than its API. Two were found on chain by the usual route: the current `0x80b42aed...2bf4` and an older `0xdfef2f90...ddc4`, each announcing launches with its own event, so a pad may now declare several. The scan found 4,163 launches. Its market feed is not used at all: prices and volumes come from our own chain reading, and a pad declaring no feed is a supported case. Checked live: twelve of twelve sources ok, DYOR listing and growing as launches are named. Three failures were fixed along the way: naming reads issued dozens of calls at once and hung a source, ArgusPad's RPC client could hang on its transport ranking and now tries endpoints in order, and a contract that answers nowhere was retried every pass and now fails once, bounded, and is remembered.

Two inconsistencies were closed. The chart's newest candle is still open, and it now closes at the live price shown in the header; before, it came from a stored snapshot prepared a moment earlier, so the header and the chart disagreed and every timeframe disagreed with the others, market cap mode included. Checked on LONG and ARGUS at 1h and 1d: the candle close equals the market cap shown beside it, exactly.

Metadata reading was widened beyond pads whose factory we know. For any token we discovered through its pool, the block that pool was created in is read and a metadata link naming that token is taken from it. After two minutes on an empty database, 36 of 68 tokens examined carried a logo from the chain, and nine of the ten busiest markets showed one.

Launch factories were found on chain for every remaining pad: Tolly, Sharc (three factories), CircleWarp, Archemist, pools.trade, Noxa and RadarDEX (two). Scanning them worked and found 2,387 RadarDEX launches, 1,370 DYOR, 749 Tolly, 246 Long, 168 Sharc, 154 CircleWarp, 84 pools.trade and 43 o1. Wiring them in as sources was reverted: the pads' field mapping is still keyed by pad id, so turning on the registry path took over their existing mapping and broke eight tests and four sources. The addresses and events are recorded in KNOWN_PAD_FACTORIES so the work stands, and the separation they need is a deliberate change rather than a passing one.

Every pad is now read from its own launch factory and none of their market feeds is used. The separation that made this safe is small: the registry path only takes over when the payload carries a registry, so each pad's own field mapping stays reachable under the same id. Checked live: twelve of twelve sources ok, the list serving from our own indexing and the pad registries. The cost is coverage over time rather than at once, because on an empty database the factory scan walks backwards and launch names are read a bounded number per round; with Postgres attached this happens once and persists. On-chain sync was given its own longer deadline, since it now does more work than any single feed and was being cut off at the shared 90 seconds.

Two remaining inconsistencies were closed. A token detail older than a few seconds is now rebuilt when it is asked for rather than served from the background worker's last pass, which is why transaction lists lagged. And when the newest candle has closed with nothing traded since, the current period is drawn at the price being shown, so a minute chart no longer ends at an older price than a day chart. Checked on ARGUS: 1m, 15m, 1h and 1d all close at the same figure.

An open token page refreshes itself every six seconds rather than every fifteen, and the pool is read for new swaps every ten seconds rather than every thirty. Measured with a browser watching one page: six detail requests in thirty seconds and the trade list filling on its own, with no reload.

Serving a token page no longer waits on a rebuild. Whatever is stored is returned at once and a stale entry is rebuilt behind the request, which the page picks up on its next poll. Waiting for that rebuild was what made every load after a restart sit on an empty chart although the candles were already in the database. Measured by restarting against the same database: the first request returned in 0.05 seconds with its candles and trades.

Liveness was measured rather than assumed. Listed prices move when trades happen: over two minutes the tokens that traded changed price and the ones that did not had last trades between 400 and 5,000 seconds old, so a still price was correct rather than stuck. Against the chain, our figures were within a percent: ARGUS 0.62 percent and ARCASH 0.97 percent of the pool price read directly, which is the market moving between our sync and the reading. The first comparison attempt was wrong and was thrown away: it mishandled which side of the pool held USDC, and the project's own converter was used instead.

The market list round was shortened from sixty seconds to twenty-five and source answers are cached for twenty rather than sixty, so a round never serves an answer fetched two rounds earlier. How fresh the list actually is depends on how long a round takes, which on an empty database is longer than the interval itself.

The background rebuild was building a fresh detail and discarding it: nothing stored the result, so a token page kept reading the same snapshot no matter how often it polled, which is why transactions could be ten minutes behind while the header said the last trade was five minutes ago. The rebuilt payload is now published. Measured over three reads a minute apart: snapshot ages of 52, 26 and 0 seconds, refreshing without a reload.

The wallet page was checked for completeness before being changed: against one address the explorer returned a single token holding, and reading balanceOf directly for the forty busiest listed tokens found nothing it had missed, so the list was complete rather than short. What was missing was context, so each holding now carries the day's change, its dollar value and its share of the wallet, with the header splitting the total between tokens and USDC. A holding we cannot price keeps its balance and leaves value and share empty.

A pad row was writing the market fields as nulls for launches its factory listed, which erased the price, volume and timestamps our own indexing had already measured for the same token. That is what put an hour old snapshot next to a three minute old trade. Pad rows now carry only what they know, and the chain source runs after them so a measured number is never overwritten by an absent one. Checked live: twelve of twelve sources ok and the busiest markets carrying prices, refreshed within one sync round.

Discovery and naming are now ordered by what trades. Tokens with recorded swaps are described first and the newest pools next, instead of address order, which had left a market someone was trading behind thousands of pools that never traded. Pad launches are named newest first for the same reason. Measured on an empty database after 150 seconds: 50 of 179 discovered tokens described, and every one of the twelve busiest markets carrying a price.

Indexing and the market round were separated. Following the chain runs continuously in the background: pools arrive from the factories, swaps are read from the head, and launch names and metadata fill in at their own pace. The market round now only reads the database. Before this they shared a round, so the list was as old as the slowest scan inside it, which is what put "Updated 7m ago" on the page. Measured after the split: the first round completed in 15 seconds and successive rounds were 27 to 29 seconds apart, which is the configured interval rather than the work.

RadarDEX, for comparison, describes itself as scanning every USDC-paired token on Arc from its own servers, which is the same shape as our own indexing; its terms note it also leans on third-party data indexers.

DYOR's tokens were not lost: their pools sit in factories we already scan, the v3 factory 0xf0db7b58...3918 and the v2 factory 0x942bd5bf...5c10, and the backwards scan simply had not reached the blocks they were created in. Waiting for it is the wrong answer, so a launch we already know about is now asked about directly: the factory is queried for a USDC pool per fee tier, which found both test tokens' v3 pools in 19 seconds. The indexer links a batch of pool-less launches this way each turn, newest first. Registries themselves keep filling in the background: 1,486 RadarDEX launches, 1,206 DYOR, 663 Tolly, 254 Long, 152 Sharc, 138 CircleWarp, 84 pools.trade, 50 o1 and 9 Archemist at the time of the check.

The separate on-chain source was folded into Uniswap: what we discover comes from Uniswap's own v2, v3 and v4 factories, so it is named after the venue rather than after how we got it, and the same markets no longer arrive twice. Checked live: one Uniswap entry in the filter and every row under it carrying our own source.
