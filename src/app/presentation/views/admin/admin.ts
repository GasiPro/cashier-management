import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { WebsocketService, WsMessage } from '../../../core/service/websocket.service';
const LS_USERNAME = 'gasipro:username';
const ADMIN_LOCAL_WS_URL = 'ws://127.0.0.1:8080';
interface AdminNavItem {
  id: string;
  label: string;
  route: string;
}
const NAV_ITEMS: AdminNavItem[] = [
  { id: 'comptes', label: 'Comptes', route: 'comptes' },
  { id: 'appareils', label: 'Appareils & connexions', route: 'appareils' },
  { id: 'grille-tarifaire', label: 'Grille tarifaire', route: 'grille-tarifaire' },
  { id: 'commandes', label: 'Commandes', route: 'commandes' },
  { id: 'rapport', label: 'Rapport', route: 'rapport' },
];
const HOME_ROUTE = 'dashboard';
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit, OnDestroy {
  readonly navItems = NAV_ITEMS;
  readonly homeRoute = HOME_ROUTE;
  readonly username = localStorage.getItem(LS_USERNAME) ?? 'Admin';
  private currentUrl = signal('');
  /**
   * Owns the single WS connection/registration for the whole admin section — child
   * routes (dashboard, order, report, ...) only read from it, so the one-time session
   * token from login is spent exactly once here rather than re-sent on every subview
   * switch.
   */
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  /** Set once the server has sent anything other than a registration failure. */
  private approved = false;
  constructor(
    private router: Router,
    private ws: WebsocketService,
  ) {
    this.currentUrl.set(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
  }
  ngOnInit(): void {
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      if (msg.type === 'error_protocol') {
        if (!this.approved) {
          this.returnToLogin();
        }
        return;
      }
      this.approved = true;
    });
    this.openSubscription = this.ws.onOpened().subscribe(() => this.registerOnOpen());
    this.ws.connect(ADMIN_LOCAL_WS_URL);
    if (this.ws.isOpen()) {
      this.registerOnOpen();
    }
  }
  private registerOnOpen(): void {
    if (this.approved) {
      this.returnToLogin();
      return;
    }
    const token = this.ws.consumeSessionToken();
    if (!token) {
      this.returnToLogin();
      return;
    }
    this.ws.send({ type: 'register_admin', token });
  }
  private returnToLogin(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
    this.router.navigate(['/login']);
  }
  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
  }
  isActive(route: string): boolean {
    const path = this.currentUrl().split('?')[0].split('#')[0];
    return path === `/admin/${route}` || path.startsWith(`/admin/${route}/`);
  }
  navItemClass(route: string): string {
    const base = 'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors block';
    return this.isActive(route)
      ? `${base} bg-[#EFF4FA] text-[#1E3A5F] font-medium`
      : `${base} text-gray-700 hover:bg-gray-50`;
  }
}
