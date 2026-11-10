import { Component, effect, inject, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  Event as RouterEvent,
  Router,
  RouterOutlet,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { SessionStore } from './core/auth/session.store';
import { initDisplaySettings } from './core/display/display-settings';

const SPLASH_MIN_DELAY_MS = 6000;

/** True once a navigation is over; a guard redirect is not final, the next navigation is. */
function isNavigationSettled(event: RouterEvent): boolean {
  return (
    event instanceof NavigationEnd ||
    event instanceof NavigationError ||
    (event instanceof NavigationCancel && event.code !== NavigationCancellationCode.Redirect)
  );
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  readonly splashVisible = signal(true);

  constructor() {
    effect(() => {
      void initDisplaySettings(this.session.role());
    });
    void this.runSplash();
  }

  /** Keeps the splash up until the first screen is ready, for at least SPLASH_MIN_DELAY_MS. */
  private async runSplash(): Promise<void> {
    const firstNavigation = firstValueFrom(this.router.events.pipe(filter(isNavigationSettled)));
    await Promise.all([
      firstNavigation,
      document.fonts.ready,
      new Promise<void>((resolve) => setTimeout(resolve, SPLASH_MIN_DELAY_MS)),
    ]);
    this.splashVisible.set(false);
  }
}
