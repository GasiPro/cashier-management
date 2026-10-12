import { Injectable, signal } from '@angular/core';
export type UserRole = 'admin' | 'caissier' | 'comptoir';
@Injectable({ providedIn: 'root' })
export class SessionStore {
  readonly role = signal<UserRole | null>(null);
  private counterCredentials: { username: string; password: string } | null = null;
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
  setRole(role: UserRole | null): void {
    this.role.set(role);
  }
  isAuthenticated(): boolean {
    return this.role() !== null;
  }
}
