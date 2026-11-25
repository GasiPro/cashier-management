import { Injectable } from '@angular/core';
import { applyDateTimeSync, initDateTimeSettings } from '../../core/display/datetime-settings';
import { WsClient } from '../../core/realtime/ws-client';
@Injectable({ providedIn: 'root' })
export class DateTimeStore {
  constructor(ws: WsClient) {
    void initDateTimeSettings();
    ws.getMessages().subscribe((msg) => {
      if (msg.type === 'datetime') {
        applyDateTimeSync(msg.data);
      }
    });
  }
}
