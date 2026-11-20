import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ModeStore } from '../../core/auth/mode.store';
import { errorMessage } from '../../core/error/error-messages';
import { AppMode } from '../../data/settings/settings.model';
interface ModeChoice {
  value: AppMode;
  label: string;
  title: string;
  description: string;
}
@Component({
  selector: 'app-mode',
  standalone: true,
  templateUrl: './mode.page.html',
})
export class ModePage {
  readonly choices: ModeChoice[] = [
    {
      value: 'caisse',
      label: 'Poste principal',
      title: 'Caisse',
      description: 'Caissier et administration. Ce poste héberge le serveur auquel les comptoirs se connectent.',
    },
    {
      value: 'comptoir',
      label: 'Poste service',
      title: 'Comptoir',
      description: 'Saisie des commandes clients, envoyées à la caisse par le réseau.',
    },
  ];
  readonly selected = signal<AppMode | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');
  constructor(
    private modeStore: ModeStore,
    private router: Router,
  ) {}
  select(value: AppMode): void {
    if (this.saving()) return;
    this.selected.set(value);
    this.error.set('');
  }
  async confirm(): Promise<void> {
    const value = this.selected();
    if (!value || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.modeStore.choose(value);
    } catch (e) {
      console.error('failed to set app mode', e);
      this.error.set(errorMessage(e, 'Impossible d\'enregistrer le mode. Veuillez réessayer.'));
      this.saving.set(false);
      return;
    }
    await this.router.navigate(['/login'], { replaceUrl: true });
  }
}
