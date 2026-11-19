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
import { NoticeSplash } from './shared/ui/notice-splash/notice-splash';
const SPLASH_MIN_DELAY_MS = 6000;
function isNavigationSettled(event: RouterEvent): boolean {
  return (
    event instanceof NavigationEnd ||
    event instanceof NavigationError ||
    (event instanceof NavigationCancel && event.code !== NavigationCancellationCode.Redirect)
  );
}
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NoticeSplash],
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
