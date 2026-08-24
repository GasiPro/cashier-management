import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/** Rôle de la vue hôte — détermine la route "Accueil" ciblée par le rail de navigation. */
export type SidebarRole = 'cashier' | 'counter';

const HOME_ROUTE_BY_ROLE: Record<SidebarRole, string> = {
  cashier: '/caisse',
  counter: '/comptoir',
};

const SETTINGS_ROUTE = '/reglages';

/**
 * Rail de navigation vertical partagé entre les vues Caisse et Comptoir.
 * Le bouton "Accueil" et l'état actif s'adaptent au rôle fourni ; "Calculatrice"
 * et "Mémo" délèguent leur affichage à la vue hôte via des events.
 */
@Component({
  selector: 'app-left-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './left-sidebar.html',
})
export class LeftSidebar {
  /** Rôle de la vue hôte : détermine la route "Accueil" (Caisse ou Comptoir). */
  @Input({ required: true }) role: SidebarRole = 'cashier';

  /** Émis au clic sur "Calculatrice" — la vue hôte gère l'ouverture du panneau. */
  @Output() calculatriceClick = new EventEmitter<void>();
  /** Émis au clic sur "Mémo" — la vue hôte gère l'ouverture du panneau. */
  @Output() memoClick = new EventEmitter<void>();

  private currentUrl = signal(this.router.url);

  constructor(private router: Router) {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
  }

  isHomeActive(): boolean {
    return this.currentUrl().startsWith(HOME_ROUTE_BY_ROLE[this.role]);
  }

  isSettingsActive(): boolean {
    return this.currentUrl().startsWith(SETTINGS_ROUTE);
  }

  /** Classes Tailwind appliquées au bouton selon son état actif/inactif. */
  iconButtonClass(active: boolean): string {
    return active
      ? 'bg-[#EFF4FA] text-[#1E3A5F]'
      : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600';
  }

  goHome(): void {
    this.router.navigate([HOME_ROUTE_BY_ROLE[this.role]]);
  }

  openCalculatrice(): void {
    this.calculatriceClick.emit();
  }

  openMemo(): void {
    this.memoClick.emit();
  }

  goToSettings(): void {
    this.router.navigate([SETTINGS_ROUTE]);
  }
}
