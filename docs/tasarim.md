# Randevu Platformu — Tasarım

Tarih: 2026-10-16 · Durum: onaylandı (kullanıcı kalan kararları bana bıraktı)

## Amaç

Portföyde duracak, orta-ileri seviye bir **backend + veritabanı öğrenme projesi**. Kuaför, diyetisyen,
dövme stüdyosu gibi işletmelerin çalışanları adına online randevu verdiği, çok işletmeli bir web platformu.

Başarı ölçütü:

- Aynı çalışana, aynı anda gelen iki istekle bile **çift randevu oluşamaz** (veritabanı garanti eder, testle kanıtlanır).
- Boş saatler; çalışma saatleri, molalar, izinler ve mevcut randevular hesaba katılarak doğru üretilir.
- Üç rol (işletme sahibi, çalışan, müşteri) yalnızca kendi yetkisindeki işi yapabilir.
- Projeyi indiren biri `npm install` + `npm run dev` ile, ayrı veritabanı kurmadan çalıştırabilir.

## Kapsam (ilk sürüm)

Çekirdek: kayıt/giriş, roller, işletme-hizmet-çalışan yönetimi, çalışma saatleri (molalar = bloklar arası boşluk),
izinler, boş saat hesaplama, randevu alma/iptal/gelmedi işaretleme, haftalık takvim.

Ekstralar: e-posta onay + 24 saat önce hatırlatma (kuyrukla), panelde canlı güncelleme (WebSocket),
yorum ve puan (yalnızca gerçekleşmiş randevu için), istatistik paneli.

Kapsam dışı: gerçek ödeme, SMS, Google ile giriş, çok dilli arayüz, mobil uygulama.

## Teknoloji kararları

| Konu | Karar | Gerekçe |
|---|---|---|
| Dil | TypeScript (Node.js 24) | Kullanıcı JS biliyor; enerji backend kavramlarına gitsin |
| Sunucu | Fastify 5 | Modern, hızlı, eklenti yapısı temiz |
| Veritabanı | PostgreSQL 17 | Çakışma yasağı (exclusion constraint), aralık tipleri, saat dilimi desteği |
| Yerel veritabanı | `embedded-postgres` | Yönetici izni / Docker gerektirmeden proje içinde gerçek PostgreSQL |
| Sorgular | Kysely + elle SQL migration dosyaları | SQL öğrenilsin, tip güvenliği korunsun |
| Doğrulama | Zod | Gelen veriyi tek yerde tanımlama |
| Şifre | argon2id | Güncel öneri |
| Oturum | Rastgele token, httpOnly çerez, veritabanında SHA-256 özeti | Sunucu tarafında iptal edilebilir oturum; JWT'nin iptal sorunu yok |
| Kuyruk | pg-boss | Ayrı Redis gerektirmeden PostgreSQL içinde iş kuyruğu |
| Canlı | @fastify/websocket + PostgreSQL LISTEN/NOTIFY | Birden çok sunucu kopyasında da çalışır |
| Saat | Luxon | Saat dilimi ve yaz saati hesapları |
| Test | Vitest + gerçek test veritabanı | Kuralları gerçek PostgreSQL'de sınamak |
| Arayüz | React 19 + Vite + React Router + TanStack Query + Recharts | |

## Veri modeli

```
users ─┬─< sessions
       ├─< businesses (owner) ─┬─< services ─┐
       │                       ├─< staff ────┼─< staff_services
       │                       │      ├─< working_hours (haftanın günü + saat aralığı)
       │                       │      └─< time_off (tstzrange)
       └─< appointments >──────┘ (staff, service, customer, period tstzrange, status)
                └── reviews (randevu başına en fazla bir)
sent_emails (demo posta kutusu)
```

Önemli kısıtlar:

- `appointments`: `EXCLUDE USING gist (staff_id WITH =, period WITH &&) WHERE (status <> 'cancelled')`
  → aynı çalışanın iptal edilmemiş randevuları çakışamaz. Aynısı müşteri için de var.
- `working_hours`: özel `timerange` tipiyle aynı gün içinde çakışan çalışma blokları engellenir.
- Bileşik yabancı anahtarlar: randevudaki çalışan ve hizmet aynı işletmeye ait olmak zorunda.
- Tüm zamanlar `timestamptz`; işletmenin saat dilimi `businesses.timezone` alanında.

## Boş saat algoritması

1. İşletmenin saat diliminde seçilen günün çalışma bloklarını UTC aralıklarına çevir.
2. Bloklardan izinleri, iptal edilmemiş randevuları ve "şimdi + 30 dk" öncesini çıkar.
3. Kalan boş aralıklarda 15 dakikalık ızgaraya oturan ve hizmet süresine sığan başlangıçları üret.

Saf (veritabanına dokunmayan) bir fonksiyon olarak yazılır ve birim testleriyle sınanır.

## Randevu alma akışı

1. Gelen veriyi doğrula; hizmet ve çalışan aynı işletmede mi, çalışan bu hizmeti veriyor mu?
2. O gün için boş saatleri hesapla; istenen başlangıç listede yoksa `409`.
3. `INSERT` yap. İki istek aynı anda 2. adımı geçse bile veritabanı ikincisini `23P01` ile reddeder → `409`.
4. Çalışan seçilmediyse ("fark etmez") uygun çalışanlar sırayla denenir.
5. Başarılıysa: onay e-postası kuyruğa, hatırlatma 24 saat öncesine zamanlanır, `pg_notify` ile panele haber verilir.

## Yetkiler

| İşlem | Müşteri | Çalışan | Sahip |
|---|---|---|---|
| Randevu al / kendi randevusunu iptal (2 saat kalana kadar) | ✓ | ✓ | ✓ |
| İşletmenin randevularını gör | | yalnızca kendi | tümü |
| Randevuyu iptal et / gelmedi işaretle | | kendi randevuları | tümü |
| Kendi izinlerini yönet | | ✓ | tüm çalışanlar |
| Hizmet, çalışan, çalışma saati, işletme bilgisi | | | ✓ |
| İstatistikler | | | ✓ |
| Yorum yaz (gerçekleşmiş kendi randevusu) | ✓ | | |

## Hata biçimi

Tüm hatalar `{ "error": { "code": "SLOT_TAKEN", "message": "..." } }` biçiminde döner.

## Güvenlik notları

- Şifreler argon2id ile; oturum tokenı veritabanında yalnızca özet olarak tutulur.
- Çerez: `httpOnly`, `sameSite=lax`, üretimde `secure`. Durum değiştiren istekler yalnızca JSON kabul eder (CSRF'ye karşı).
- Giriş/kayıt uç noktalarında istek sınırlama (rate limit).
- Gizli bilgiler `.env` dosyasında; depoda yalnızca `.env.example`.
