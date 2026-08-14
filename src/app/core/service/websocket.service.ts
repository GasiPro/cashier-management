// src/app/core/service/websocket.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export interface WsMessage<T = any> {
  type: string;
  data: T;
}

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_REGEX = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`);
/** Bare hostnames (e.g. "localhost") — kept permissive since the cashier's LAN
 *  address is normally an IPv4 literal, but a hostname is still valid input. */
const HOSTNAME_REGEX = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;

/** Strips a leading "ws://" or "wss://" scheme, if present, before validating/using an address. */
export function stripWsScheme(address: string): string {
  return address.trim().replace(/^wss?:\/\//i, '');
}

/**
 * Validates a "host:port" address (e.g. "192.168.1.5:8080") *before* it is ever
 * used to open a socket — catches malformed IPs/ports (missing/extra octets,
 * out-of-range numbers, missing port, non-numeric port) with an immediate,
 * synchronous answer, distinct from `checkAddress`'s "is anything listening
 * there" network probe.
 */
export function isValidHostPort(address: string): boolean {
  const trimmed = stripWsScheme(address);
  const separatorIndex = trimmed.lastIndexOf(':');
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) return false;

  const host = trimmed.slice(0, separatorIndex);
  const portStr = trimmed.slice(separatorIndex + 1);
  if (!/^\d+$/.test(portStr)) return false;

  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;

  return IPV4_REGEX.test(host) || HOSTNAME_REGEX.test(host);
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
   * Comptoir credentials, kept in memory only (never persisted) so the same
   * `request_connection` flow can re-authenticate on a reconnect or a manual
   * server switch without asking the operator to retype the password. Set
   * once by the login flow and cleared on disconnect.
   */
  private counterCredentials: { username: string; password: string } | null = null;

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

  /**
   * Probe whether a WS server is reachable at the given address, without
   * touching the main connection. Opens a throwaway socket and resolves
   * `true` if it connects before `timeoutMs`, `false` otherwise.
   */
  checkAddress(url: string, timeoutMs = 3000): Promise<boolean> {
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

  /** Stores the comptoir's credentials in memory for reuse on reconnect. */
  setCounterCredentials(username: string, password: string): void {
    this.counterCredentials = { username, password };
  }

  /** Last credentials set via {@link setCounterCredentials}, if any. */
  getCounterCredentials(): { username: string; password: string } | null {
    return this.counterCredentials;
  }

  /** Drops any stored credentials — call on logout/disconnect. */
  clearCounterCredentials(): void {
    this.counterCredentials = null;
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
