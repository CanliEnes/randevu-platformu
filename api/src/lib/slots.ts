// Pure time-slot arithmetic. Nothing here touches the database, so every
// edge case (breaks, time off, DST, the "too late to book" cutoff) can be unit tested.
import { DateTime } from 'luxon';

/** A half-open time interval [start, end) in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

export const MINUTE = 60_000;

/** Sorts intervals and merges the ones that overlap or touch. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged.at(-1);
    if (last && current.start <= last.end) last.end = Math.max(last.end, current.end);
    else merged.push({ ...current });
  }
  return merged;
}

/** Returns the parts of `base` that are not covered by any interval in `cuts`. */
export function subtractIntervals(base: Interval[], cuts: Interval[]): Interval[] {
  const blockers = mergeIntervals(cuts);
  const result: Interval[] = [];
  for (const interval of mergeIntervals(base)) {
    let cursor = interval.start;
    for (const cut of blockers) {
      if (cut.end <= cursor || cut.start >= interval.end) continue;
      if (cut.start > cursor) result.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= interval.end) break;
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }
  return result;
}

/**
 * Every start time inside the free intervals where an appointment of `durationMs`
 * fits completely. Starts are aligned to a `stepMs` grid (e.g. :00 :15 :30 :45).
 * All real-world UTC offsets are multiples of 15 minutes, so a grid on epoch time
 * is also a grid on local wall-clock time.
 */
export function slotStarts(free: Interval[], durationMs: number, stepMs: number): number[] {
  const starts: number[] = [];
  for (const interval of free) {
    let t = Math.ceil(interval.start / stepMs) * stepMs;
    for (; t + durationMs <= interval.end; t += stepMs) starts.push(t);
  }
  return starts;
}

export interface WorkingBlock {
  start: string; // 'HH:MM' or 'HH:MM:SS', local wall-clock time
  end: string;
}

/**
 * Converts the local working blocks of one calendar day into absolute intervals.
 * Luxon applies the business time zone, including daylight saving changes.
 */
export function blocksToIntervals(date: string, zone: string, blocks: WorkingBlock[]): Interval[] {
  return blocks.map((block) => ({
    start: DateTime.fromISO(`${date}T${block.start}`, { zone }).toMillis(),
    end: DateTime.fromISO(`${date}T${block.end}`, { zone }).toMillis(),
  }));
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a calendar date in a time zone. */
export function isoWeekday(date: string, zone: string): number {
  return DateTime.fromISO(date, { zone }).weekday;
}

/** [start of day, start of next day) for a calendar date in a time zone. */
export function dayBounds(date: string, zone: string): Interval {
  const start = DateTime.fromISO(date, { zone }).startOf('day');
  return { start: start.toMillis(), end: start.plus({ days: 1 }).toMillis() };
}
