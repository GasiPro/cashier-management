import { getDateTime } from '../../data/settings/settings.api';
import {
  DEFAULT_DATETIME_SETTINGS,
  DateTimeSettings,
  DateTimeSync,
} from '../../data/settings/datetime.model';
type DateParts = Record<string, string>;
let current: DateTimeSettings = DEFAULT_DATETIME_SETTINGS;
let skewMs = 0;
let synced = false;
type DateInput = Date | string | number;
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
export function timeZoneList(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = new Set(intl.supportedValuesOf?.('timeZone') ?? []);
  zones.add('UTC');
  zones.add(systemTimeZone());
  return [...zones].sort();
}
function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone });
    return true;
  } catch {
    return false;
  }
}
function activeTimeZone(settings: DateTimeSettings): string | undefined {
  return !settings.auto && settings.timezone ? settings.timezone : undefined;
}
function partsOf(ts: number, timeZone?: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ts));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}
function zoneOffsetMs(ts: number, timeZone: string): number {
  const p = partsOf(ts, timeZone);
  const wall = Date.UTC(+p['year'], +p['month'] - 1, +p['day'], +p['hour'], +p['minute'], +p['second']);
  return wall - Math.floor(ts / 1000) * 1000;
}
export function zoneOffsetSecs(ts: number, timeZone: string): number {
  return Math.round(zoneOffsetMs(ts, timeZone) / 1000);
}
export function wallClock(ts: number, timeZone?: string): { date: string; time: string } {
  const p = partsOf(ts, timeZone);
  return {
    date: `${p['year']}-${p['month']}-${p['day']}`,
    time: `${p['hour']}:${p['minute']}:${p['second']}`,
  };
}
export function zonedToInstant(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi, s] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  const first = wall - zoneOffsetMs(wall, timeZone);
  return wall - zoneOffsetMs(first, timeZone);
}
export function applyDateTimeSettings(settings: DateTimeSettings): void {
  current = isValidTimeZone(settings.timezone || systemTimeZone())
    ? settings
    : { ...settings, timezone: '' };
}
export function applyDateTimeSync(sync: DateTimeSync): void {
  synced = true;
  skewMs = sync.serverMs - Date.now();
  applyDateTimeSettings(sync.settings);
}
export async function initDateTimeSettings(): Promise<void> {
  try {
    const settings = await getDateTime();
    if (!synced) applyDateTimeSettings(settings);
  } catch (e) {
    console.error('failed to load date and time settings', e);
  }
}
export function clockNow(): Date {
  return new Date(Date.now() + skewMs + (current.auto ? 0 : current.offsetSecs * 1000));
}
function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}
function clockOptions(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  return {
    ...options,
    ...(options.hour ? { hour12: current.hour12 } : {}),
    timeZone: activeTimeZone(current),
  };
}
export function localeTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
): string {
  return toDate(value).toLocaleTimeString('fr-FR', clockOptions(options));
}
export function localeDate(value: DateInput, options: Intl.DateTimeFormatOptions = {}): string {
  return toDate(value).toLocaleDateString('fr-FR', clockOptions(options));
}
export function localeDateTime(value: DateInput, options: Intl.DateTimeFormatOptions = {}): string {
  return toDate(value).toLocaleString('fr-FR', clockOptions(options));
}
export function currentDayIso(): string {
  return wallClock(clockNow().getTime(), activeTimeZone(current)).date;
}
export function dayOfIso(value: DateInput): string {
  const ts = toDate(value).getTime();
  return Number.isNaN(ts) ? '' : wallClock(ts, activeTimeZone(current)).date;
}
export function startOfTodayMs(): number {
  return zonedToInstant(currentDayIso(), '00:00:00', activeTimeZone(current) ?? systemTimeZone());
}
export function msUntilNextDay(): number {
  const now = clockNow();
  const [h, m, s] = wallClock(now.getTime(), activeTimeZone(current)).time.split(':').map(Number);
  return 86_400_000 - ((h * 3600 + m * 60 + s) * 1000 + now.getMilliseconds());
}
export function formatClockTime(date: Date): string {
  return localeTime(date, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function formatClockDate(date: Date): string {
  const timeZone = activeTimeZone(current);
  if (current.dateFormat === 'long') {
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone,
    });
  }
  const p = partsOf(date.getTime(), timeZone);
  const [d, m, y] = [p['day'], p['month'], p['year']];
  if (current.dateFormat === 'mdy') return `${m}/${d}/${y}`;
  if (current.dateFormat === 'ymd') return `${y}-${m}-${d}`;
  return `${d}/${m}/${y}`;
}
