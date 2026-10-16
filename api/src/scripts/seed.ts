// Fills the database with realistic demo data: 4 businesses, staff, services,
// ~60 days of past appointments (for the statistics page), upcoming ones and reviews.
// WARNING: empties every table first.
//
//   npm run seed            (development)
//   npm run seed -- --force (also allowed when NODE_ENV=production, e.g. on the demo server)
import argon2 from 'argon2';
import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { config } from '../config.ts';
import { createDatabase, waitForDatabase, type Db } from '../db/index.ts';
import { migrate } from '../db/migrate.ts';
import { isPgError, PG } from '../lib/errors.ts';

if (config.isProduction && !process.argv.includes('--force')) {
  console.error('Refusing to wipe a production database. Re-run with --force if you are sure.');
  process.exit(1);
}

const ZONE = 'Europe/Istanbul';
export const DEMO_PASSWORD = 'demo12345';

// Deterministic random numbers: the same demo data on every run.
let state = 20301;
const random = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

type Hours = { days: number[]; blocks: [string, string][] };

const BUSINESSES = [
  {
    slug: 'makas-tarak', name: 'Makas & Tarak', category: 'Kuaför',
    description: 'Moda\'nın sakin bir sokağında, kadın ve erkek saç tasarımı. Kahveniz bizden.',
    address: 'Moda Cad. No: 12, Kadıköy / İstanbul',
    owner: { email: 'isletme@demo.test', name: 'Selin Arslan', isStaff: false },
    staff: [
      { name: 'Mert Yıldız', title: 'Berber', email: 'calisan@demo.test', services: [1, 2, 3] },
      { name: 'Aylin Koç', title: 'Kıdemli Stilist', services: [0, 3, 4, 5] },
      { name: 'Burak Şen', title: 'Stilist', services: [0, 1, 3, 4] },
    ],
    services: [
      ['Kadın Saç Kesimi', 45, 600], ['Erkek Saç Kesimi', 30, 350], ['Sakal Tıraşı', 20, 200],
      ['Fön', 30, 300], ['Saç Boyama', 120, 1800], ['Keratin Bakımı', 90, 1500],
    ] as [string, number, number][],
    hours: { days: [1, 2, 3, 4, 5, 6], blocks: [['09:30', '13:00'], ['14:00', '19:30']] } as Hours,
  },
  {
    slug: 'dengeli-yasam', name: 'Dengeli Yaşam Beslenme', category: 'Diyetisyen',
    description: 'Kişiye özel beslenme programları, vücut analizi ve online takip.',
    address: 'Teşvikiye Mah. Abdi İpekçi Cad. No: 40, Şişli / İstanbul',
    owner: { email: 'elif@demo.test', name: 'Elif Kaya', isStaff: true, title: 'Diyetisyen', services: [0, 1, 2] },
    staff: [{ name: 'Can Öztürk', title: 'Diyetisyen', services: [0, 1, 2] }],
    services: [['İlk Görüşme ve Vücut Analizi', 60, 1500], ['Kontrol Görüşmesi', 30, 750], ['Online Görüşme', 45, 900]] as [string, number, number][],
    hours: { days: [1, 2, 3, 4, 5], blocks: [['09:00', '12:30'], ['13:30', '18:00']] } as Hours,
  },
  {
    slug: 'murekkep-atolyesi', name: 'Mürekkep Atölyesi', category: 'Dövme Stüdyosu',
    description: 'Minimal ve ince çizgi dövmeler, steril ortam, ücretsiz ön görüşme.',
    address: 'Cihangir Mah. Akarsu Yokuşu No: 7, Beyoğlu / İstanbul',
    owner: { email: 'kaan@demo.test', name: 'Kaan Demir', isStaff: true, title: 'Dövme Sanatçısı', services: [0, 1, 2] },
    staff: [{ name: 'Selin Avcı', title: 'Piercing Uzmanı', services: [0, 3] }],
    services: [['Ön Görüşme', 30, 0], ['Minimal Dövme', 60, 2500], ['Orta Boy Dövme', 180, 6000], ['Piercing', 30, 900]] as [string, number, number][],
    hours: { days: [2, 3, 4, 5, 6], blocks: [['12:00', '20:00']] } as Hours,
  },
  {
    slug: 'patili-bakim', name: 'Patili Bakım', category: 'Pet Kuaförü',
    description: 'Kedi ve köpekler için stressiz yıkama, tıraş ve tırnak bakımı.',
    address: 'Bağdat Cad. No: 210, Maltepe / İstanbul',
    owner: { email: 'ece@demo.test', name: 'Ece Tan', isStaff: true, title: 'Pet Kuaförü', services: [0, 1, 2] },
    staff: [],
    services: [['Köpek Yıkama ve Tarama', 60, 700], ['Kedi Tıraşı', 90, 1100], ['Tırnak Kesimi', 15, 200]] as [string, number, number][],
    hours: { days: [1, 2, 3, 4, 5, 6], blocks: [['10:00', '13:00'], ['14:00', '18:00']] } as Hours,
  },
];

const FIRST = ['Deniz', 'Ayşe', 'Mehmet', 'Zeynep', 'Emre', 'Elif', 'Can', 'Ece', 'Burak', 'Selin', 'Oğuz', 'Merve', 'Kerem', 'İrem',
  'Barış', 'Gizem', 'Tolga', 'Defne', 'Onur', 'Pınar', 'Arda', 'Cansu', 'Umut', 'Nazlı', 'Serkan', 'Büşra', 'Kaan', 'Melis', 'Efe', 'Seda'];
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Öztürk', 'Aydın', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Koç', 'Kurt'];
const COMMENTS: Record<number, string[]> = {
  5: ['Harika bir deneyimdi, kesinlikle tekrar geleceğim.', 'Çok ilgililer, tam istediğim gibi oldu.', 'Randevu saatine tam uydular, teşekkürler!', 'Ortam çok temiz ve rahat.', ''],
  4: ['Gayet memnun kaldım, sadece biraz bekledim.', 'İşçilik güzel, fiyatlar biraz yüksek.', 'İyiydi, tavsiye ederim.', ''],
  3: ['Fena değildi ama beklediğim kadar iyi de değildi.', 'Ortalama bir deneyim.'],
  2: ['Randevuma 20 dakika geç alındım.'],
  1: ['Hiç memnun kalmadım.'],
};

async function seed(db: Db) {
  await sql`TRUNCATE users, sessions, businesses, staff, services, staff_services, working_hours,
            time_off, appointments, reviews, sent_emails RESTART IDENTITY CASCADE`.execute(db);

  const passwordHash = await argon2.hash(DEMO_PASSWORD); // the same hash for every demo account (fast seeding)
  const createUser = async (email: string, fullName: string) =>
    (await db.insertInto('users').values({ email, full_name: fullName, password_hash: passwordHash }).returning('id').executeTakeFirstOrThrow()).id;

  const demoCustomerId = await createUser('musteri@demo.test', 'Deniz Aydın');
  const customerIds: number[] = [];
  for (let i = 1; i <= 45; i++) customerIds.push(await createUser(`musteri${i}@demo.test`, `${pick(FIRST)} ${pick(LAST)}`));

  const today = DateTime.now().setZone(ZONE).startOf('day');
  const now = DateTime.now();
  let appointmentCount = 0;
  let reviewCount = 0;

  for (const spec of BUSINESSES) {
    const ownerId = await createUser(spec.owner.email, spec.owner.name);
    const business = await db
      .insertInto('businesses')
      .values({ owner_id: ownerId, name: spec.name, slug: spec.slug, category: spec.category, description: spec.description, address: spec.address, timezone: ZONE })
      .returning('id')
      .executeTakeFirstOrThrow();

    const serviceRows: { id: number; duration_minutes: number; price_cents: number }[] = [];
    for (const [name, duration, price] of spec.services) {
      serviceRows.push(
        await db.insertInto('services')
          .values({ business_id: business.id, name, duration_minutes: duration, price_cents: price * 100 })
          .returning(['id', 'duration_minutes', 'price_cents']).executeTakeFirstOrThrow(),
      );
    }

    const staffSpecs = [
      ...(spec.owner.isStaff ? [{ name: spec.owner.name, title: spec.owner.title ?? '', userId: ownerId, services: spec.owner.services ?? [] }] : []),
      ...await Promise.all(spec.staff.map(async (s) => ({
        name: s.name, title: s.title, services: s.services,
        userId: 'email' in s && s.email ? await createUser(s.email, s.name) : null,
      }))),
    ];

    for (const s of staffSpecs) {
      const staff = await db.insertInto('staff')
        .values({ business_id: business.id, user_id: s.userId, display_name: s.name, title: s.title })
        .returning('id').executeTakeFirstOrThrow();
      const offered = s.services.map((i) => serviceRows[i]!);
      await db.insertInto('staff_services').values(offered.map((sv) => ({ staff_id: staff.id, service_id: sv.id }))).execute();
      await db.insertInto('working_hours')
        .values(spec.hours.days.flatMap((weekday) => spec.hours.blocks.map(([start, end]) => ({ staff_id: staff.id, weekday, start_time: start, end_time: end }))))
        .execute();

      // One day off next week for the first staff member, so the demo shows time off.
      if (s === staffSpecs[0]) {
        const off = today.plus({ days: 9 });
        await db.insertInto('time_off').values({
          staff_id: staff.id, reason: 'Yıllık izin',
          period: sql`tstzrange(${off.toJSDate()}::timestamptz, ${off.plus({ days: 1 }).toJSDate()}::timestamptz, '[)')`,
        }).execute();
      }

      // Walk through every working block from 60 days ago to 14 days ahead.
      for (let d = -60; d <= 14; d++) {
        const day = today.plus({ days: d });
        if (!spec.hours.days.includes(day.weekday)) continue;
        if (d >= 9 && d < 10 && s === staffSpecs[0]) continue; // time off
        const isFuture = d > 0;
        for (const [blockStart, blockEnd] of spec.hours.blocks) {
          let cursor = DateTime.fromISO(`${day.toISODate()}T${blockStart}`, { zone: ZONE });
          const end = DateTime.fromISO(`${day.toISODate()}T${blockEnd}`, { zone: ZONE });
          while (cursor < end) {
            const service = pick(offered);
            const finish = cursor.plus({ minutes: service.duration_minutes });
            const busy = random() < (isFuture ? 0.3 + 0.25 / d : 0.62);
            if (finish > end || !busy) {
              cursor = cursor.plus({ minutes: 15 * (1 + Math.floor(random() * 3)) });
              continue;
            }
            const isPast = finish <= now;
            const roll = random();
            const status = isPast ? (roll < 0.09 ? 'cancelled' : roll < 0.15 ? 'no_show' : 'booked') : roll < 0.06 ? 'cancelled' : 'booked';
            const customerId = pick(customerIds);
            try {
              const created = await db.insertInto('appointments').values({
                business_id: business.id, staff_id: staff.id, service_id: service.id, customer_id: customerId,
                period: sql`tstzrange(${cursor.toJSDate()}::timestamptz, ${finish.toJSDate()}::timestamptz, '[)')`,
                price_cents: service.price_cents, status,
                cancelled_at: status === 'cancelled' ? cursor.minus({ days: 1 }).toJSDate() : null,
                cancelled_by: status === 'cancelled' ? customerId : null,
                created_at: cursor.minus({ days: 2 + Math.floor(random() * 10) }).toJSDate(),
              }).returning('id').executeTakeFirstOrThrow();
              appointmentCount++;
              if (isPast && status === 'booked' && random() < 0.35) {
                const r = random();
                const rating = r < 0.55 ? 5 : r < 0.85 ? 4 : r < 0.94 ? 3 : r < 0.98 ? 2 : 1;
                await db.insertInto('reviews').values({
                  appointment_id: created.id, business_id: business.id, customer_id: customerId, rating,
                  comment: pick(COMMENTS[rating]!), created_at: finish.plus({ hours: 3 }).toJSDate(),
                }).execute();
                reviewCount++;
              }
            } catch (error) {
              // The random customer already had an appointment at that time: just skip it.
              if (!isPgError(error, PG.EXCLUSION_VIOLATION)) throw error;
            }
            cursor = finish;
          }
        }
      }
    }
  }

  // The demo customer gets a small personal history: one reviewed, one reviewable, one upcoming.
  await addDemoCustomerHistory(db, demoCustomerId, today);
  return { appointmentCount, reviewCount };
}

async function addDemoCustomerHistory(db: Db, customerId: number, today: DateTime) {
  const service = await db.selectFrom('services').innerJoin('businesses', 'businesses.id', 'services.business_id')
    .select(['services.id', 'services.business_id', 'services.price_cents', 'services.duration_minutes'])
    .where('businesses.slug', '=', 'makas-tarak').where('services.name', '=', 'Erkek Saç Kesimi').executeTakeFirstOrThrow();
  const staff = await db.selectFrom('staff').innerJoin('staff_services', 'staff_services.staff_id', 'staff.id')
    .select('staff.id').where('staff_services.service_id', '=', service.id).orderBy('staff.id').executeTakeFirstOrThrow();

  const book = async (start: DateTime) => {
    // Make room in case the random generator already used this time.
    const end = start.plus({ minutes: service.duration_minutes });
    const range = sql<string>`tstzrange(${start.toJSDate()}::timestamptz, ${end.toJSDate()}::timestamptz, '[)')`;
    await db.deleteFrom('appointments').where('staff_id', '=', staff.id).where(sql<boolean>`period && ${range}`).execute();
    return (await db.insertInto('appointments').values({
      business_id: service.business_id, staff_id: staff.id, service_id: service.id, customer_id: customerId,
      period: range, price_cents: service.price_cents,
    }).returning('id').executeTakeFirstOrThrow()).id;
  };
  const nextWorkday = (from: DateTime) => {
    let d = from;
    while (d.weekday === 7) d = d.plus({ days: 1 });
    return d;
  };

  const firstStart = nextWorkday(today.minus({ days: 20 })).set({ hour: 11 });
  const first = await book(firstStart);
  await db.insertInto('reviews').values({
    appointment_id: first, business_id: service.business_id, customer_id: customerId, rating: 5,
    comment: 'Mert Bey çok özenli, teşekkürler!', created_at: firstStart.plus({ hours: 4 }).toJSDate(),
  }).execute();
  await book(nextWorkday(today.minus({ days: 6 })).set({ hour: 16 }));
  await book(nextWorkday(today.plus({ days: 3 })).set({ hour: 17 }));
}

const { db, pool } = createDatabase(config.databaseUrl);
await waitForDatabase(pool);
await migrate(pool);
const result = await seed(db);
console.log(`Seeded ${BUSINESSES.length} businesses, ${result.appointmentCount} appointments, ${result.reviewCount} reviews.`);
console.log(`Demo accounts (password: ${DEMO_PASSWORD}): isletme@demo.test (owner), calisan@demo.test (staff), musteri@demo.test (customer)`);
await db.destroy();
