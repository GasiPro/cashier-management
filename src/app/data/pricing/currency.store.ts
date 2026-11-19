import { Injectable, signal } from '@angular/core';
import { WsClient } from '../../core/realtime/ws-client';

export const DEFAULT_CURRENCY = 'MGA';

@Injectable({ providedIn: 'root' })
export class CurrencyStore {
  readonly code = signal(DEFAULT_CURRENCY);

  constructor(ws: WsClient) {
    ws.getMessages().subscribe((msg) => {
      if (msg.type === 'currency' && msg.data.trim()) {
        this.code.set(msg.data);
      }
    });
  }
}
