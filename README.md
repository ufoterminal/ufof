# UFO Screener — salt okunur Arc terminali

RadarDEX referanslı token tablosu ve detay ekranı. Swap, cüzdan bağlantısı, launch işlemi, puan veya locker yoktur.

## Çalıştırma / Railway

Node.js 22.9+ gerekir:

```powershell
npm ci
npm start
```

Yerelde varsayılan adres http://localhost:3000. Windows'ta BASLAT.cmd de kullanılabilir.

Railway mevcut Node servisini kullanır; start command `npm start`, sağlık kontrolü `/health`. Platformun PORT değişkenini değiştirmeyin. package.json repository kökünde bulunmalı (veya Railway Root Directory bu klasöre ayarlanmalı).

- PostgreSQL varsa Railway Variables içinde DATABASE_URL tanımlayın.
- PostgreSQL yoksa PGlite kullanılır. Kalıcılık için Railway volume bağlayıp DATA_DIR değişkenini o mount path'e, örneğin /data, ayarlayın.
- PGlite için tek replica kullanın; volume aynı anda birden çok process tarafından açılmamalı.
- Kalıcı veritabanı olmadan yeniden deploy, birikmiş tarihsel arşivi kaybettirir.
- .env.example belgelendirme içindir; npm start dosyayı otomatik yüklemez. Değişkenleri platformdan veya kabuktan tanımlayın.

Bu sürüm yerelde test edilmiştir; Railway'e otomatik deploy veya GitHub'a push yapılmamıştır.

## Yeni veri akışı (snapshot v3)

Token detay API'si dış API veya RPC beklemez. PostgreSQL/PGlite içindeki kalıcı
snapshot'ı okur; ayrı arka plan worker'ı kalıcı kuyruktan fiyat ve mumları hazırlar.
İlk kez hazırlanan zaman dilimi `cache.pending` döndürür; son sağlam grafik
yenileme hatasında silinmez. `/api/indexer` kuyruk durumunu gösterir.

Yerelde ve tek Railway servisinde `npm start` worker'ı da çalıştırır.
Üretimde ayrı servisler için her ikisine aynı `DATABASE_URL` verin:
web: `npm start`, `INDEXER_MODE=external`; worker: `npm run worker`.
PGlite dizinini iki süreçle paylaşmayın. PostgreSQL kullanmıyorsanız DATA_DIR için
kalıcı Railway volume gerekir. `INDEXER_CONCURRENCY=2` varsayılandır.

V3 token1 fiyatında 24 basamaklık hataya neden olan decimal yönü düzeltildi.
Eski hatalı RPC kayıtları silinmeden ayrılır; yeni hesaplar `rpc-v3` alanında
yeniden oluşturulur. Fiyat, görüntülenen grafiğin son kapanışını kullanır.

Bu sürüm hâlâ hibrittir: standart token/USDC V2/V3/V4 işlemleri RPC'den,
özel launchpad işlemleri mevcut kaynak adaptörlerinden gelir. Eski sağlayıcı
mumları yerel geçmiş tamamlanana kadar bootstrap olarak kullanılabilir.
RPC takibi 12 blok geriden ilerler ve kayıtlı blok hash'ini kontrol eder; değişen
dalın eski işlemleri yeni nesil hesaplardan ayrılıp geçmiş yeniden hazırlanır.
Tüm zinciri kapsayan factory indexer ve bütün özel curve'lerin bağımsız event
çözümü bu sürümde tamamlanmış değildir. Public RPC ile bütün
tokenlerin her an güncel veya ilk açılışının anlık olduğu garanti edilmez.

## Kapsam

| Kaynak | Kendi token listesi | Grafik / işlemler |
|---|---|---|
| RadarDEX | Kendi launch kataloğu + aidiyet kontrolü | Kendi API'si |
| Tolly | scope=ours ve tolly=true | Kendi API'si |
| Sharc | Kendi /api/tokens, Arc filtresi | Kendi API'si |
| DYOR | Arc chain 5042 token API'si | Detay + son işlemler; mumlar kaynak trade kayıtlarından üretilir |
| CircleWarp | Kendi Arc indexer API'si (223 token) | Kendi candles/trades/holders uçları |
| Archemist | Kendi launch registry API'si (factory doğrulamalı, 54 token) | Kendi token/chart uçları; V2/V3 bilgisi korunur |
| pools.trade | Arc üzerinde `poolstrade` olarak etiketlenen 30 tokenlik aktif kaynak | Liste için filtreli keşif mirror'ı, grafik için pools.trade tRPC Arc fiyat/OHLC API'si |
| Kendi zincir okumamız | Uniswap v3 fabrikası ve v4 PoolManager'ın havuz açılış logları | Havuzun kendi Swap loglarından fiyat, hacim, işlem, değişim |
| ArgusPad | Zincirdeki Portal kayıtları (`tokenCount` / `allTokens`, 6 Portal) | Piyasa sayıları ve logo `launchpad=argus` beslemesinden, yalnızca Portal'ın listelediği adreslere; grafik ve işlemler RadarDEX token uçlarından |

DYOR artık kendi Arc API'sinden canlı liste ve detay/işlem verisi sağlar. API bir grafik endpoint'i yayınlamadığı için mumlar yalnızca DYOR'un `/trades` yanıtındaki gerçek fiyat ve hacim kayıtları gruplanarak üretilir; interpolasyon veya üçüncü taraf grafik verisi kullanılmaz. CircleWarp ve Archemist yalnızca kendi launch registry/screener kayıtlarını kullanır; genel Arc/Uniswap listesi bu kaynaklara karıştırılmaz. pools.trade aktif: keşif isteği yalnızca `launchpad=poolstrade` filtresiyle yapılır, dolayısıyla diğer RadarDEX tokenleri içeri alınmaz; fiyat ve OHLC detayları pools.trade'ın Arc (5042) tRPC prosedürlerinden okunur. pools.trade'ın herkese açık launcher listesi hâlâ Robinhood sonuçları döndürdüğü için bu liste doğrudan kullanılmaz.

ArgusPad token listesi yayınlamıyor; launch listesi Portal kontratlarında duruyor. Hangi tokenin ArgusPad'e ait olduğunu `src/argus.js` zincirden okuyarak belirler. Portal adresleri ve sırası ArgusPad'in kendi entegrasyon dosyasından alındı (https://arguspad.io/argus-v4.json). Bir satır ancak hem beslemede `launchpad=argus` etiketi taşıyorsa hem de bir Portal onu listeliyorsa kabul edilir. Zincirde olup beslemede henüz görünmeyen yeni bir launch da listeye girer: adı ve sembolü token kontratından okunur, fiyat ve hacim bilinmiyor olarak kalır, sıfır yazılmaz. Her yenilemede Portal başına yalnızca yeni indeksler okunur. Arc JSON-RPC toplu isteği reddettiği için istekler tek tek gider. Doğrulama (12 Eylül 2026): zincirde 42 launch (16+1+22+1+1+1), beslemede 42, hepsinde logo.

Arama sonuçlarında token logosu gösterilir. Logosu olmayan veya resmi yüklenmeyen tokende iki harfli işaret kalır.

## Kendi verimiz

`src/onchain.js` listeyi başka bir screener'a sormadan kurar. Keşif fabrikalardan gelir: Uniswap v3 fabrikası (`0xf0db7b58...3918`, ayrıca aynı bytecode'a sahip `0x874dc9d6...d736a`) `PoolCreated`, v4 PoolManager (`0x8366a39c...0951`) `Initialize`, üç v2 fabrikası (`0x942bd5bf...5c10`, `0x32330c24...577a`, `0x8e79e9e7...b664`) `PairCreated` yayınlar. v2 fabrikaları canlı bir havuza hangi fabrikanın kurduğu sorularak bulundu; ikisi standart dört argümanlı imzayı, biri beş argümanlı bir varyantı kullanıyor, ikisi de kabul ediliyor. v2 çiftleri kendi fiyatlarını taşımadığı için fiyat işlemin ödediği tutardan çıkarılır. USDC çiftli havuzlar alınır, yani bir token için USDC havuzu açıldığı anda listeye girer; hangi pad çıkarmış olduğuna bakılmaz. Fiyat, hacim, işlem sayısı, alış/satış kırılımı ve 5m/1h/6h/24h değişimleri o havuzun `Swap` loglarından kendi tuttuğumuz kayıttan hesaplanır. Ad, sembol, ondalık ve arz doğrudan token kontratından okunur.

Sınırlar zincirin kendi sınırları: `eth_getLogs` istek başına 10.000 blok, toplu JSON-RPC reddediliyor, Arc günde yaklaşık 170.000 blok üretiyor. Yani bir günlük işlem 17 pencere demek. Her tur bir pencere ileri gider, `ONCHAIN_BACKFILL` kadar pencere geriye iner (varsayılan 3, tur başına ~5,6 saat). İmleçler veritabanında durur, kesilen tarama kaldığı yerden devam eder. Loglar `blockTimestamp` taşıdığı için blok başına ayrı sorgu yapılmaz.

Bir pencere "24 saatlik hacim" diyebilmek için ya kaydımızın 24 saati kapsaması ya da tokenin kaydımızdan yeni olması gerekir; ikincisinde tokenin bütün işlemleri zaten elimizdedir. Hiçbiri geçerli değilse toplamlar hiç yazılmaz, yalnızca fiyat ve son işlem zamanı verilir, çünkü bunlar kapsamdan bağımsız olarak doğrudur. Böylece yarım kalmış bir geri tarama, başka bir kaynağın doğru ölçtüğü rakamı bozmaz.

Venue etiketi yalnızca kesin bildiğimiz ikisi için yazılır, v3 ve v4. Bir v2 çifti v2 olarak kaydedilir ama hangi borsanın arayüzüne ait olduğu iddia edilmez.

Ölçemediğimiz iki şey var ve uydurulmaz. v4 likiditesi: havuzun parası tek bir PoolManager içinde durduğu için havuz başına bakiye okunamaz, v3'te havuzdaki gerçek USDC bakiyesi okunur ve olduğu gibi bildirilir. Holder sayısı: tüm Transfer loglarının indekslenmesini gerektirir, henüz yapılmıyor. Bu alanlarda padlerin verdiği değer korunur.

Kendi okumamız senkronun sonunda çalışır. Kendimiz ölçtüğümüz sayı gösterilen sayı olur; logo, sosyal hesaplar ve pad aidiyeti yukarıdaki kaynaklardan gelmeye devam eder. `/api/onchain` havuz, token, işlem sayısını, kapsam saatini ve imleçleri gösterir.

V2/V3/V4 filtreleri yalnızca kaynağın açıkça bildirdiği sürümü kullanır. Sürümü bilinmeyen tokenler ana listede kalır, sürüm filtresine dahil edilmez. Bu uygulama bütün Arc V3 havuzlarının keşfedildiğini iddia etmez.

## Ekranlar ve doğruluk

- Trending (24 saat hacim sırası), son 7 günde oluşturulan tokenler, gainers/losers, yerel watchlist, arşiv, kaynak/sürüm/likidite/hacim filtreleri ve sayfalama.
- Arama yalnızca ekrandaki sayfayı değil yerel tarihsel kataloğu da tarar. Tam adres ve tam sembol eşleşmesi önceliklidir. Henüz indekslenmemiş bir token bulunamayabilir.
- Etkileşimli fiyat/hacim grafiği: 1m, 5m, 15m, 1h, 4h, 1d; gerçek son işlem kayıtları ve explorer bağlantıları.
- AGE token oluşturulma zamanıdır; keşif/senkronizasyon zamanı değildir. Kaynak vermiyorsa — kalır. Pool yaşı olarak etiketlenmez.
- Eski sürümün kaynağı doğrulanmamış fiyat/tarih kayıtları yeni feed/catalog işareti olmadan kullanılmaz. Eski veritabanı silinmez.
- Çok küçük fiyatlar anlamlı basamaklarla gösterilir. Bilinmeyen fiyat, holder ve likidite sıfır yapılmaz.
- Sharc sanal rezervleri likidite sayılmaz; toplam işlem sayısı 24 saatlik işlem sayısı yerine konmaz.
- Tutarsız OHLC varsa kapanış fiyatlarıyla çizgi grafik ve görünür uyarı sunulur; hayali mum üretilmez.
- İstatistikler yalnızca bağlı kaynak kapsamıdır, tüm Arc toplamı değildir. Rakamlar kaynak API'lerinin bildirimidir; bağımsız on-chain denetim garantisi değildir.

## Marka

Site adı UFO Screener. Üstte UFO, altında SCREENER yazar. Yanındaki figür SVG olarak çizilir, ayrı bir dosya veya resim yüklenmez: gövde süzülür, ışık huzmesi nefes alır, üç ışık sırayla yanar. İşletim sisteminde hareket azaltma açıksa animasyon çalışmaz.

## Grafik ölçeği

Grafiğin üstünde Price ve MC düğmeleri var. MC'ye basınca mumlar, çizgi, eksen ve imleç okuması market değerine döner. Çarpan satırın kendi rakamlarından çıkar, market cap bölü fiyat, yani grafik ile Market overview asla çelişmez. Tokenin arzını gösteren bir rakam yoksa ölçek fiyatta kalır ve bunun sebebi yazılır. Seçim adreste taşınır (`?scale=mc`), sayfa yenilenince korunur.

## Yakılan arz

Market overview'da yakılan arz gösterilir. Zincirden okunur, besleme verisine güvenilmez: yakma adreslerinin (`0x...dead` ve sıfır adresi) bakiyeleri ve toplam arz aynı anda okunup miktar ve yüzde çıkarılır. ARGUS'ta 35,7 milyon ve %3,57 okundu. Okuma başarısız olursa alan bilinmiyor kalır, sıfır yazılmaz. Yakma adresinde bir tam tokenden az toz kalmışsa bu bir yakma sayılmaz ve gösterilmez, çünkü ekranda "0 · 0.00%" olarak görünür ve hiçbir şey anlatmaz.

## Holders

İşlem listesinin yanında holder listesi var, sekmeyle geçiliyor ve ancak açıldığında yükleniyor. Kaynak sırası şöyle: önce zincir explorer'ının kendi endeksi (`api.arc-scan.org/v1/tokens/{adres}/holders`), çünkü padden bağımsız olarak her tokeni kapsıyor. Bazı tokenlerde sürekli 500 döndüğü için ikinci sırada tokenin kendi padi geliyor (Tolly ve CircleWarp holder yayınlıyor), üçüncü sırada genel bir endeks. Üçü de vermezse liste boş kalır ve panel bunu açıkça söyler, uydurma satır üretilmez. Listede cüzdan olmayan adresler etiketlenir: indekslediğimiz v2/v3 havuzları ve v4 PoolManager "Pool", yakma adresleri "Burned" olarak işaretlenir, böylece en büyük holder sanılmazlar.

## Sistem yükü

Tarayıcı kendi sunucumuzdan 15 saniyede bir, yalnızca görünürken okur. Kaynak listeleri ortak backend döngüsünde en az 60 saniye aralıkla alınır; döngüler çakışmaz. Radar launch kataloğu 15 dakika, Tolly ek katalog sayfaları 5 dakika önbellektedir.

Detay uçları 30 saniye önbellek ve eşzamanlı istek birleştirme kullanır. Her detayda en fazla 3 sınırlı kaynak isteği yapılır. Veritabanı yazıları 250 kayıtlık toplu sorgularla yapılır. Liste sıralama ve arama, 10 saniye paylaşılan bellek görüntüsü üzerinden çalışır. Kullanıcı başına blockchain taraması yoktur; eski deneysel indexer sunucuya bağlı değildir.

Kaynak kesintisinde geçmiş liste verisi korunur ve uyarı gösterilir. Grafik ve işlem istekleri ayrı ele alınır.

## API

- GET /api/markets — q, mode, source, version, sort, dir, page, limit, minLiquidity, minVolume
- GET /api/search?q=... — tarihsel arama
- GET /api/market/:address?tf=1h — market, candles, closes, chartMode, trades, errors
- GET /api/status ve GET /health
- GET /api/screener — yeni liste yanıtının uyumluluk takma adı

## Kontroller

`npm test`: 20 test; kaynak ayrımı, birimler, yaş, arama, filtre/sayfalama, önbellek, hata ayrımı ve PGlite toplu yazma.

Canlı tarayıcı kontrolü için sunucuyu 3478 portunda çalıştırın; `npx playwright install chromium`, sonra `node scripts/browser-check.mjs`. Farklı adres için TEST_URL verilebilir. Script artifacts/ altında ekran görüntüleri üretir. Bu canlı test internet ve kaynakların erişilebilir olmasını gerektirir.

Kaynak araştırması: [VERIFIED-DATA-FLOW.md](VERIFIED-DATA-FLOW.md). ZIP oluşturma: PowerShell'de `./scripts/package.ps1`; node_modules, veritabanı, .env ve tarayıcı önbelleği pakete alınmaz.
