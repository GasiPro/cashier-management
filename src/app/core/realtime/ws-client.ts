import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { WS_PROBE_TIMEOUT_MS, WS_RECONNECT_DELAY_MS } from '../config/app.constants';
import type { WsMessage } from './ws-protocol';
@Injectable({ providedIn: 'root' })
export class WsClient implements OnDestroy {
  private socket: WebSocket | null = null;
  private readonly messages$ = new Subject<WsMessage>();
  private readonly openEvent$ = new Subject<void>();
  private readonly closeEvent$ = new Subject<void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url = '';
  private manuallyClosed = false;
  connect(url: string): void {
    if (this.socket && this.url === url && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }
    this.manuallyClosed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.url = url;
    this.detachSocket();
    this.open();
  }
  private open(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) {
        socket.close();
        return;
      }
      this.openEvent$.next();
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      if (this.socket !== socket) return;
      let parsed: WsMessage | null = null;
      try {
        parsed = JSON.parse(event.data) as WsMessage;
      } catch {
        return;
      }
      if (parsed) {
        this.messages$.next(parsed);
      }
    };
    socket.onclose = () => {
      if (this.socket !== null && this.socket !== socket) return;
      this.closeEvent$.next();
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      socket.close();
    };
  }
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manuallyClosed) {
        this.open();
      }
    }, WS_RECONNECT_DELAY_MS);
  }
  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
  checkAddress(url: string, timeoutMs = WS_PROBE_TIMEOUT_MS): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let probe: WebSocket;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        probe.onopen = null;
        probe.onerror = null;
        probe.onclose = null;
        probe.close();
        resolve(result);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      try {
        probe = new WebSocket(url);
      } catch {
        clearTimeout(timer);
        resolve(false);
        return;
      }
      probe.onopen = () => finish(true);
      probe.onerror = () => finish(false);
    });
  }
  send(payload: unknown): boolean {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  getMessages(): Observable<WsMessage> {
    return this.messages$.asObservable();
  }
  onOpened(): Observable<void> {
    return this.openEvent$.asObservable();
  }
  onClosed(): Observable<void> {
    return this.closeEvent$.asObservable();
  }
  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.detachSocket();
  }
  private detachSocket(): void {
    const previous = this.socket;
    this.socket = null;
    if (previous && previous.readyState <= WebSocket.OPEN) {
      previous.close();
    }
  }
  ngOnDestroy(): void {
    this.disconnect();
  }
}
