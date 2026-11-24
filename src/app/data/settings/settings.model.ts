import { APP_NAME } from '../../core/config/app.constants';
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;
export const FONT_SIZE_STEP = 1;
export type AppMode = 'caisse' | 'comptoir';
export const DEFAULT_ORGANIZATION_NAME = APP_NAME;
export interface Organization {
  name: string;
  email: string;
  phone: string;
}
export interface PhoneRegion {
  name: string;
  prefix: string;
  codes: string[];
  zones: string[];
}
export const PHONE_REGIONS: PhoneRegion[] = [
  { name: 'Afrique du Sud', prefix: '+27', codes: ['ZA'], zones: ['Africa/Johannesburg'] },
  { name: 'Algérie', prefix: '+213', codes: ['DZ'], zones: ['Africa/Algiers'] },
  { name: 'Allemagne', prefix: '+49', codes: ['DE'], zones: ['Europe/Berlin'] },
  { name: 'Arabie saoudite', prefix: '+966', codes: ['SA'], zones: ['Asia/Riyadh'] },
  { name: 'Argentine', prefix: '+54', codes: ['AR'], zones: ['America/Argentina/Buenos_Aires'] },
  { name: 'Australie', prefix: '+61', codes: ['AU'], zones: [] },
  { name: 'Autriche', prefix: '+43', codes: ['AT'], zones: ['Europe/Vienna'] },
  { name: 'Belgique', prefix: '+32', codes: ['BE'], zones: ['Europe/Brussels'] },
  { name: 'Brésil', prefix: '+55', codes: ['BR'], zones: [] },
  { name: 'Canada / États-Unis', prefix: '+1', codes: ['CA', 'US'], zones: [] },
  { name: 'Chili', prefix: '+56', codes: ['CL'], zones: ['America/Santiago'] },
  { name: 'Chine', prefix: '+86', codes: ['CN'], zones: ['Asia/Shanghai'] },
  { name: 'Colombie', prefix: '+57', codes: ['CO'], zones: ['America/Bogota'] },
  { name: 'Comores', prefix: '+269', codes: ['KM'], zones: ['Indian/Comoro'] },
  { name: 'Corée du Sud', prefix: '+82', codes: ['KR'], zones: ['Asia/Seoul'] },
  { name: "Côte d'Ivoire", prefix: '+225', codes: ['CI'], zones: ['Africa/Abidjan'] },
  { name: 'Danemark', prefix: '+45', codes: ['DK'], zones: ['Europe/Copenhagen'] },
  { name: 'Égypte', prefix: '+20', codes: ['EG'], zones: ['Africa/Cairo'] },
  { name: 'Émirats arabes unis', prefix: '+971', codes: ['AE'], zones: ['Asia/Dubai'] },
  { name: 'Espagne', prefix: '+34', codes: ['ES'], zones: ['Europe/Madrid'] },
  { name: 'Éthiopie', prefix: '+251', codes: ['ET'], zones: ['Africa/Addis_Ababa'] },
  { name: 'Finlande', prefix: '+358', codes: ['FI'], zones: ['Europe/Helsinki'] },
  { name: 'France', prefix: '+33', codes: ['FR'], zones: ['Europe/Paris'] },
  { name: 'Ghana', prefix: '+233', codes: ['GH'], zones: ['Africa/Accra'] },
  { name: 'Grèce', prefix: '+30', codes: ['GR'], zones: ['Europe/Athens'] },
  { name: 'Hong Kong', prefix: '+852', codes: ['HK'], zones: ['Asia/Hong_Kong'] },
  { name: 'Inde', prefix: '+91', codes: ['IN'], zones: ['Asia/Kolkata'] },
  { name: 'Indonésie', prefix: '+62', codes: ['ID'], zones: [] },
  { name: 'Irlande', prefix: '+353', codes: ['IE'], zones: ['Europe/Dublin'] },
  { name: 'Israël', prefix: '+972', codes: ['IL'], zones: ['Asia/Jerusalem'] },
  { name: 'Italie', prefix: '+39', codes: ['IT'], zones: ['Europe/Rome'] },
  { name: 'Japon', prefix: '+81', codes: ['JP'], zones: ['Asia/Tokyo'] },
  { name: 'Kenya', prefix: '+254', codes: ['KE'], zones: ['Africa/Nairobi'] },
  { name: 'Madagascar', prefix: '+261', codes: ['MG'], zones: ['Indian/Antananarivo'] },
  { name: 'Malaisie', prefix: '+60', codes: ['MY'], zones: [] },
  { name: 'Maroc', prefix: '+212', codes: ['MA'], zones: ['Africa/Casablanca'] },
  { name: 'Maurice', prefix: '+230', codes: ['MU'], zones: ['Indian/Mauritius'] },
  { name: 'Mexique', prefix: '+52', codes: ['MX'], zones: [] },
  { name: 'Mozambique', prefix: '+258', codes: ['MZ'], zones: ['Africa/Maputo'] },
  { name: 'Nigéria', prefix: '+234', codes: ['NG'], zones: ['Africa/Lagos'] },
  { name: 'Norvège', prefix: '+47', codes: ['NO'], zones: ['Europe/Oslo'] },
  { name: 'Nouvelle-Zélande', prefix: '+64', codes: ['NZ'], zones: ['Pacific/Auckland'] },
  { name: 'Pakistan', prefix: '+92', codes: ['PK'], zones: ['Asia/Karachi'] },
  { name: 'Pays-Bas', prefix: '+31', codes: ['NL'], zones: ['Europe/Amsterdam'] },
  { name: 'Philippines', prefix: '+63', codes: ['PH'], zones: ['Asia/Manila'] },
  { name: 'Pologne', prefix: '+48', codes: ['PL'], zones: ['Europe/Warsaw'] },
  { name: 'Portugal', prefix: '+351', codes: ['PT'], zones: [] },
  { name: 'Réunion / Mayotte', prefix: '+262', codes: ['RE', 'YT'], zones: ['Indian/Reunion', 'Indian/Mayotte'] },
  { name: 'Royaume-Uni', prefix: '+44', codes: ['GB'], zones: ['Europe/London'] },
  { name: 'Russie / Kazakhstan', prefix: '+7', codes: ['RU', 'KZ'], zones: [] },
  { name: 'Rwanda', prefix: '+250', codes: ['RW'], zones: ['Africa/Kigali'] },
  { name: 'Sénégal', prefix: '+221', codes: ['SN'], zones: ['Africa/Dakar'] },
  { name: 'Seychelles', prefix: '+248', codes: ['SC'], zones: ['Indian/Mahe'] },
  { name: 'Singapour', prefix: '+65', codes: ['SG'], zones: ['Asia/Singapore'] },
  { name: 'Suède', prefix: '+46', codes: ['SE'], zones: ['Europe/Stockholm'] },
  { name: 'Suisse', prefix: '+41', codes: ['CH'], zones: ['Europe/Zurich'] },
  { name: 'Tanzanie', prefix: '+255', codes: ['TZ'], zones: ['Africa/Dar_es_Salaam'] },
  { name: 'Thaïlande', prefix: '+66', codes: ['TH'], zones: ['Asia/Bangkok'] },
  { name: 'Tunisie', prefix: '+216', codes: ['TN'], zones: ['Africa/Tunis'] },
  { name: 'Turquie', prefix: '+90', codes: ['TR'], zones: ['Europe/Istanbul'] },
  { name: 'Vietnam', prefix: '+84', codes: ['VN'], zones: ['Asia/Ho_Chi_Minh'] },
  { name: 'Zambie', prefix: '+260', codes: ['ZM'], zones: ['Africa/Lusaka'] },
];
export type ThemeOption = 'clair' | 'sombre' | 'systeme';
export interface ThemeChoice {
  value: ThemeOption;
  label: string;
}
export const THEME_CHOICES: ThemeChoice[] = [
  { value: 'clair', label: 'Clair' },
  { value: 'sombre', label: 'Sombre' },
  { value: 'systeme', label: 'Système' },
];
export const BACKGROUND_PRESETS: Record<'light' | 'dark', string[]> = {
  light: ['#EBE8E1', '#F3EFE6', '#E4EAEF', '#E8EEE6', '#FFFFFF'],
  dark: ['#0F172A', '#0B1220', '#0F1F2E', '#10252B', '#1A1B2E'],
};
export interface DisplaySettings {
  theme: ThemeOption;
  backgroundColor: string;
  fontSize: number;
}
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  theme: 'clair',
  backgroundColor: BACKGROUND_PRESETS.light[0],
  fontSize: 14,
};