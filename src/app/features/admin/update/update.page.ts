import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'completed';

interface AvailableUpdate {
  version: string;
  note: string;
}

const RELAUNCH_DELAY_MS = 2000;
const NO_NOTE = 'Aucune note de version.';
const CHECK_ERROR = 'Impossible de vérifier les mises à jour. Vérifiez votre connexion internet.';
const INSTALL_ERROR = 'La mise à jour a échoué. Veuillez réessayer.';

@Component({
  selector: 'app-admin-update',
  standalone: true,
  templateUrl: './update.page.html',
})
export class UpdatePage implements OnInit, OnDestroy {
  readonly currentVersion = signal('—');
  readonly phase = signal<UpdatePhase>('idle');
  readonly update = signal<AvailableUpdate | null>(null);
  readonly progress = signal(0);
  readonly errorMessage = signal('');

  readonly busy = computed(() => this.phase() === 'checking' || this.phase() === 'installing');

  private pendingUpdate: Update | null = null;
  private relaunchTimer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    try {
      this.currentVersion.set(await getVersion());
    } catch {
      this.currentVersion.set('—');
    }
  }

  ngOnDestroy(): void {
    if (this.relaunchTimer !== null) {
      clearTimeout(this.relaunchTimer);
      this.relaunchTimer = null;
    }
  }

  async checkForUpdates(): Promise<void> {
    if (this.busy()) return;
    this.errorMessage.set('');
    this.update.set(null);
    this.pendingUpdate = null;
    this.phase.set('checking');
    try {
      const found = await check();
      if (!found) {
        this.phase.set('up-to-date');
        return;
      }
      this.pendingUpdate = found;
      this.update.set({ version: found.version, note: found.body?.trim() || NO_NOTE });
      this.phase.set('available');
    } catch {
      this.errorMessage.set(CHECK_ERROR);
      this.phase.set('idle');
    }
  }

  async installUpdate(): Promise<void> {
    const pending = this.pendingUpdate;
    if (!pending || this.phase() !== 'available') return;
    this.errorMessage.set('');
    this.progress.set(0);
    this.phase.set('installing');
    let total = 0;
    let downloaded = 0;
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (total > 0) this.progress.set(Math.min(Math.round((downloaded / total) * 100), 100));
        } else {
          this.progress.set(100);
        }
      });
    } catch {
      this.errorMessage.set(INSTALL_ERROR);
      this.phase.set('available');
      return;
    }
    this.progress.set(100);
    this.phase.set('completed');
    this.relaunchTimer = setTimeout(() => {
      void relaunch();
    }, RELAUNCH_DELAY_MS);
  }
}
