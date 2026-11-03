import { Component, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { initDisplaySettings } from '../../core/display/display-settings';
import { activate } from '../../data/settings/settings.api';
const LAUNCH_MIN_DELAY_MS = 6000;
const CONTACT_EMAIL = 'fanambynana@duck.com';
const CONTACT_CLOSE_DELAY_MS = 10_000;
@Component({
  selector: 'app-activation',
  standalone: true,
  templateUrl: './activation.page.html',
})
export class ActivationPage implements OnDestroy {
  readonly contactEmail = CONTACT_EMAIL;
  readonly productKey = signal('');
  readonly error = signal('');
  readonly checking = signal(false);
  readonly launching = signal(false);
  readonly showContact = signal(false);
  readonly copied = signal(false);
  private contactTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private router: Router) {}
  ngOnDestroy(): void {
    this.clearContactTimer();
  }
  onInput(event: Event): void {
    this.productKey.set((event.target as HTMLInputElement).value.toUpperCase());
    this.error.set('');
  }
  /** Opens the contact message and (re)starts its auto-close countdown. */
  requestKey(): void {
    this.copied.set(false);
    this.showContact.set(true);
    this.startContactTimer();
  }
  async copyEmail(): Promise<void> {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      this.copied.set(true);
    } catch (e) {
      console.error('failed to copy email', e);
    }
    this.startContactTimer();
  }
  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.checking()) return;
    this.checking.set(true);
    this.error.set('');
    try {
      if (!(await activate(this.productKey()))) {
        this.error.set('Clé de produit invalide');
        return;
      }
    } catch (e) {
      console.error('activation failed', e);
      this.error.set('Activation impossible. Veuillez réessayer.');
      return;
    } finally {
      this.checking.set(false);
    }
    this.clearContactTimer();
    this.launching.set(true);
    await Promise.all([
      initDisplaySettings(),
      new Promise<void>((resolve) => setTimeout(resolve, LAUNCH_MIN_DELAY_MS)),
    ]);
    await this.router.navigate(['/login'], { replaceUrl: true });
  }
  private startContactTimer(): void {
    this.clearContactTimer();
    this.contactTimer = setTimeout(() => {
      this.showContact.set(false);
      this.contactTimer = null;
    }, CONTACT_CLOSE_DELAY_MS);
  }
  private clearContactTimer(): void {
    if (this.contactTimer) clearTimeout(this.contactTimer);
    this.contactTimer = null;
  }
}
