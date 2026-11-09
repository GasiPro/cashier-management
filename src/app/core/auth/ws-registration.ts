import { Injectable } from '@angular/core';
import { WsClient } from '../realtime/ws-client';
import { SessionStore } from './session.store';
@Injectable({ providedIn: 'root' })
export class WsRegistration {
  private cashierRegistered = false;
  constructor(
    private ws: WsClient,
    private session: SessionStore,
  ) {
    // The session token is single-use: once the socket closes, the registration is gone.
    this.ws.onClosed().subscribe(() => {
      this.cashierRegistered = false;
    });
  }
  /** True while the socket opened by this cashier is still open and registered. */
  isCashierRegistered(): boolean {
    return this.cashierRegistered && this.ws.isOpen();
  }
  registerAdmin(): boolean {
    const token = this.session.consumeSessionToken();
    if (!token) return false;
    this.ws.send({ type: 'register_admin', token });
    return true;
  }
  registerCashier(username: string): boolean {
    const token = this.session.consumeSessionToken();
    if (!token) return false;
    this.cashierRegistered = this.ws.send({ type: 'register_cashier', username, token });
    return true;
  }
}
