# Sıradaki — çok işletmeli online randevu platformu

Kuaför, diyetisyen, dövme stüdyosu gibi randevuyla çalışan işletmeler için uçtan uca bir web uygulaması.
Müşteri gerçek boş saatleri görür ve üç tıkla randevu alır. İşletme sahibi çalışanlarını, çalışma saatlerini
ve izinleri yönetir, takvimini canlı izler ve işletmesiyle ilgili istatistikleri görür.

[English README](README.en.md)

![Ana sayfa](docs/screenshots/home.png)

| Randevu alma | Canlı takvim | İstatistikler |
|---|---|---|
| ![Randevu alma](docs/screenshots/booking.png) | ![Canlı takvim](docs/screenshots/calendar.png) | ![İstatistikler](docs/screenshots/stats.png) |

## Öne çıkanlar

**Çift randevu "düşük ihtimal" değil, imkânsız.** Aynı saate aynı milisaniyede tıklayan iki müşteri,
uygulama kodundaki "bu saat boş mu?" kontrolünü ikisi birden geçer. Burada ikinci kaydı veritabanının
kendisi, zaman aralığı üzerine kurulmuş bir PostgreSQL *exclusion constraint* (çakışma yasağı) ile reddeder:

```sql
CONSTRAINT appointments_staff_no_overlap
  EXCLUDE USING gist (staff_id WITH =, period WITH &&) WHERE (status <> 'cancelled')
```

Bir test aynı saate 10 eşzamanlı randevu isteği gönderir ve yalnızca birinin başarılı olduğunu doğrular
([`api/tests/booking.test.ts`](api/tests/booking.test.ts)). "Herhangi bir çalışan" seçildiğinde reddedilen
kayıt otomatik olarak sıradaki boş çalışana denenir.

**Doğru boş saat hesabı.** Çalışma blokları (öğle arası = iki blok arasındaki boşluk), izinler, mevcut
randevular ve "en erken 30 dakika sonrası" kuralı saf aralık aritmetiğiyle birleştirilir
([`api/src/lib/slots.ts`](api/src/lib/slots.ts)). Hesap işletmenin kendi saat diliminde yapılır ve yaz saati
geçiş günlerinde de doğrudur. Tamamı birim testleriyle kontrol edilir.

**Birden fazla sunucuda bile canlı takvim.** Randevu işlemi `pg_notify(...)` ile biter; PostgreSQL bu bildirimi
yalnızca işlem başarıyla kaydedilirse iletir. Her API süreci `LISTEN` ile dinler ve olayı WebSocket üzerinden
o işletmenin sahiplerine ve çalışanlarına gönderir (çalışanlar yalnızca kendi takvimlerini alır).

**Yeniden başlatmaya dayanıklı arka plan işleri.** Onay, 24 saat önce hatırlatma ve iptal e-postaları
pg-boss ile PostgreSQL'de kuyruğa alınır, hata olursa artan aralıklarla yeniden denenir. İşleyiciler tekrar
çalışmaya karşı güvenlidir (yeniden denenen hatırlatma iki kez gitmez, iptal edilmiş randevunun hatırlatması
atlanır). Demo posta kutusunda gönderilen her e-posta görülebilir.

**Güvenliğin temelleri doğru yapılmış.** argon2id ile şifre özeti; veritabanında yalnızca SHA-256 özeti tutulan
rastgele oturum anahtarları; `httpOnly` + `SameSite=Lax` çerezler; yalnızca JSON kabul eden istekler; giriş
denemelerine sınır; "bilinmeyen e-posta" ile "yanlış şifre" için aynı hata; her uç noktada rol kontrolü
(sahip / çalışan / müşteri); başkasının randevusu sorulduğunda `403` değil `404` yanıtı.

## Özellikler

- Arama, kategori, puan ve başlangıç fiyatıyla herkese açık işletme listesi
- Randevu akışı: hizmet → çalışan (veya "fark etmez") → gün → boş saat → onay
- Randevularım: iptal (randevudan 2 saat öncesine kadar), tamamlanan randevuyu 1–5 yıldızla değerlendirme
- İşletme paneli: haftalık takvim (çalışan bazında veya genel bakış), hizmetler, çalışanlar ve haftalık saat
  düzenleyici, izinler, istatistikler (ciro, iptal oranı, en yoğun saatler/günler, hizmet ve çalışan bazında),
  ayarlar
- Çalışan paneli: kendi takvimi, kendi izinleri, gelmeyen müşteriyi işaretleme
- Demo posta kutusu ve tek tıkla demo girişleri

## Kullanılan teknolojiler

| Katman | Seçim |
|---|---|
| API | Node.js 24 (TypeScript'i doğrudan çalıştırır), Fastify 5, Zod |
| Veritabanı | PostgreSQL 17, elle yazılmış SQL migration'ları, Kysely sorgu oluşturucu |
| Arka plan işleri / canlı güncelleme | pg-boss, LISTEN/NOTIFY, @fastify/websocket |
| Arayüz | React 19, Vite, React Router, TanStack Query, Recharts, Luxon |
| Testler | Gerçek PostgreSQL üzerinde Vitest (54 test), GitHub Actions |

## Kurulum

Gereken tek şey **Node.js 24+**. PostgreSQL npm paketi olarak iner ve proje klasörünün içinde çalışır
(`api/.pgdata`); ayrı kurulum, yönetici izni veya Docker gerekmez.

```bash
npm install
npm run setup   # bir kez: yerel veritabanını (rastgele şifre api/.env içine) ve demo verisini oluşturur
npm run dev     # veritabanı + API (http://localhost:3000) + arayüz (http://localhost:5173)
```

http://localhost:5173 adresini açın ve tek tıkla demo hesaplarından biriyle girin (şifre `demo12345`):

| Hesap | Rol |
|---|---|
| `musteri@demo.test` | geçmiş ve yaklaşan randevuları olan müşteri |
| `isletme@demo.test` | "Makas & Tarak" işletmesinin sahibi (3 çalışan, ~3 aylık veri) |
| `calisan@demo.test` | "Makas & Tarak"ta çalışan (berber) |

Diğer komutlar:

```bash
npm test          # API testleri (kendi geçici PostgreSQL'ini açar)
npm run typecheck # iki paket için TypeScript tip kontrolü
npm run build     # arayüzün üretim derlemesi (API web/dist klasöründen sunar)
npm run seed      # demo verisini sıfırla (geliştirme veritabanı açık olmalı: npm run db)
```

## Proje yapısı

```
api/
  migrations/001_initial.sql   şema ve veritabanı seviyesindeki tüm kurallar
  src/
    app.ts                     Fastify ayarları, hata biçimi, arayüzün sunulması
    modules/                   auth, businesses, availability, appointments, stats, notifications, realtime
    lib/                       slots (aralık hesabı), access (roller), queue, events, errors
    scripts/                   setup, geliştirme veritabanı, migrate, seed
  tests/                       entegrasyon ve birim testleri
web/src/
  pages/                       Home, Business (randevu alma), MyAppointments, Mailbox, Auth, panel/*
  hooks/useLiveAppointments.ts yeniden bağlanan WebSocket
docs/tasarim.md                tasarım notları
```

## Yayına alma

API derlenmiş React uygulamasını da sunduğu için tek bir Node.js servisi ve bir PostgreSQL veritabanı yeterlidir.
`DATABASE_URL`, `NODE_ENV=production`, `APP_URL` (ve isteğe bağlı `SMTP_URL`) değişkenlerini ayarlayın,
`npm ci && npm run build` çalıştırın, ardından `npm start` ile başlatın. Migration'lar açılışta otomatik çalışır.
Ayrıntılar için [`api/.env.example`](api/.env.example) dosyasına bakın.

## Lisans

MIT
