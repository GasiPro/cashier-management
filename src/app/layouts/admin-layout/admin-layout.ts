import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { getLocalWsUrl } from '../../data/device/device.api';
import { getStoredDisplayName, getStoredUsername } from '../../core/storage/local-storage';
import { WsRegistration } from '../../core/auth/ws-registration';
import { WsClient } from '../../core/realtime/ws-client';
import { WsMessage } from '../../core/realtime/ws-protocol';
import { searchAdmin } from './admin-search/admin-search';
interface AdminNavItem {
  id: string;
  label: string;
  route: string;
  icon: string;
}
const NAV_ITEMS: AdminNavItem[] = [
  { id: 'comptes', label: 'Comptes', route: 'comptes', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { id: 'appareils', label: 'Appareils & connexions', route: 'appareils', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { id: 'grille-tarifaire', label: 'Grille tarifaire', route: 'grille-tarifaire', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
  { id: 'commandes', label: 'Commandes', route: 'commandes', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
  { id: 'rapport', label: 'Rapport', route: 'rapport', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'mise-a-jour', label: 'Mise à jour', route: 'mise-a-jour', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
];
const HOME_ROUTE = 'dashboard';
const HOME_ICON = 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6';
@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink],
  templateUrl: './admin-layout.html'
})
export class AdminLayout implements OnInit, OnDestroy {
  readonly navItems = NAV_ITEMS;
  readonly homeRoute = HOME_ROUTE;
  readonly homeIcon = HOME_ICON;
  readonly username = getStoredUsername() ?? 'Admin';
  readonly showMenu = signal(false);
  readonly displayName = signal(this.storedLabel());
  readonly searchOpen = signal(false);
  readonly searchQuery = signal('');
  readonly searchResults = computed(() => searchAdmin(this.searchQuery()));
  readonly searching = computed(() => this.searchOpen() && this.searchQuery().trim() !== '');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
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
  private destroyed = false;
  constructor(
    private router: Router,
    private ws: WsClient,
    private registration: WsRegistration,
  ) {
    this.currentUrl.set(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.currentUrl.set(e.urlAfterRedirects);
        this.closeSearch();
      });
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
    void this.connectToLocalServer();
  }
  private async connectToLocalServer(): Promise<void> {
    const url = await getLocalWsUrl();
    if (this.destroyed) return;
    this.ws.connect(url);
    if (this.ws.isOpen()) {
      this.registerOnOpen();
    }
  }
  private registerOnOpen(): void {
    if (this.approved) {
      this.returnToLogin();
      return;
    }
    if (!this.registration.registerAdmin()) {
      this.returnToLogin();
    }
  }
  private returnToLogin(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
    this.router.navigate(['/login'], { replaceUrl: true });
  }
  logout(): void {
    this.closeMenu();
    this.ws.send({ type: 'logout' });
    this.returnToLogin();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
  }
  private storedLabel(): string {
    return getStoredDisplayName()?.trim() || this.username;
  }
  toggleMenu(): void {
    this.displayName.set(this.storedLabel());
    this.showMenu.update((v) => !v);
  }
  @HostListener('document:keydown.escape')
  closeMenu(): void {
    this.showMenu.set(false);
  }
  menuClass(): string {
    const base =
      'fixed z-50 bottom-16 left-3 w-[14.5rem] overflow-y-auto bg-white border border-gray-200 ' +
      'rounded-xl shadow-lg origin-bottom transition-all duration-200 ease-out motion-reduce:transition-none';
    return this.showMenu()
      ? `${base} max-h-[min(16rem,calc(100vh-2rem))] opacity-100`
      : `${base} max-h-0 opacity-0 invisible pointer-events-none`;
  }
  openSearch(): void {
    this.searchOpen.set(true);
    setTimeout(() => this.searchInput()?.nativeElement.focus());
  }
  closeSearch(): void {
    this.searchOpen.set(false);
    this.searchQuery.set('');
  }
  onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }
  openResult(route: string): void {
    this.closeSearch();
    this.router.navigate(['/admin', route]);
  }
  isActive(route: string): boolean {
    const path = this.currentUrl().split('?')[0].split('#')[0];
    return path === `/admin/${route}` || path.startsWith(`/admin/${route}/`);
  }
  navItemClass(route: string): string {
    const base = 'w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg text-sm transition-colors';
    return this.isActive(route)
      ? `${base} bg-[#EFF4FA] text-[#1E3A5F] font-medium`
      : `${base} text-gray-700 hover:bg-gray-50`;
  }
}
