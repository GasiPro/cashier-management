import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SessionStore {
  /**
   * Comptoir credentials, kept in memory only (never persisted) so the same
   * `request_connection` flow can re-authenticate on a reconnect or a manual
   * server switch without asking the operator to retype the password. Set
   * once by the login flow and cleared on disconnect.
   */
  private counterCredentials: { username: string; password: string } | null = null;

  /**
   * The one-time session token minted by `authenticate_admin` / `authenticate_cashier`
   * at login, kept in memory only (never persisted) until it is consumed by the very
   * next WS registration attempt. It is single-use and time-limited server-side, so it
   * must never be re-read or resent after that first attempt.
   */
  private sessionToken: string | null = null;

  setCounterCredentials(username: string, password: string): void {
    this.counterCredentials = { username, password };
  }

  getCounterCredentials(): { username: string; password: string } | null {
    return this.counterCredentials;
  }

  clearCounterCredentials(): void {
    this.counterCredentials = null;
  }

  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  consumeSessionToken(): string | null {
    const token = this.sessionToken;
    this.sessionToken = null;
    return token;
  }
}
