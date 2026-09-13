# UFO Screener — salt okunur Arc terminali

RadarDEX referanslı token tablosu ve detay ekranı. Swap, cüzdan bağlantısı, launch işlemi, puan veya locker yoktur.

## Çalıştırma / Railway

Node.js 22.9+ gerekir:

```powershell
npm ci
npm start
```

Yerelde varsayılan adres http://localhost:3000.

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
| Long (long.supply) | Fabrikanın launch olayı (`0x3324d45d...24b5`) | Piyasa sayıları `launchpad=long` beslemesinden, yalnızca fabrikanın çıkardığı adreslere |
| o1 (launch.o1.exchange) | Fabrikanın launch olayı (`0xee3e862e...4605`) | Piyasa sayıları `launchpad=o1` beslemesinden, yalnızca fabrikanın çıkardığı adreslere |
| ArgusPad | Zincirdeki Portal kayıtları (`tokenCount` / `allTokens`, 6 Portal) | Piyasa sayıları ve logo `launchpad=argus` beslemesinden, yalnızca Portal'ın listelediği adreslere; grafik ve işlemler RadarDEX token uçlarından |

DYOR artık kendi Arc API'sinden canlı liste ve detay/işlem verisi sağlar. API bir grafik endpoint'i yayınlamadığı için mumlar yalnızca DYOR'un `/trades` yanıtındaki gerçek fiyat ve hacim kayıtları gruplanarak üretilir; interpolasyon veya üçüncü taraf grafik verisi kullanılmaz. CircleWarp ve Archemist yalnızca kendi launch registry/screener kayıtlarını kullanır; genel Arc/Uniswap listesi bu kaynaklara karıştırılmaz. pools.trade aktif: keşif isteği yalnızca `launchpad=poolstrade` filtresiyle yapılır, dolayısıyla diğer RadarDEX tokenleri içeri alınmaz; fiyat ve OHLC detayları pools.trade'ın Arc (5042) tRPC prosedürlerinden okunur. pools.trade'ın herkese açık launcher listesi hâlâ Robinhood sonuçları döndürdüğü için bu liste doğrudan kullanılmaz.

long.supply ve o1 launchpad da token listesi yayınlamıyor. `src/pad-registry.js` bu ikisinin fabrikalarını dinler: her launch için fabrikanın yaydığı olayın ilk konumunda yeni tokenin adresi durur, kayıt bundan ibarettir. Fabrika ve olay siteden değil zincirden bulundu: birkaç tokenin doğum bloğu arşiv üzerinden ikili aramayla bulundu, o bloktaki tokeni yaratan işlem fabrikayı verdi, o blokta fabrikanın yaydığı loglardan ilk konumunda tokenin adresi bulunan da launch olayını verdi. Doğrulama (12 Eylül 2026): long 181, o1 36 launch; o1'in sayısı RadarDex'in aynı etiketle gördüğüyle birebir aynı.

Bir tuzak vardı: düğüm, istekte verilen topic filtresini uygulamadan fabrikanın tüm loglarını döndürüyordu ve bir fabrika launch başına birkaç farklı olay yayıyor. Yanlış olayı okumak kayda havuz adreslerini ve hatta USDC'yi sokmuştu. Olay artık istekte değil kendi tarafımızda eşleştirilir ve olayın imzası imleç anahtarının parçasıdır, yani hangi olayın okunduğu değişirse tarama baştan yapılır.

ArgusPad token listesi yayınlamıyor; launch listesi Portal kontratlarında duruyor. Hangi tokenin ArgusPad'e ait olduğunu `src/argus.js` zincirden okuyarak belirler. Portal adresleri ve sırası ArgusPad'in kendi entegrasyon dosyasından alındı (https://arguspad.io/argus-v4.json). Bir satır ancak hem beslemede `launchpad=argus` etiketi taşıyorsa hem de bir Portal onu listeliyorsa kabul edilir. Zincirde olup beslemede henüz görünmeyen yeni bir launch da listeye girer: adı ve sembolü token kontratından okunur, fiyat ve hacim bilinmiyor olarak kalır, sıfır yazılmaz. Her yenilemede Portal başına yalnızca yeni indeksler okunur. Arc JSON-RPC toplu isteği reddettiği için istekler tek tek gider. Doğrulama (12 Eylül 2026): zincirde 42 launch (16+1+22+1+1+1), beslemede 42, hepsinde logo.

Arama sonuçlarında token logosu ve market değeri gösterilir. Birim fiyat yerine market değeri yazılır, çünkü aynı ticker'ı paylaşan onlarca kontrat arasında hangisinin gerçek piyasası olduğunu ayırt ettiren şey odur. Market değeri bilinmeyen tokende çizgi görünür. Sonuçlar da market değerine göre sıralanır, büyükten küçüğe; tam eşleşen adres veya sembol yine en üstte kalır, çünkü aradığın şeyin kendisi neye değerse değsin ilk sırada olmalı. Logosu olmayan veya resmi yüklenmeyen tokende iki harfli işaret kalır.

## İndeksleme ve liste turu ayrı

Zinciri takip etmek ile piyasa listesini kurmak artık ayrı işler. İndeksleyici arka planda sürekli çalışır: yeni havuzlar fabrikalardan düşer, yeni swap'lar baştan okunur, launch adları ve metadata kendi ritminde tamamlanır. Piyasa turu ise yalnızca veritabanını okur.

Öncesinde ikisi aynı turdaydı ve tur, içindeki en yavaş taramanın süresi kadar sürüyordu; sayfada "Updated 7m ago" görmenin sebebi buydu. Ölçüm: ayrımdan sonra ilk tur 15 saniyede tamamlandı ve turlar arası süre 27-29 saniye, yani ayarlanan aralığın kendisi.


Zincirden okuma, işlem görmüş tokenleri önce tanımlar; sonra en yeni açılan havuzları. Öncesinde adres sırasına göre gidiliyordu, yani birinin o an alıp sattığı bir piyasa hiç işlem görmemiş binlerce havuzun arkasında bekleyebiliyordu. Padlerin adlandırma sırası da en yeni launch'tan başlar, çünkü eski launch'lar çoğunlukla bitmiştir. Ölçüm: yüz elli saniyede 179 tokenin 50'si tanımlandı ve listenin en hacimli on ikisinin hepsinde fiyat vardı.


Kendi zincir okumamız senkronun sonunda çalışır, padlerden sonra. Bir pad satırı yalnızca kendi bildiğini yazar: fabrikadan gelen aidiyet, ad ve doğum zamanı. Fiyat, hacim ve tazelik alanlarını boş yazmayı bıraktı; öncesinde bunları null olarak yazıp kendi ölçtüğümüz rakamların üstünü siliyordu ve sayfa, üç dakika önceki bir işlemin yanında kırk dakikalık bir anlık görüntü gösteriyordu.


Tolly, Sharc, CircleWarp, Archemist, pools.trade, Noxa, RadarDEX, DYOR, ArgusPad, Long ve o1: hepsinin launch listesi artık kendi fabrikalarından zincirden okunuyor, hiçbirinin piyasa beslemesi kullanılmıyor. Fiyat, hacim, işlem sayısı ve değişimler kendi zincir motorumuzdan geliyor.

Bunun bedeli şu: sıfırdan kurulan bir veritabanında bu listeler hemen dolmaz. Fabrika taraması geriye doğru yürür ve launch adları tur başına sınırlı sayıda okunur, dolayısıyla kapsam saatler içinde birikir. Postgres bağlıyken bu bir kereliktir ve deploy'lar arasında korunur. Önceden padlerin API'si her turda hazır liste verdiği için kapsam anında geliyordu; artık anında değil ama kimseye bağlı değil.

Kayıt yolu yalnızca kayıt taşıyan yükte devreye girer. Padlerin kendi alan eşlemeleri aynı kimlik altında erişilebilir kalır, bu ayrım olmadan kayıt yolu mevcut eşlemeyi devralıyor ve kaynakları bozuyordu.


Kalan padlerin fabrikaları zincirde bulundu ve `KNOWN_PAD_FACTORIES` altında kayıtlı: Tolly `0xcad7ee36...9c8b`, Sharc üç fabrika, CircleWarp `0x0dcad158...1255`, Archemist `0x44b10910...9774`, pools.trade `0x0000ffff...19c0`, Noxa `0xe7d4e640...d372`, RadarDEX iki fabrika. Tarama denendi ve çalıştı: RadarDEX 2.387, DYOR 1.370, Tolly 749, Long 246, Sharc 168, CircleWarp 154, pools.trade 84, o1 43 launch.

Bunları kaynağa bağlamak tek satırlık bir iş değil: padlerin alan eşlemesi hâlâ pad kimliğine bağlı ve kayıt yolunu açtığımda mevcut eşlemeyi devralıp sekiz testi kırdı. Ayrıştırma işi ayrıca ve dikkatle yapılmalı, o yüzden fabrikalar kayıtlı duruyor ama devrede değil.


DYOR artık kendi API'siyle değil zincirdeki fabrikasından okunuyor: `0x80b42aed...2bf4` (güncel) ve `0xdfef2f90...ddc4` (eski), her biri kendi launch olayıyla. Tarama 4.163 launch buldu. Bu padin piyasa beslemesi hiç kullanılmıyor; fiyat, hacim ve işlem sayısı kendi zincir okumamızdan geliyor, besleme yalnızca aidiyet için bile gerekmiyor. Bir padin beslemesi olmayabilir, kod bunu artık normal bir durum olarak kabul ediyor.

Launch adları önce kendi indekslediğimiz token tablosundan alınır, orada yoksa tur başına sınırlı sayıda kontrattan okunur. Adı henüz bilinmeyen launch listeye girmez, boş satır göstermeyiz.


Kaldırılan kaynaklar filtre listesinde görünmez ama isimleri kayıtlı kalır: eski turlarda o kaynakla kaydedilmiş bir satır ham kimlik yerine düzgün adıyla okunur. Filtreye koymanın anlamı olmazdı, çünkü seçilse yalnızca artık tazelenmeyen eski kayıtları gösterirdi.

DYOR beslemesi ve RadarDex'in Uniswap keşif sayfaları kaldırıldı. Uniswap v2/v3/v4 piyasaları artık yalnızca kendi fabrika taramamızdan geliyor; başka bir screener'ın sayfalaması yavaşladığında veya kapandığında listenin omurgası etkilenmiyor. Arama da yalnızca elimizdekini okuyor, dışarıya keşif isteği atmıyor.

Kalan dış bağlantılar: her padin kendi API'si (Tolly, Sharc, CircleWarp, Archemist, pools.trade, RadarDex kendi padi için), zincir uçları ve holder listesi için explorer. Padin kendi verisini padin kendisinden almak zaten doğru olan.

## Canlılık

Piyasa listesi turu altmış saniyeden yirmi beşe indi (`SYNC_INTERVAL_MS`), kaynak cevaplarının önbelleği de altmış saniyeden yirmiye (`FEED_TTL_MS`), yani bir tur hiçbir zaman iki tur önce çekilmiş bir cevabı servis etmez. Pratikte tazelik turun ne kadar sürdüğüne bağlıdır: boş bir veritabanında tur uzun sürer, dolu bir veritabanında kısalır.


Elimizde olan hemen verilir ve arkada kurulan taze hali kaydedilir. Kaydetme adımı eksikti: iş yapılıyor ama saklanmıyordu, bu yüzden token sayfası kaç kere kendini çekerse çeksin aynı eski anlık görüntüyü okuyordu ve işlem listesi on dakika geride kalabiliyordu. Ölçüm: art arda okumalarda anlık görüntünün yaşı 52, 26 ve 0 saniye, yani kendiliğinden tazeleniyor. Bayat bir detay, isteğin önünde değil arkasında yeniden kurulur; sayfa zaten altı saniyede bir kendini çektiği için taze hali kendiliğinden gelir. Öncesinde yeniden kurmayı beklemek, yeniden başlatmadan sonraki her açılışta mumlar veritabanında dururken boş grafik göstermek demekti. Ölçüm: veritabanı yerinde kalarak yeniden başlatıldığında ilk istek 0,05 saniyede mumlarıyla döndü.


Token sayfası kendini yeniler, sayfayı elle yenilemek gerekmez: altı saniyede bir detay çekilir (piyasa listesi on beş saniyede bir). Havuzun yeni işlemleri de daha sık okunur (`CHART_REFRESH_MS`, varsayılan 10 saniye); önceden yarım dakikaydı ve bu, biri sayfaya bakarken işlemin görünmeden beklemesi demekti. Ölçüm: açık bir token sayfası otuz saniyede altı kez güncellendi ve işlem listesi kendiliğinden doldu.

## Fiyat tutarlılığı (grafik)

Her zaman dilimi aynı fiyatla biter. Son mum kapanmışsa ve o dönemde işlem olmamışsa, şimdiki döneme ait açık mum gösterilen fiyatla çizilir; bu olmadan dakikalık grafik eski bir fiyatla, günlük grafik canlı fiyatla bitiyordu ve aynı token her zaman diliminde farklı okunuyordu. Ölçüm: ARGUS'ta 1m, 15m, 1h ve 1d kapanışı birebir aynı.

Token detayı da artık bayatsa yeniden kurulur (`DETAIL_MAX_AGE_MS`, varsayılan 12 saniye). Önceden yalnızca arka plan işçisi tazeliyordu, bu yüzden işlem listesi dakikalarca eski kalabiliyordu ve her zaman dilimi kendi anında hazırlandığı için birbirini tutmuyordu.


Devam eden mum, başlıkta gösterilen canlı fiyatla kapanır. Öncesinde grafiğin son mumu kaydedilmiş anlık görüntüden geliyordu ve her zaman diliminin görüntüsü kendi anında hazırlandığı için hem başlıkla hem birbirleriyle çelişiyordu; MC ölçeği fiyattan türediği için fark orada da görünüyordu. Yalnızca henüz kapanmamış mum düzeltilir, o da zaten gösterdiğimiz fiyata. Ölçüm: LONG ve ARGUS'ta 1h ve 1d mum kapanışı Market overview'daki market değeriyle birebir aynı.

## Token metadatası

Logo ve sosyal hesaplar öncelikle zincirden okunur. Bazı padler launch olayına bir metadata bağlantısı koyuyor; long.supply'da bu bir IPFS belgesi ve içinde ad, açıklama, görsel, web sitesi, Twitter ve Telegram var. `src/token-metadata.js` bu bağlantıyı olayın kendisinden çıkarır (olayın imzasını bilmeye gerek kalmadan, veri içindeki stringleri okuyarak), belgeyi bir IPFS geçidinden alır ve saklar. ipfs:// bağlantıları tarayıcının açabileceği hale getirilir, http bağlantıları olduğu gibi bırakılır, web bağlantısı olmayan hiçbir şey kabul edilmez.

Padin fabrikası bilinmeyen tokenlerde de bakılır: havuzun açıldığı bloktaki loglar okunur ve o tokeni adlandıran bir metadata bağlantısı varsa alınır. Zincirde metadata bulunmayan tokende alan boş kalır ve padin kendi API'sinden gelen değer kullanılır. Ölçüm: ilk turlarda bakılan 106 launch'ın 64'ünde zincirden logo ve bağlantı çıktı.

## Kendi verimiz

`src/onchain.js` listeyi başka bir screener'a sormadan kurar. Keşif fabrikalardan gelir: Uniswap v3 fabrikası (`0xf0db7b58...3918`, ayrıca aynı bytecode'a sahip `0x874dc9d6...d736a`) `PoolCreated`, v4 PoolManager (`0x8366a39c...0951`) `Initialize`, üç v2 fabrikası (`0x942bd5bf...5c10`, `0x32330c24...577a`, `0x8e79e9e7...b664`) `PairCreated` yayınlar. v2 fabrikaları canlı bir havuza hangi fabrikanın kurduğu sorularak bulundu; ikisi standart dört argümanlı imzayı, biri beş argümanlı bir varyantı kullanıyor, ikisi de kabul ediliyor. v2 çiftleri kendi fiyatlarını taşımadığı için fiyat işlemin ödediği tutardan çıkarılır. USDC çiftli havuzlar alınır, yani bir token için USDC havuzu açıldığı anda listeye girer; hangi pad çıkarmış olduğuna bakılmaz. Fiyat, hacim, işlem sayısı, alış/satış kırılımı ve 5m/1h/6h/24h değişimleri o havuzun `Swap` loglarından kendi tuttuğumuz kayıttan hesaplanır. Ad, sembol, ondalık ve arz doğrudan token kontratından okunur.

Sınırlar zincirin kendi sınırları: `eth_getLogs` istek başına 10.000 blok, toplu JSON-RPC reddediliyor, Arc günde yaklaşık 170.000 blok üretiyor. Yani bir günlük işlem 17 pencere demek. Her tur bir pencere ileri gider, `ONCHAIN_BACKFILL` kadar pencere geriye iner (varsayılan 3, tur başına ~5,6 saat). İmleçler veritabanında durur, kesilen tarama kaldığı yerden devam eder. Loglar `blockTimestamp` taşıdığı için blok başına ayrı sorgu yapılmaz.

Bir pencere "24 saatlik hacim" diyebilmek için ya kaydımızın 24 saati kapsaması ya da tokenin kaydımızdan yeni olması gerekir; ikincisinde tokenin bütün işlemleri zaten elimizdedir. Hiçbiri geçerli değilse toplamlar hiç yazılmaz, yalnızca fiyat ve son işlem zamanı verilir, çünkü bunlar kapsamdan bağımsız olarak doğrudur. Böylece yarım kalmış bir geri tarama, başka bir kaynağın doğru ölçtüğü rakamı bozmaz.

Venue etiketi yalnızca kesin bildiğimiz ikisi için yazılır, v3 ve v4. Bir v2 çifti v2 olarak kaydedilir ama hangi borsanın arayüzüne ait olduğu iddia edilmez.

Ölçemediğimiz iki şey var ve uydurulmaz. v4 likiditesi: havuzun parası tek bir PoolManager içinde durduğu için havuz başına bakiye okunamaz, v3'te havuzdaki gerçek USDC bakiyesi okunur ve olduğu gibi bildirilir. Holder sayısı: tüm Transfer loglarının indekslenmesini gerektirir, henüz yapılmıyor. Bu alanlarda padlerin verdiği değer korunur.

Kendi okumamız senkronun sonunda çalışır. Kendimiz ölçtüğümüz sayı gösterilen sayı olur; logo, sosyal hesaplar ve pad aidiyeti yukarıdaki kaynaklardan gelmeye devam eder. `/api/onchain` havuz, token, işlem sayısını, kapsam saatini ve imleçleri gösterir.

V2/V3/V4 filtreleri yalnızca kaynağın açıkça bildirdiği sürümü kullanır. Sürümü bilinmeyen tokenler ana listede kalır, sürüm filtresine dahil edilmez. Bu uygulama bütün Arc V3 havuzlarının keşfedildiğini iddia etmez.

## Ekranlar ve doğruluk

- Trending (24 saat hacim sırası), son 7 günde oluşturulan tokenler, gainers/losers, yerel watchlist, kaynak/sürüm/likidite/hacim filtreleri ve sayfalama.
- Arama yalnızca ekrandaki sayfayı değil yerel tarihsel kataloğu da tarar. Tam adres ve tam sembol eşleşmesi önceliklidir. Henüz indekslenmemiş bir token bulunamayabilir.
- Etkileşimli fiyat/hacim grafiği: 1m, 5m, 15m, 1h, 4h, 1d; gerçek son işlem kayıtları ve explorer bağlantıları.
- AGE token oluşturulma zamanıdır; keşif/senkronizasyon zamanı değildir. Kaynak vermiyorsa — kalır. Pool yaşı olarak etiketlenmez.
- Eski sürümün kaynağı doğrulanmamış fiyat/tarih kayıtları yeni feed/catalog işareti olmadan kullanılmaz. Eski veritabanı silinmez.
- Çok küçük fiyatlar anlamlı basamaklarla gösterilir. Bilinmeyen fiyat, holder ve likidite sıfır yapılmaz.
- Sharc sanal rezervleri likidite sayılmaz; toplam işlem sayısı 24 saatlik işlem sayısı yerine konmaz.
- Tutarsız OHLC varsa kapanış fiyatlarıyla çizgi grafik ve görünür uyarı sunulur; hayali mum üretilmez.
- İstatistikler yalnızca bağlı kaynak kapsamıdır, tüm Arc toplamı değildir. Rakamlar kaynak API'lerinin bildirimidir; bağımsız on-chain denetim garantisi değildir.

## OG etiketi

Bir ticker altında indekslediğimiz en eski kontrat yeşil "OG" etiketiyle işaretlenir. Etiket hem tokenin kendi başlığında hem de SAME TICKER listesinde görünür. Kural katıdır: oluşturulma tarihi bilinmeyen token yarışa girmez, iki kontrat aynı saniyeyi paylaşıyorsa etiket kimseye verilmez. Etiket "zincirdeki ilk" değil "bizim bildiğimiz en eski" demektir, hiç indekslemediğimiz bir kontrat karşılaştırmaya giremez.

## Liste genişliği

Piyasa satırı normal bir dizüstü ekranına sığar, yatay kaydırma gerekmez. Sol taraftan yer kazanıldı: yıldız sütunu daraldı, token adı 170 pikselle sınırlandı ve uzun ad kesilip üç nokta ile gösteriliyor, ikon biraz küçüldü, trend çizgisi 88'den 74 piksele indi, sayı sütunları da kenar boşluğundan birkaç piksel verdi. Ölçüm: 1600 ve 1440 piksel genişlikte taşma sıfır. Bunun bir yan etkisi var, kaynak rozeti artık sembolün yanında değil altında duruyor.

## Tek liste

Arşiv diye ayrı bir sekme yok. Elimizdeki her token ana listede, Trending altında görünür; son 24 saatte işlem görmemiş bir token da orada durur, hacme göre sıralandığı için zaten aşağıda kalır. Arama da aynı şekilde her şeyi kapsar, yeni çıkmış token da uzun süredir sessiz olan da çıkar. Üstteki ACTIVE MARKETS sayacı ve MOST ACTIVE şeridi yalnızca işlem görenleri sayar, çünkü onlar "şu an ne dönüyor" sorusunu yanıtlar.

## Marka

Site adı UFO Screener. Üstte UFO, altında SCREENER yazar. Yanındaki figür SVG olarak çizilir, ayrı bir dosya veya resim yüklenmez: gövde süzülür, ışık huzmesi nefes alır, üç ışık sırayla yanar. İşletim sisteminde hareket azaltma açıksa animasyon çalışmaz.

## Fiyat tutarlılığı

Başlıktaki fiyat ve market değeri her zaman diliminde aynıdır. Eskiden bu rakam o zaman diliminin son mumundan okunuyordu; her zaman diliminin anlık görüntüsü kendi anında hazırlandığı için aynı token 1m'de bir fiyat, 1d'de başka bir fiyat gösteriyordu ve MC ölçeği de onunla birlikte kayıyordu. Artık rakam piyasa satırından gelir ve sayfa her servis edildiğinde tazelenir. Grafik kendi kaydettiği akışı göstermeye devam eder, başlık ise en güncel değeri.

## Grafik geçmişi

Grafiğin okuyacağı havuz artık kendi keşfimizden gelir. Önceden havuz adresi feed'in verdiği detaya bağlıydı; feed o tokeni tanımıyorsa veya cevap vermiyorsa zincirden geçmiş okunamıyordu. Artık önce kendi havuz kaydımıza bakılır, v4 havuzlarında okuyucunun ihtiyacı olan anahtar bilgisi de oradan verilir, feed yalnızca yedek kalır.


Zincirden geriye okuma hızlandırıldı. Üç ayrı sorun vardı. Birincisi, her log için bloğun zamanı ayrıca soruluyordu; Arc logları zaten zaman damgası taşıdığı için blok başına bir istek tamamen kalktı. İkincisi, tur başına tek pencere geriye iniliyordu; artık varsayılan on pencere (`RPC_HISTORY_WINDOWS`), art arda ve sırayla, yani imleç kesintisiz ilerliyor. Üçüncüsü, uçlardan biri kontrat okumasını ve eski log sorgusunu taşıma hatası değil RPC hatası olarak reddediyordu; yedek zincir bunu geçerli cevap sayıp orada duruyordu, artık uçlar tek tek deneniyor ve ilk gerçekten cevap veren kullanılıyor. Ayrıca havuzun token bilgileri aynı anda değil sırayla okunuyor, birlikte gönderildiğinde ilk uç JSON-RPC olmayan bir cevap veriyordu.

Ölçüm: TOLLY havuzunda tur başına 0,6 gün geriye iniliyor (öncesinde 0,06 gün), yaklaşık 13 saniyede.


Grafik bir tokenin ilk gününden başlar, ama geçmiş anında değil zamanla dolar. Sayfalı geçmiş yayınlayan kaynaklarda (Sharc, CircleWarp) sayfalar sırayla çekilir; diğerlerinde geçmiş havuzun kendi swap loglarından geriye doğru okunur. İkisi de tur tur ilerlediği için yeni açılmış bir token sayfası önce kısa bir grafikle gelir, sonra geriye uzar.

Bir eksik vardı ve kapatıldı: zincirden geriye okuma yalnızca sayfalı geçmişi olmayan kaynaklar için çalışıyordu. Sayfalı bir kaynağın API'si eski sayfaları vermeyi kestiğinde grafik orada kalıyor ve token ömrünün ortasından başlıyordu. Artık sayfalar bittiğinde veya durduğunda zincir devreye giriyor.

## Grafik ölçeği

Grafiğin üstünde Price ve MC düğmeleri var. MC'ye basınca mumlar, çizgi, eksen ve imleç okuması market değerine döner. Çarpan satırın kendi rakamlarından çıkar, market cap bölü fiyat, yani grafik ile Market overview asla çelişmez. Tokenin arzını gösteren bir rakam yoksa ölçek fiyatta kalır ve bunun sebebi yazılır. Seçim adreste taşınır (`?scale=mc`), sayfa yenilenince korunur.

## Yakılan arz

Market overview'da yakılan arz gösterilir. Zincirden okunur, besleme verisine güvenilmez: yakma adreslerinin (`0x...dead` ve sıfır adresi) bakiyeleri ve toplam arz aynı anda okunup miktar ve yüzde çıkarılır. ARGUS'ta 35,7 milyon ve %3,57 okundu. Okuma başarısız olursa alan bilinmiyor kalır, sıfır yazılmaz. Yakma adresinde bir tam tokenden az toz kalmışsa bu bir yakma sayılmaz ve gösterilmez, çünkü ekranda "0 · 0.00%" olarak görünür ve hiçbir şey anlatmaz.

## Cüzdan bakiyeleri

Her satır bakiyenin yanında fiyatı, günlük değişimi, dolar değerini ve cüzdandaki payını gösterir. Başlıkta toplam değer, altında ne kadarının tokende ne kadarının USDC'de olduğu yazar. Fiyatını bilmediğimiz token bakiyesiyle görünür, değeri ve payı boş kalır; sıfır ya da tahmin yazılmaz.

Kapsam kontrolü: bir cüzdan için explorer'ın verdiği listeyle, en hacimli kırk tokenin bakiyesini zincirden tek tek okuyarak karşılaştırdım, fazladan hiçbir varlık çıkmadı. Yani liste eksik değil.


USDC satırı kendi işaretiyle görünür. İşaret SVG olarak yerinde çizilir, dışarıdan resim çekilmez: bir istek daha az ve barındıran yer kapandığında kırılacak bir şey yok.

Arama kutusuna bir cüzdan adresi yazılınca sonuçlarda "Wallet" satırı çıkar ve o adresin sayfasına götürür. Sayfa cüzdanın Arc üzerinde tuttuğu USDC'yi ve tokenleri, sitenin başka yerlerde gösterdiği fiyatlarla değerlenmiş olarak listeler; en değerliden başlayarak sıralar, fiyatını bilmediğimiz token bakiyesiyle görünür ama değeri boş kalır, uydurma bir rakam yazılmaz.

Token bakiyeleri zincir explorer'ının adres indeksinden gelir, çünkü ucuza üretemeyeceğimiz tek şey bu: bir cüzdanın hangi tokenleri tuttuğunu yalnızca zincirden bulmak her tokenin bütün transferlerini taramayı gerektirirdi. USDC bakiyesi ise tek bir çağrıyla doğrudan zincirden okunur. Girilen adres zaten listemizdeki bir token ise cüzdan satırı gösterilmez, tokenin kendisi çıkar.

## Holder Maps

Token detayında HOLDER MAP sekmesi var. En büyük 100 holder baloncuk olarak çizilir, boyut paylarıyla orantılıdır. İki baloncuk arasındaki çizgi şu anlama gelir: bu iki cüzdan birbirine bu tokenden göndermiş. Başka bir iddia taşımaz. Birbirine bağlı cüzdanlar küme olarak renklendirilir ve sağdaki listede üyeleriyle birlikte, toplam paylarıyla sıralanır.

Veri tokenin kendi Transfer logundan gelir, kontratın doğduğu bloktan zincirin ucuna kadar, yine 10.000 bloklik pencerelerle. İstekler demetler halinde paralel gider (`HOLDER_MAP_CONCURRENCY`, varsayılan 16). RPC sağlayıcıları da gecikmeye göre sıralanır: aynı 10 bin bloklik sorgu bir uçta 646 ms, diğerinde 190 ms sürüyordu ve eskiden hep sıradaki ilki kullanılıyordu. Sıralama açıldıktan sonra TOLLY'nin tüm geçmişi, 694 pencere ve 16.562 transfer, tek geçişte 3,9 saniyede okundu. Kontratın doğum bloğu da her turda sekiz nokta birden yoklanarak aranır, ikili aramanın 25 ardışık isteği yerine yaklaşık 8 tur. Ölçüm: ARGUS 2,1 saniye, TOLLY 5,6 saniye, BARC 11,2 saniye (ilk çağrı sıralama ölçümünü de içerir). Canlı sunucuda hiç haritası olmayan bir token 8 saniyede tamamlandı ve en yoğun on iki token iki buçuk dakikada kendiliğinden hazır oldu.

Kullanıcı beklemesin diye haritalar önden kurulur. Arka plan işçisi 24 saatlik hacmi olan tokenleri en yoğundan başlayarak kuyruğa alır (`HOLDER_MAP_SEED`, varsayılan 80) ve tur başına bir token işler. Biri henüz hazır olmayan bir tokeni açarsa isteği kuyruğun başına geçer. Harita kuyruğu, piyasa senkronu sürerken bekler; ikisi aynı uçları kullandığı için aynı anda çalıştıklarında senkron aç kalıyordu. Sekme açıkken yüzde kaçının tarandığı yazar ve harita dolarken güncellenir; tamamlanan harita saklanır, altı saatte bir tazelenir.

Kümeleme yalnızca sade cüzdanlar üzerinden yapılır. Kodu olan adresler (havuzlar, router'lar) ve yakma adresleri haritada görünür ve payları sayılır ama kimse onların üzerinden gruplanmaz. Bu olmadan herkesin işlem yaptığı tek bir PoolManager bütün holderları anlamsız tek bir kümeye toplardı, ilk denemede tam olarak bu oldu. Düzeltince BARC'ta iki gerçek küme kaldı: iki cüzdan %4,39 ve üç cüzdan %3,64.

Panel şunu açıkça yazar: bir küme bakılmaya değer bir örüntüdür, tek sahip kanıtı değildir. Borsa da router da arkadaş da aynı izi bırakır.

## Holders

İşlem listesinin yanında holder listesi var, sekmeyle geçiliyor ve ancak açıldığında yükleniyor. Kaynak sırası şöyle: önce zincir explorer'ının kendi endeksi (`api.arc-scan.org/v1/tokens/{adres}/holders`), çünkü padden bağımsız olarak her tokeni kapsıyor. Bazı tokenlerde sürekli 500 döndüğü için ikinci sırada tokenin kendi padi geliyor (Tolly ve CircleWarp holder yayınlıyor), üçüncü sırada genel bir endeks. Üçü de vermezse liste boş kalır ve panel bunu açıkça söyler, uydurma satır üretilmez. Listede cüzdan olmayan adresler etiketlenir: indekslediğimiz v2/v3 havuzları ve v4 PoolManager "Pool", yakma adresleri "Burned" olarak işaretlenir, böylece en büyük holder sanılmazlar.

## Senkron dayanıklılığı

Zincir tarayan kayıtlar (ArgusPad Portalları, long ve o1 fabrikaları) senkronun içinde değil arka planda çalışır. Senkron yalnızca o ana kadar bulunmuş olanı okur. RPC uçlarına uzak bir kurulumda bu taramalar senkronun kendi süre sınırını aşıyordu ve üç pad de her turda düşüyordu.


Her kaynak kendi süre sınırıyla çalışır (`SOURCE_TIMEOUT_MS`, varsayılan 90 sn). Zamanında cevap vermeyen kaynak o tur başarısız sayılır ve senkron kalanıyla devam eder. Öncesinde tek bir yavaş kaynak bütün turu rehin alıyordu, üretimde senkron hiç bitmiyor ve liste boş kalıyordu.

Fabrika kaydında olup beslemede görünmeyen tokenlerin adı kontratlarından okunur. Bu okumalar eskiden tek tek yapılıyordu; long gibi yüzlerce launch'ı olan bir padde bu yüzlerce ardışık RPC çağrısı demekti ve tur dakikalarca sürüyordu. Artık tur başına sınırlı sayıda (`PAD_META_PER_PASS`, varsayılan 20) ve paralel okunur, kalanı sonraki turlarda adlandırılır. ArgusPad'in Portal indeksleri de aynı şekilde paralel okunur (`ARGUS_CONCURRENCY`).

Holder haritaları senkron sürerken durmaz, kısılır (`HOLDER_MAP_SYNC_CONCURRENCY`, `HOLDER_MAP_SYNC_PASS`). Tamamen durdurmak, senkronu nadiren boş kalan bir kurulumda hiçbir haritanın kurulmaması demekti.

Ölçüm: boş bir veritabanında ilk senkron 46 saniyede tamamlanıyor, on dört kaynağın hepsi başarılı, ve iki dakika içinde zincirden okunan üç pad de doluyor (long 181, ArgusPad 126, o1 37). Sonraki turlar sürerken en yoğun on tokenin haritası da kendiliğinden hazır hale geldi.

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
