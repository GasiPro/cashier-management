export type Period = 'jour' | 'semaine' | 'mois' | 'annee';

export interface PeriodBounds {
  start: string;
  end: string;
}

/** Days after Monday on which a week ends: 6 = Monday to Sunday, 5 = Monday to Saturday. */
export const DEFAULT_WEEK_END_OFFSET_DAYS = 6;

export function formatIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function startOfIsoWeek(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

export function toIsoWeekValue(d: Date): string {
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNumber = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstThursdayDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstThursdayDay + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function mondayOfIsoWeek(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day);
  const target = new Date(week1Monday);
  target.setDate(week1Monday.getDate() + (week - 1) * 7);
  return target;
}

export function periodBounds(
  anchorIso: string,
  period: Period,
  weekEndOffsetDays: number = DEFAULT_WEEK_END_OFFSET_DAYS,
): PeriodBounds {
  const anchor = parseIsoDate(anchorIso);
  switch (period) {
    case 'semaine': {
      const start = startOfIsoWeek(anchor);
      const end = new Date(start);
      end.setDate(end.getDate() + weekEndOffsetDays);
      return { start: formatIsoDate(start), end: formatIsoDate(end) };
    }
    case 'mois': {
      const year = anchor.getFullYear();
      const month = anchor.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();
      return {
        start: `${year}-${String(month + 1).padStart(2, '0')}-01`,
        end: `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      };
    }
    case 'annee': {
      const year = anchor.getFullYear();
      return { start: `${year}-01-01`, end: `${year}-12-31` };
    }
    default:
      return { start: anchorIso, end: anchorIso };
  }
}

export function previousPeriodBounds(
  anchorIso: string,
  period: Period,
  weekEndOffsetDays: number = DEFAULT_WEEK_END_OFFSET_DAYS,
): PeriodBounds {
  const anchor = parseIsoDate(anchorIso);
  switch (period) {
    case 'semaine': {
      const prevAnchor = new Date(anchor);
      prevAnchor.setDate(prevAnchor.getDate() - 7);
      return periodBounds(formatIsoDate(prevAnchor), period, weekEndOffsetDays);
    }
    case 'mois': {
      const prevAnchor = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
      return periodBounds(formatIsoDate(prevAnchor), period, weekEndOffsetDays);
    }
    case 'annee': {
      const prevAnchor = new Date(anchor.getFullYear() - 1, 0, 1);
      return periodBounds(formatIsoDate(prevAnchor), period, weekEndOffsetDays);
    }
    default: {
      const d = new Date(anchor);
      d.setDate(d.getDate() - 1);
      const iso = formatIsoDate(d);
      return { start: iso, end: iso };
    }
  }
}

export function isWithinPeriod(iso: string, bounds: PeriodBounds): boolean {
  const day = formatIsoDate(new Date(iso));
  return day >= bounds.start && day <= bounds.end;
}

/** Anchor date for "this period" (today). */
export function currentPeriodAnchor(): string {
  return formatIsoDate(new Date());
}

/** Anchor date for "the previous period" (start of the period before today's). */
export function previousPeriodAnchor(
  period: Period,
  weekEndOffsetDays: number = DEFAULT_WEEK_END_OFFSET_DAYS,
): string {
  return previousPeriodBounds(formatIsoDate(new Date()), period, weekEndOffsetDays).start;
}

export function isCurrentPeriod(
  selectedDate: string,
  period: Period,
  weekEndOffsetDays: number = DEFAULT_WEEK_END_OFFSET_DAYS,
): boolean {
  const todayIso = formatIsoDate(new Date());
  const bounds = periodBounds(selectedDate, period, weekEndOffsetDays);
  return todayIso >= bounds.start && todayIso <= bounds.end;
}

export function isPreviousPeriod(
  selectedDate: string,
  period: Period,
  weekEndOffsetDays: number = DEFAULT_WEEK_END_OFFSET_DAYS,
): boolean {
  const todayIso = formatIsoDate(new Date());
  const previous = previousPeriodBounds(todayIso, period, weekEndOffsetDays);
  return selectedDate >= previous.start && selectedDate <= previous.end;
}

export function isCustomPeriod(
  selectedDate: string,
  period: Period,
  weekEndOffsetDays: number = DEFAULT_WEEK_END_OFFSET_DAYS,
): boolean {
  return (
    !isCurrentPeriod(selectedDate, period, weekEndOffsetDays) &&
    !isPreviousPeriod(selectedDate, period, weekEndOffsetDays)
  );
}

export function currentPeriodLabel(period: Period): string {
  switch (period) {
    case 'semaine':
      return 'Cette semaine';
    case 'mois':
      return 'Ce mois-ci';
    case 'annee':
      return 'Cette année';
    default:
      return "Aujourd'hui";
  }
}

export function previousPeriodLabel(period: Period): string {
  switch (period) {
    case 'semaine':
      return 'Semaine dernière';
    case 'mois':
      return 'Mois dernier';
    case 'annee':
      return 'Année dernière';
    default:
      return 'Hier';
  }
}

export function comparisonLabel(period: Period): string {
  switch (period) {
    case 'semaine':
      return 'Semaine précédente';
    case 'mois':
      return 'Mois précédent';
    case 'annee':
      return 'Année précédente';
    default:
      return 'Veille';
  }
}

export function reportTitle(period: Period): string {
  switch (period) {
    case 'semaine':
      return 'Rapport de la semaine';
    case 'mois':
      return 'Rapport du mois';
    case 'annee':
      return "Rapport de l'année";
    default:
      return 'Rapport du jour';
  }
}

export function weekInputValue(bounds: PeriodBounds): string {
  return toIsoWeekValue(parseIsoDate(bounds.start));
}

/** Converts a `YYYY-Www` input value to the anchor date (Monday), or null if malformed. */
export function weekValueToAnchor(value: string): string | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const monday = mondayOfIsoWeek(year, week);
  return formatIsoDate(monday);
}

export function monthInputValue(anchorIso: string): string {
  const anchor = parseIsoDate(anchorIso);
  return `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;
}

/** Converts a `YYYY-MM` input value to the anchor date (first of the month), or null if invalid. */
export function monthValueToAnchor(value: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function yearInputValue(anchorIso: string): number {
  return parseIsoDate(anchorIso).getFullYear();
}

/** Converts a year input value to the anchor date (January 1st), or null if out of range. */
export function yearValueToAnchor(value: string): string | null {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return `${year}-01-01`;
}

export function rangeLabel(bounds: PeriodBounds): string {
  const startLabel = parseIsoDate(bounds.start).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
  });
  const endLabel = parseIsoDate(bounds.end).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return bounds.start === bounds.end ? endLabel : `${startLabel} au ${endLabel}`;
}

/**
 * `ordersBounds` is the span actually covered by the period's paid orders
 * (see `ordersDateBounds`), falling back to the period bounds when there are none.
 */
export function reportDateLabel(period: Period, anchorIso: string, ordersBounds: PeriodBounds): string {
  const anchor = parseIsoDate(anchorIso);
  switch (period) {
    case 'semaine':
      return `Semaine du ${rangeLabel(ordersBounds)}`;
    case 'mois':
    case 'annee':
      return rangeLabel(ordersBounds);
    default:
      return anchor.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
  }
}

export function reportDefaultFileName(period: Period, anchorIso: string, bounds: PeriodBounds): string {
  switch (period) {
    case 'semaine':
      return `rapport_semaine_${bounds.start}_au_${bounds.end}.xlsx`;
    case 'mois':
      return `rapport_mois_${monthInputValue(anchorIso)}.xlsx`;
    case 'annee':
      return `rapport_annee_${yearInputValue(anchorIso)}.xlsx`;
    default:
      return `rapport_du_jour_${anchorIso}.xlsx`;
  }
}
