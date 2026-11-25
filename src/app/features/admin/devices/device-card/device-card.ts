import { Component, OnDestroy, computed, input, signal } from '@angular/core';
import { userTypeLabel } from '../../../../data/account/account.model';
import { ConnectionEvent, Device } from '../../../../data/device/device.model';
import { TimePipe } from '../../../../shared/pipes/time.pipe';
import { Badge, BadgeTone } from '../../../../shared/ui/badge/badge';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { translate } from '../../../../core/i18n/translate';
const EVENT_BADGES: Record<ConnectionEvent, { label: string; tone: BadgeTone }> = {
  requested: { label: 'En attente', tone: 'warning' },
  approved: { label: 'Connecté', tone: 'success' },
  refused: { label: 'Refusé', tone: 'danger' },
  disconnected: { label: 'Déconnecté', tone: 'info' },
  blocked: { label: 'Bloqué', tone: 'danger' },
};
type CopyKey = 'device' | 'account';
@Component({
  selector: 'app-device-card',
  standalone: true,
  imports: [Badge, TimePipe, TranslatePipe],
  templateUrl: './device-card.html',
})
export class DeviceCard implements OnDestroy {
  device = input.required<Device>();
  event = input.required<ConnectionEvent>();
  online = input<boolean>(false);
  at = input<string | null | undefined>(null);
  disconnectedAt = input<string | null | undefined>(null);
  autoDisconnected = input<boolean>(false);
  readonly badge = computed(() => EVENT_BADGES[this.event()]);
  readonly roleLabel = computed(() => userTypeLabel(this.device().user_type));
  readonly atLabel = computed(() => (this.event() === 'requested' ? translate('Demande') : translate('Connexion')));
  readonly cardClasses = computed(() =>
    this.event() === 'requested' ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200',
  );
  readonly ids = computed<{ key: CopyKey; label: string; value: string }[]>(() => [
    { key: 'device', label: translate('Appareil'), value: this.device().device_id },
    { key: 'account', label: translate('Compte'), value: this.device().account_id },
  ]);
  readonly copied = signal<CopyKey | null>(null);
  private copiedTimer?: ReturnType<typeof setTimeout>;
  async copy(key: CopyKey, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(key);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(null), 1500);
    } catch (e) {
      console.error('failed to copy id', e);
    }
  }
  ngOnDestroy(): void {
    clearTimeout(this.copiedTimer);
  }
}
