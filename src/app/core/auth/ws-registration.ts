import { Injectable } from '@angular/core';
import { WsClient } from '../realtime/ws-client';
import { SessionStore } from './session.store';

@Injectable({ providedIn: 'root' })
export class WsRegistration {
  constructor(
    private ws: WsClient,
    private session: SessionStore,
  ) {}

  /** Sends `register_admin` with the one-time session token. Returns false when no token is available. */
  registerAdmin(): boolean {
    const token = this.session.consumeSessionToken();
    if (!token) return false;
    this.ws.send({ type: 'register_admin', token });
    return true;
  }

  /** Sends `register_cashier` with the one-time session token. Returns false when no token is available. */
  registerCashier(username: string): boolean {
    const token = this.session.consumeSessionToken();
    if (!token) return false;
    this.ws.send({ type: 'register_cashier', username, token });
    return true;
  }
}
