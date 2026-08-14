// src/app/presentation/vews/setting/setting.ts
import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';

/** Kept in sync with `MAX_ALLOWED_CONNECTED_DEVICES` in src-tauri/src/config/settings.rs. */
const MAX_ALLOWED_CONNECTED_DEVICES = 50;

@Component({
  selector: 'app-setting',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './setting.html',
  styleUrl: './setting.css',
})
export class Setting implements OnInit {
  readonly maxAllowedConnectedDevices = MAX_ALLOWED_CONNECTED_DEVICES;

  // ── Max connected devices ─────────────────────────────────────────────────
  /** Value currently applied on the server. */
  maxConnectedDevices = signal(0);
  /** Value shown in the input — kept separate so typing/stepping doesn't save until confirmed. */
  maxConnectedDevicesDraft = signal(0);
  /** How many comptoirs are connected right now (from the same peer tracking as the Appareils panel). */
  connectedDevicesCount = signal(0);
  loadingDevicesSetting = signal(true);
  savingDevicesSetting = signal(false);
  devicesSettingDirty = computed(() => this.maxConnectedDevicesDraft() !== this.maxConnectedDevices());
  /** True once the currently-applied limit is already reached — informs the cashier why new requests may be turned away. */
  atDevicesCapacity = computed(
    () => this.maxConnectedDevices() > 0 && this.connectedDevicesCount() >= this.maxConnectedDevices(),
  );

  // ── Save feedback, announced to screen readers via aria-live ─────────────────
  statusMessage = signal('');
  statusIsError = signal(false);

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.loadDevicesSetting();
  }

  private async loadDevicesSetting(): Promise<void> {
    this.loadingDevicesSetting.set(true);
    try {
      const [max, connected] = await Promise.all([
        invoke<number>('get_max_connected_devices'),
        invoke<number>('get_connected_devices_count'),
      ]);
      this.maxConnectedDevices.set(max);
      this.maxConnectedDevicesDraft.set(max);
      this.connectedDevicesCount.set(connected);
    } catch (e) {
      console.error('failed to load device settings', e);
      this.setStatus('Impossible de charger les réglages des appareils.', true);
    } finally {
      this.loadingDevicesSetting.set(false);
    }
  }

  // ── Stepper / input helpers ──────────────────────────────────────────────────

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

  /** Discards unsaved edits, restoring the last value applied on the server. */
  resetMaxConnectedDevicesDraft(): void {
    this.maxConnectedDevicesDraft.set(this.maxConnectedDevices());
    this.setStatus('', false);
  }

  async saveMaxConnectedDevices(): Promise<void> {
    if (!this.devicesSettingDirty() || this.savingDevicesSetting()) return;
    this.savingDevicesSetting.set(true);
    this.setStatus('', false);
    try {
      const applied = await invoke<number>('set_max_connected_devices', {
        value: this.maxConnectedDevicesDraft(),
      });
      this.maxConnectedDevices.set(applied);
      this.maxConnectedDevicesDraft.set(applied);
      this.setStatus(
        applied === 0
          ? "Nombre d'appareils illimité enregistré."
          : `Limite enregistrée : ${applied} appareil${applied > 1 ? 's' : ''} maximum.`,
        false,
      );
    } catch (e) {
      console.error('set_max_connected_devices failed', e);
      this.setStatus("Échec de l'enregistrement. Réessayez.", true);
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
}
