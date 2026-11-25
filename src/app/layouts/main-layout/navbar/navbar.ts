import { Component, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SessionStore } from '../../../core/auth/session.store';
import { OrganizationStore } from '../../../data/settings/organization.store';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { translate } from '../../../core/i18n/translate';
export type NavbarRole = 'cashier' | 'counter';
@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './navbar.html',
})
export class Navbar {
  role = input.required<NavbarRole>();
  displayLabel = input.required<string>();
  currentTime = input<string>('');
  menuBadgeCount = input<number>(0);
  showMenuButton = input<boolean>(true);
  showBackButton = input<boolean>(false);
  showMenu = signal(false);
  readonly roleLabel = computed(() => (this.role() === 'cashier' ? translate('Caisse') : translate('Comptoir')));
  readonly containerMaxWidthClass = computed(() => (this.role() === 'cashier' ? 'max-w-5xl' : 'max-w-6xl'));
  readonly menuId = computed(() => `${this.role()}-menu`);
  constructor(
    private router: Router,
    private session: SessionStore,
    readonly organization: OrganizationStore,
  ) {}
  toggleMenu(): void {
    this.showMenu.update((v) => !v);
  }
  closeMenu(): void {
    this.showMenu.set(false);
  }
  goBack(): void {
    if (this.router.url.startsWith('/affichage') || this.router.url.startsWith('/profil')) {
      this.router.navigate(['/reglages']);
      return;
    }
    this.router.navigate([this.session.role() === 'comptoir' ? '/comptoir' : '/caissier']);
  }
}
