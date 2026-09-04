import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
const LS_USERNAME = 'gasipro:username';
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
export class Admin {
  readonly navItems = NAV_ITEMS;
  readonly homeRoute = HOME_ROUTE;
  readonly username = localStorage.getItem(LS_USERNAME) ?? 'Admin';
  private currentUrl = signal('');
  constructor(private router: Router) {
    this.currentUrl.set(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
  }
  /** True when the given child route segment is the one currently outlet-rendered. */
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
