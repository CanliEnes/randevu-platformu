import { describe, expect, it } from 'vitest';
import { blocksToIntervals, dayBounds, isoWeekday, mergeIntervals, MINUTE, slotStarts, subtractIntervals } from '../src/lib/slots.ts';

const t = (hhmm: string) => Date.parse(`2030-01-07T${hhmm}:00Z`);
const iv = (a: string, b: string) => ({ start: t(a), end: t(b) });

describe('mergeIntervals', () => {
  it('merges overlapping and touching intervals and drops empty ones', () => {
    expect(mergeIntervals([iv('10:00', '11:00'), iv('09:00', '10:00'), iv('10:30', '12:00'), iv('13:00', '13:00')])).toEqual([
      iv('09:00', '12:00'),
    ]);
  });
});

describe('subtractIntervals', () => {
  it('cuts busy time out of working time', () => {
    const free = subtractIntervals([iv('09:00', '18:00')], [iv('12:00', '13:00'), iv('10:00', '10:30')]);
    expect(free).toEqual([iv('09:00', '10:00'), iv('10:30', '12:00'), iv('13:00', '18:00')]);
  });

  it('handles cuts that cover the start, the end or everything', () => {
    expect(subtractIntervals([iv('09:00', '12:00')], [iv('08:00', '10:00')])).toEqual([iv('10:00', '12:00')]);
    expect(subtractIntervals([iv('09:00', '12:00')], [iv('11:00', '13:00')])).toEqual([iv('09:00', '11:00')]);
    expect(subtractIntervals([iv('09:00', '12:00')], [iv('08:00', '13:00')])).toEqual([]);
  });

  it('ignores cuts outside the base interval', () => {
    expect(subtractIntervals([iv('09:00', '12:00')], [iv('06:00', '07:00'), iv('20:00', '21:00')])).toEqual([iv('09:00', '12:00')]);
  });
});

describe('slotStarts', () => {
  it('returns every 15-minute start where the whole service fits', () => {
    const starts = slotStarts([iv('09:00', '10:00')], 30 * MINUTE, 15 * MINUTE);
    expect(starts).toEqual([t('09:00'), t('09:15'), t('09:30')]); // 09:45 would end at 10:15
  });

  it('aligns free time that starts off-grid to the next grid point', () => {
    const starts = slotStarts([iv('09:10', '10:00')], 30 * MINUTE, 15 * MINUTE);
    expect(starts).toEqual([t('09:15'), t('09:30')]);
  });

  it('returns nothing when the gap is shorter than the service', () => {
    expect(slotStarts([iv('09:00', '09:20')], 30 * MINUTE, 15 * MINUTE)).toEqual([]);
  });
});

describe('time zones', () => {
  it('converts local working hours to absolute time', () => {
    const [block] = blocksToIntervals('2030-01-07', 'Europe/Istanbul', [{ start: '09:00', end: '12:00' }]);
    expect(new Date(block!.start).toISOString()).toBe('2030-01-07T06:00:00.000Z');
    expect(new Date(block!.end).toISOString()).toBe('2030-01-07T09:00:00.000Z');
  });

  it('keeps a 09:00-12:00 block three hours long on a daylight-saving change day', () => {
    // Clocks in Berlin jump from 02:00 to 03:00 on 31 March 2030.
    const [block] = blocksToIntervals('2030-03-31', 'Europe/Berlin', [{ start: '09:00', end: '12:00' }]);
    expect(new Date(block!.start).toISOString()).toBe('2030-03-31T07:00:00.000Z'); // UTC+2 after the change
    expect(block!.end - block!.start).toBe(3 * 60 * MINUTE);
    const day = dayBounds('2030-03-31', 'Europe/Berlin');
    expect(day.end - day.start).toBe(23 * 60 * MINUTE); // that day only has 23 hours
  });

  it('computes ISO weekdays', () => {
    expect(isoWeekday('2030-01-07', 'Europe/Istanbul')).toBe(1); // Monday
    expect(isoWeekday('2030-01-13', 'Europe/Istanbul')).toBe(7); // Sunday
  });
});
