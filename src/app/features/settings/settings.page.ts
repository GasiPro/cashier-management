import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { clockNow, formatClockTime } from '../../core/display/datetime-settings';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { getStoredDisplayName, getStoredUsername } from '../../core/storage/local-storage';
import { BottomBar } from '../../layouts/main-layout/bottom-bar/bottom-bar';
import { LeftSidebar } from '../../layouts/main-layout/sidebar/sidebar';
import { Navbar } from '../../layouts/main-layout/navbar/navbar';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { translate } from '../../core/i18n/translate';
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, Navbar, LeftSidebar, BottomBar, TranslatePipe],
  templateUrl: './settings.page.html'
})
export class SettingsPage implements OnInit, OnDestroy {
  username = getStoredUsername() ?? translate('Caisse');
  private displayName = getStoredDisplayName() ?? '';
  /** Name shown in the navbar — the account display name when one exists, otherwise the username. */
  get displayLabel(): string {
    return this.displayName.trim() ? this.displayName : this.username;
  }
  currentTime = signal('');
  private clockInterval?: ReturnType<typeof setInterval>;
  constructor(private router: Router) {}
  ngOnInit(): void {
    this.tick();
    this.clockInterval = setInterval(() => this.tick(), 1000);
  }
  ngOnDestroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
  }
  private tick(): void {
    this.currentTime.set(formatClockTime(clockNow()));
  }
  goBack(): void {
    this.router.navigate(['/caissier']);
  }
  goToDisplaySettings(): void {
    this.router.navigate(['/affichage']);
  }
  goToProfile(): void {
    this.router.navigate(['/profil']);
  }
}
