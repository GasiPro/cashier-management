import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CONNECTED_DEVICES_POLL_MS } from '../../core/config/app.constants';
import { errorMessage } from '../../core/error/error-messages';
import { getStoredDisplayName, getStoredUsername } from '../../core/storage/local-storage';
import * as deviceApi from '../../data/device/device.api';
import { MAX_ALLOWED_CONNECTED_DEVICES } from '../../data/device/device.model';
import { BottomBar } from '../../layouts/main-layout/bottom-bar/bottom-bar';
import { LeftSidebar } from '../../layouts/main-layout/sidebar/sidebar';
import { Navbar } from '../../layouts/main-layout/navbar/navbar';
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, Navbar, LeftSidebar, BottomBar],
  templateUrl: './settings.page.html'
})
export class SettingsPage implements OnInit, OnDestroy {
  readonly maxAllowedConnectedDevices = MAX_ALLOWED_CONNECTED_DEVICES;
  username = getStoredUsername() ?? 'Caisse';
  private displayName = getStoredDisplayName() ?? '';
  /** Name shown in the navbar — the account display name when one exists, otherwise the username. */
  get displayLabel(): string {
    return this.displayName.trim() ? this.displayName : this.username;
  }
  currentTime = signal('');
  private clockInterval?: ReturnType<typeof setInterval>;
  maxConnectedDevices = signal(0);
  maxConnectedDevicesDraft = signal(0);
  connectedDevicesCount = signal(0);
  loadingDevicesSetting = signal(true);
  savingDevicesSetting = signal(false);
  devicesSettingDirty = computed(() => this.maxConnectedDevicesDraft() !== this.maxConnectedDevices());
  atDevicesCapacity = computed(
    () => this.maxConnectedDevices() > 0 && this.connectedDevicesCount() >= this.maxConnectedDevices(),
  );
  statusMessage = signal('');
  statusIsError = signal(false);
  private connectedDevicesPollId: ReturnType<typeof setInterval> | null = null;
  constructor(private router: Router) {}
  ngOnInit(): void {
    this.loadDevicesSetting();
    this.tick();
    this.clockInterval = setInterval(() => this.tick(), 1000);
    // Keep the "currently connected" count fresh while this page is open — it can
    // change from elsewhere (a comptoir connecting/dropping) at any time.
    this.connectedDevicesPollId = setInterval(() => this.refreshConnectedDevicesCount(), CONNECTED_DEVICES_POLL_MS);
  }
  ngOnDestroy(): void {
    if (this.connectedDevicesPollId !== null) {
      clearInterval(this.connectedDevicesPollId);
      this.connectedDevicesPollId = null;
    }
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
  }
  private tick(): void {
    const now = new Date();
    this.currentTime.set(
      now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    );
  }
  private async refreshConnectedDevicesCount(): Promise<void> {
    try {
      const connected = await deviceApi.countConnectedDevices();
      this.connectedDevicesCount.set(connected);
    } catch (e) {
      console.error('failed to refresh connected devices count', e);
    }
  }
  private async loadDevicesSetting(): Promise<void> {
    this.loadingDevicesSetting.set(true);
    try {
      const [max, connected] = await Promise.all([
        deviceApi.getMaxDevices(),
        deviceApi.countConnectedDevices(),
      ]);
      this.maxConnectedDevices.set(max);
      this.maxConnectedDevicesDraft.set(max);
      this.connectedDevicesCount.set(connected);
    } catch (e) {
      console.error('failed to load device settings', e);
      this.setStatus(errorMessage(e, 'Impossible de charger les réglages des appareils.'), true);
    } finally {
      this.loadingDevicesSetting.set(false);
    }
  }
  decrementMaxConnectedDevices(): void {
    this.maxConnectedDevicesDraft.update((v) => Math.max(0, v - 1));
  }
  incrementMaxConnectedDevices(): void {
    this.maxConnectedDevicesDraft.update((v) => Math.min(this.maxAllowedConnectedDevices, v + 1));
  }
  onMaxConnectedDevicesInput(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(this.maxAllowedConnectedDevices, Math.max(0, Math.round(parsed)));
    this.maxConnectedDevicesDraft.set(clamped);
  }
  resetMaxConnectedDevicesDraft(): void {
    this.maxConnectedDevicesDraft.set(this.maxConnectedDevices());
    this.setStatus('', false);
  }
  async saveMaxConnectedDevices(): Promise<void> {
    if (!this.devicesSettingDirty() || this.savingDevicesSetting()) return;
    this.savingDevicesSetting.set(true);
    this.setStatus('', false);
    try {
      const applied = await deviceApi.setMaxDevices(this.maxConnectedDevicesDraft());
      this.maxConnectedDevices.set(applied);
      this.maxConnectedDevicesDraft.set(applied);
      this.setStatus(
        applied === 0
          ? "Nombre d'appareils illimité enregistré."
          : `Limite enregistrée : ${applied} appareil${applied > 1 ? 's' : ''} maximum.`,
        false,
      );
    } catch (e) {
      console.error('devices_max_set failed', e);
      this.setStatus(errorMessage(e, "Échec de l'enregistrement. Réessayez."), true);
    } finally {
      this.savingDevicesSetting.set(false);
    }
  }
  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
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
