import { BadRequestException } from '@nestjs/common';

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" for a Date in the given IANA time zone. */
export function dayInZone(date: Date, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface DayRange {
  from: string;
  to: string;
}

/**
 * Resolves the `from`/`to` report query (inclusive days) in the workspace
 * time zone. Defaults to the last 30 days including today.
 */
export function resolveRange(from: string | undefined, to: string | undefined, timeZone: string): DayRange {
  const today = dayInZone(new Date(), timeZone);
  const end = to ?? today;
  const start = from ?? addDays(end, -29);
  if (!ISO_DAY.test(start) || !ISO_DAY.test(end)) throw new BadRequestException('from/to must be YYYY-MM-DD');
  if (start > end) throw new BadRequestException('from must be on or before to');
  if (daysBetween(start, end) > 731) throw new BadRequestException('Range cannot exceed two years');
  return { from: start, to: end };
}

/** The equally long range immediately before `range`, for period-over-period deltas. */
export function previousRange(range: DayRange): DayRange {
  const len = daysBetween(range.from, range.to);
  return { from: addDays(range.from, -len), to: addDays(range.from, -1) };
}

/**
 * UTC instants bounding a day range in a time zone, for filtering documents by
 * `createdAt`. Uses the zone offset at each boundary, which is exact except
 * on the rare DST-change midnight.
 */
export function rangeToInstants(range: DayRange, timeZone: string): { start: Date; end: Date } {
  return { start: zonedMidnight(range.from, timeZone), end: zonedMidnight(addDays(range.to, 1), timeZone) };
}

function zonedMidnight(day: string, timeZone: string): Date {
  const utcGuess = new Date(`${day}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utcGuess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offset = asIfUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offset);
}
