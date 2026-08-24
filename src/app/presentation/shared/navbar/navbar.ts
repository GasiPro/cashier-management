import { Component, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

/** Views that can host the shared navbar. Drives the role label and header width. */
export type NavbarRole = 'cashier' | 'counter';

/**
 * Shared top navbar for the cashier and counter views.
 *
 * Owns the chrome that is identical across roles (back button, brand, role
 * label, clock, menu toggle/dropdown shell) and exposes two projection slots
 * for the parts that differ per role:
 *  - `[navbarActions]`  — role-specific content shown before the menu button
 *                         (e.g. the cashier's revenue/transactions stats, or
 *                         the counter's connection status button).
 *  - `[navbarMenuItems]` — role-specific menu items rendered inside the
 *                          dropdown panel.
 *
 * The dropdown closes automatically on an outside click, on Escape, or when
 * any projected menu item is clicked (the click bubbles up to the panel).
 */
@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navbar.html',
})
export class Navbar {
  /** Determines the role label ("Caisse" / "Comptoir") and the header's max width. */
  role = input.required<NavbarRole>();
  /** Account display name shown next to the role label. */
  displayLabel = input.required<string>();
  /** Clock text shown on the far right of the header. */
  currentTime = input<string>('');
  /** Optional badge count shown on the menu toggle button (e.g. pending connection requests). */
  menuBadgeCount = input<number>(0);

  showMenu = signal(false);

  readonly roleLabel = computed(() => (this.role() === 'cashier' ? 'Caisse' : 'Comptoir'));
  readonly containerMaxWidthClass = computed(() => (this.role() === 'cashier' ? 'max-w-5xl' : 'max-w-6xl'));
  readonly menuId = computed(() => `${this.role()}-menu`);

  constructor(private router: Router) {}

  toggleMenu(): void {
    this.showMenu.update((v) => !v);
  }

  closeMenu(): void {
    this.showMenu.set(false);
  }

  goBack(): void {
    this.router.navigate(['/']);
  }
}
