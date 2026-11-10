import { Component, effect, inject } from '@angular/core';
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
import { ipcCloseSplash } from './core/ipc/tauri-ipc';
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

  constructor() {
    effect(() => {
      void initDisplaySettings(this.session.role());
    });
    void this.closeSplashWhenReady();
  }

  /** Reveals the app once the first screen is ready, after at least SPLASH_MIN_DELAY_MS of splash. */
  private async closeSplashWhenReady(): Promise<void> {
    const firstNavigation = firstValueFrom(this.router.events.pipe(filter(isNavigationSettled)));
    await Promise.all([
      firstNavigation,
      document.fonts.ready,
      new Promise<void>((resolve) => setTimeout(resolve, SPLASH_MIN_DELAY_MS)),
    ]);
    try {
      await ipcCloseSplash();
    } catch (e) {
      console.error('failed to close splash', e);
    }
  }
}
