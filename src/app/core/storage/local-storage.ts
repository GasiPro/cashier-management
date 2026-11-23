import { APP_SLUG } from '../config/app.constants';
const LS_USERNAME = `${APP_SLUG}:username`;
const LS_DISPLAY_NAME = `${APP_SLUG}:displayName`;
const LS_CASHIER_URL = `${APP_SLUG}:cashierWsUrl`;
export function getStoredUsername(): string | null {
  return localStorage.getItem(LS_USERNAME);
}
export function setStoredUsername(value: string): void {
  localStorage.setItem(LS_USERNAME, value);
}
export function getStoredDisplayName(): string | null {
  return localStorage.getItem(LS_DISPLAY_NAME);
}
export function setStoredDisplayName(value: string): void {
  localStorage.setItem(LS_DISPLAY_NAME, value);
}
export function getStoredCashierWsUrl(): string | null {
  return localStorage.getItem(LS_CASHIER_URL);
}
export function setStoredCashierWsUrl(value: string): void {
  localStorage.setItem(LS_CASHIER_URL, value);
}
