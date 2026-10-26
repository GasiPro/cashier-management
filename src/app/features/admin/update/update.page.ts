import { Component, OnDestroy, computed, signal } from '@angular/core';

type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'completed';

interface AvailableUpdate {
  version: string;
  note: string;
}

const CURRENT_VERSION = '1.0.0';
const CHECK_DELAY_MS = 1200;
const PROGRESS_TICK_MS = 150;
const PROGRESS_STEP = 5;

@Component({
  selector: 'app-admin-update',
  standalone: true,
  templateUrl: './update.page.html',
})
export class UpdatePage implements OnDestroy {
  readonly currentVersion = CURRENT_VERSION;
  readonly phase = signal<UpdatePhase>('idle');
  readonly update = signal<AvailableUpdate | null>(null);
  readonly progress = signal(0);
  readonly errorMessage = signal('');

  readonly busy = computed(() => this.phase() === 'checking' || this.phase() === 'installing');

  private timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;

  ngOnDestroy(): void {
    this.clearTimer();
  }

  checkForUpdates(): void {
    if (this.busy()) return;
    this.errorMessage.set('');
    if (!navigator.onLine) {
      this.errorMessage.set('Aucune connexion internet. Connectez-vous puis réessayez.');
      return;
    }
    this.update.set(null);
    this.phase.set('checking');
    // UI-only simulation: replace with the real update check when the backend is wired.
    this.timer = setTimeout(() => {
      this.update.set({
        version: '1.1.0',
        note: 'Améliorations de stabilité et corrections mineures.',
      });
      this.phase.set('available');
    }, CHECK_DELAY_MS);
  }

  installUpdate(): void {
    if (this.phase() !== 'available') return;
    this.progress.set(0);
    this.phase.set('installing');
    // UI-only simulation: replace with the real download/install progress when the backend is wired.
    this.timer = setInterval(() => {
      const next = Math.min(this.progress() + PROGRESS_STEP, 100);
      this.progress.set(next);
      if (next >= 100) {
        this.clearTimer();
        this.phase.set('completed');
      }
    }, PROGRESS_TICK_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
