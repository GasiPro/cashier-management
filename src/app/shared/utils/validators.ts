import {
  MAX_USERNAME_LEN,
  MIN_PASSWORD_LEN,
  MIN_USERNAME_LEN,
  PASSWORD_HAS_DIGIT,
  PASSWORD_HAS_LETTER,
} from '../../core/config/app.constants';
import { translate } from '../../core/i18n/translate';
const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_REGEX = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`);
const HOSTNAME_REGEX = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;
export function stripWsScheme(address: string): string {
  return address.trim().replace(/^wss?:\/\//i, '');
}
/**
 * Validates a "host:port" address (e.g. "192.168.1.5:8080") *before* it is ever
 * used to open a socket — catches malformed IPs/ports (missing/extra octets,
 * out-of-range numbers, missing port, non-numeric port) with an immediate,
 * synchronous answer, distinct from `checkAddress`'s "is anything listening
 * there" network probe.
 */
export function isValidHostPort(address: string): boolean {
  const trimmed = stripWsScheme(address);
  const separatorIndex = trimmed.lastIndexOf(':');
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) return false;
  const host = trimmed.slice(0, separatorIndex);
  const portStr = trimmed.slice(separatorIndex + 1);
  if (!/^\d+$/.test(portStr)) return false;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  return IPV4_REGEX.test(host) || HOSTNAME_REGEX.test(host);
}
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;
export function isValidIp(value: string): boolean {
  return IPV4_REGEX.test(value) || (value.includes(':') && IPV6_REGEX.test(value));
}
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PREFIX_REGEX = /^\+\d{1,4}$/;
const MIN_PHONE_NATIONAL_DIGITS = 6;
const MAX_PHONE_DIGITS = 15;
export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}
function phoneNationalDigits(number: string): string {
  return number.replace(/\D/g, '').replace(/^0/, '');
}
export function isValidPhone(prefix: string, number: string): boolean {
  const code = prefix.trim();
  const national = phoneNationalDigits(number);
  return (
    PHONE_PREFIX_REGEX.test(code) &&
    national.length >= MIN_PHONE_NATIONAL_DIGITS &&
    code.length - 1 + national.length <= MAX_PHONE_DIGITS
  );
}
export function formatPhone(prefix: string, number: string): string {
  return `${prefix.trim()} ${phoneNationalDigits(number)}`;
}
export function hasLetterAndDigit(password: string): boolean {
  return PASSWORD_HAS_LETTER.test(password) && PASSWORD_HAS_DIGIT.test(password);
}
export function passwordRuleError(password: string): string {
  if (password.length < MIN_PASSWORD_LEN) {
    return translate('Mot de passe : {MIN_PASSWORD_LEN} caractères minimum.', { MIN_PASSWORD_LEN: MIN_PASSWORD_LEN });
  }
  if (!hasLetterAndDigit(password)) {
    return translate('Mot de passe : une lettre et un chiffre requis.');
  }
  return '';
}
export function credentialsRuleError(username: string, password: string): string {
  if (username.length < MIN_USERNAME_LEN) {
    return translate('Identifiant : {MIN_USERNAME_LEN} caractères minimum.', { MIN_USERNAME_LEN: MIN_USERNAME_LEN });
  }
  if (username.length > MAX_USERNAME_LEN) {
    return translate('Identifiant : {MAX_USERNAME_LEN} caractères maximum.', { MAX_USERNAME_LEN: MAX_USERNAME_LEN });
  }
  return passwordRuleError(password);
}
