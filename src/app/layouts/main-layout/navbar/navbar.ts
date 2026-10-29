import { Component, computed, input, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
export type NavbarRole = 'cashier' | 'counter';
@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navbar.html',
})
export class Navbar {
  role = input.required<NavbarRole>();
  displayLabel = input.required<string>();
  currentTime = input<string>('');
  menuBadgeCount = input<number>(0);
  showMenuButton = input<boolean>(true);
  showMenu = signal(false);
  readonly roleLabel = computed(() => (this.role() === 'cashier' ? 'Caisse' : 'Comptoir'));
  readonly containerMaxWidthClass = computed(() => (this.role() === 'cashier' ? 'max-w-5xl' : 'max-w-6xl'));
  readonly menuId = computed(() => `${this.role()}-menu`);
  constructor(private location: Location) {}
  toggleMenu(): void {
    this.showMenu.update((v) => !v);
  }
  closeMenu(): void {
    this.showMenu.set(false);
  }
  goBack(): void {
    this.location.back();
  }
}
