// src/app/core/service/websocket.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export interface WsMessage<T = any> {
  type: string;
  data: T;
}

/**
 * Thin reconnecting wrapper around the native WebSocket API.
 *
 * - Cashier connects to its own local server: ws://127.0.0.1:8080
 * - Counter connects to the Cashier's LAN address: ws://<cashier-ip>:8080
 *
 * Exposes onOpened() and onClosed() Observables so callers can react to
 * connection lifecycle events (e.g. to re-send a register/request message
 * after a reconnect).
 */
@Injectable({ providedIn: 'root' })
export class WebsocketService implements OnDestroy {
  private socket: WebSocket | null = null;
  private readonly messages$ = new Subject<WsMessage>();
  private readonly openEvent$ = new Subject<void>();
  private readonly closeEvent$ = new Subject<void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url = '';
  private manuallyClosed = false;

  /**
   * Connect (or reconnect) to a given ws:// address.
   * No-op if already connected/connecting to the same URL.
   */
  connect(url: string): void {
    if (this.socket && this.url === url && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }
    this.manuallyClosed = false;
    this.url = url;
    this.open();
  }

  private open(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.openEvent$.next();
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let parsed: WsMessage | null = null;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (parsed) {
        this.messages$.next(parsed as WsMessage);
      }
    };

    socket.onclose = () => {
      this.closeEvent$.next();
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
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
    }, 2000);
  }

  /** Whether the underlying socket is currently open. */
  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Send a JSON-serializable payload. Silently dropped if not connected. */
  send(payload: unknown): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  /** Stream of parsed { type, data } messages pushed by the server. */
  getMessages(): Observable<WsMessage> {
    return this.messages$.asObservable();
  }

  /** Fires each time the WebSocket successfully opens (including reconnects). */
  onOpened(): Observable<void> {
    return this.openEvent$.asObservable();
  }

  /** Fires each time the WebSocket closes (including transient drops). */
  onClosed(): Observable<void> {
    return this.closeEvent$.asObservable();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
