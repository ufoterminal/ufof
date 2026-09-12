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
