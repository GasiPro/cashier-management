import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import {
  WS_PROBE_TIMEOUT_MS,
  WS_RECONNECT_DELAY_MS,
  WS_STALE_TIMEOUT_MS,
  WS_WATCHDOG_INTERVAL_MS,
} from '../config/app.constants';
import type { WsMessage } from './ws-protocol';

@Injectable({ providedIn: 'root' })
export class WsClient implements OnDestroy {
  private socket: WebSocket | null = null;
  private readonly messages$ = new Subject<WsMessage>();
  private readonly openEvent$ = new Subject<void>();
  private readonly closeEvent$ = new Subject<void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogArmed = false;
  private lastMessageAt = 0;
  private lastTickAt = 0;
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
      this.startWatchdog(socket);
      this.openEvent$.next();
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      let parsed: WsMessage | null = null;
      try {
        parsed = JSON.parse(event.data) as WsMessage;
      } catch {
        return;
      }
      if (parsed) {
        if (parsed.type === 'time') {
          this.watchdogArmed = true;
        }
        this.messages$.next(parsed);
      }
    };

    socket.onclose = () => {
      if (this.socket !== null && this.socket !== socket) return;
      this.stopWatchdog();
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

  /**
   * The server sends a `time` message every second to approved peers. If they stop
   * arriving the connection is half-open (network drop, sleeping server), which the
   * browser would only report after a very long TCP timeout, so it is dropped here.
   */
  private startWatchdog(socket: WebSocket): void {
    this.stopWatchdog();
    this.watchdogArmed = false;
    this.lastMessageAt = Date.now();
    this.lastTickAt = this.lastMessageAt;
    this.watchdogTimer = setInterval(() => {
      if (this.socket !== socket) return;
      const now = Date.now();
      const tickGap = now - this.lastTickAt;
      this.lastTickAt = now;
      if (tickGap > WS_WATCHDOG_INTERVAL_MS * 3) {
        this.lastMessageAt = now;
        return;
      }
      if (this.watchdogArmed && now - this.lastMessageAt > WS_STALE_TIMEOUT_MS) {
        this.dropStaleSocket(socket);
      }
    }, WS_WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.watchdogArmed = false;
  }

  private dropStaleSocket(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.stopWatchdog();
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // the socket is already unusable
    }
    this.closeEvent$.next();
    if (!this.manuallyClosed) {
      this.scheduleReconnect();
    }
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
    this.stopWatchdog();
    if (previous && previous.readyState <= WebSocket.OPEN) {
      previous.close();
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
