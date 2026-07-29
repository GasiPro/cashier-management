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
 * Used by both views:
 * - Cashier connects to its own local server: ws://127.0.0.1:8080
 * - Counter connects to the Cashier's LAN address: ws://<cashier-ip>:8080
 *
 * This app runs zoneless (no zone.js — see package.json / angular.json), so
 * this service doesn't need to do anything special to "get back into
 * Angular" — it just forwards parsed messages through a plain RxJS Subject.
 * The consuming components (Cashier/Counter) write incoming data into
 * Angular signals, and a signal write is what notifies Angular's zoneless
 * scheduler to re-render, regardless of which callback it happened in.
 */
@Injectable({ providedIn: 'root' })
export class WebsocketService implements OnDestroy {
  private socket: WebSocket | null = null;
  private readonly messages$ = new Subject<WsMessage>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url = '';
  private manuallyClosed = false;

  /** Connect (or reconnect) to a given ws:// address. Safe to call again with the same URL — it's a no-op if already connected/connecting there. */
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

    socket.onmessage = (event: MessageEvent<string>) => {
      let parsed: WsMessage | null = null;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return; // ignore malformed frames rather than crashing the socket
      }
      if (parsed) {
        this.messages$.next(parsed as WsMessage);
      }
    };

    socket.onclose = () => {
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

  /** Send a JSON-serializable payload to the server. Silently dropped if not currently connected. */
  send(payload: unknown): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  /** Stream of parsed { type, data } messages pushed by the server. */
  getMessages(): Observable<WsMessage> {
    return this.messages$.asObservable();
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
