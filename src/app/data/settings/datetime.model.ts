import { LocaleSettings } from './locale.model';
export type DateFormat = 'long' | 'dmy' | 'mdy' | 'ymd';
export interface DateFormatChoice {
  value: DateFormat;
  label: string;
}
export const DATE_FORMAT_CHOICES: DateFormatChoice[] = [
  { value: 'long', label: 'Texte' },
  { value: 'dmy', label: 'JJ/MM/AAAA' },
  { value: 'mdy', label: 'MM/JJ/AAAA' },
  { value: 'ymd', label: 'AAAA-MM-JJ' },
];
export interface DateTimeSettings {
  auto: boolean;
  timezone: string;
  hour12: boolean;
  dateFormat: DateFormat;
  offsetSecs: number;
  utcOffsetSecs: number;
}
export interface DateTimeSync {
  settings: DateTimeSettings;
  locale: LocaleSettings;
  serverMs: number;
}
export const DEFAULT_DATETIME_SETTINGS: DateTimeSettings = {
  auto: true,
  timezone: '',
  hour12: false,
  dateFormat: 'long',
  offsetSecs: 0,
  utcOffsetSecs: 0,
};
