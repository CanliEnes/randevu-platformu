import { DateTime } from 'luxon';

// Every date is shown in the *business'* time zone, not the visitor's:
// an appointment at a salon in Istanbul is at 10:00 Istanbul time for everyone.

export const money = (cents: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(cents / 100);

export const inZone = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).setLocale('tr');

export const time = (iso: string, zone: string) => inZone(iso, zone).toFormat('HH:mm');

export const longDate = (iso: string, zone: string) => inZone(iso, zone).toFormat('d MMMM cccc');

export const duration = (minutes: number) => {
  if (minutes < 60) return `${minutes} dk`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} sa ${m} dk` : `${h} saat`;
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((part) => /^\p{L}/u.test(part)) // skip '&', numbers, etc.
    .slice(0, 2)
    .map((part) => part[0]!.toLocaleUpperCase('tr'))
    .join('');

export const STATUS_LABEL: Record<string, string> = {
  upcoming: 'Yaklaşan',
  in_progress: 'Şu an',
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
  no_show: 'Gelmedi',
};

export const WEEKDAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
// Not name.slice(0, 3): Pazartesi/Pazar and Cuma/Cumartesi would collide.
export const WEEKDAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/** A stable, pleasant colour for a business, derived from its name. */
export function businessColor(seed: string) {
  const palette = ['#1f4d3f', '#7a3e2a', '#2e4a7d', '#6b4c8a', '#8a5a14', '#2f6b6b', '#94345a'];
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length]!;
}
