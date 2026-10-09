import { Component, EventEmitter, Output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ConnectedDevice,
  PeerId,
  PendingConnection,
} from '../../../../data/device/device.model';

export function deviceDisplayName(device: { username?: string | null; label: string }): string {
  return device.username?.trim() || device.label;
}

export function deviceAddress(device: { ip_address: string; port: number }): string {
  return `${device.ip_address}:${device.port}`;
}

@Component({
  selector: 'app-devices-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './devices-panel.html',
})
export class DevicesPanel {
  wsAddress = input.required<string>();
  pendingRequests = input.required<PendingConnection[]>();
  connectedDevices = input.required<ConnectedDevice[]>();
  maxConnectedDevices = input.required<number>();
  atDeviceCapacity = input.required<boolean>();
  busyDeviceId = input<PeerId | null>(null);
  confirmingBlockDeviceId = input<PeerId | null>(null);

  @Output() closed = new EventEmitter<void>();
  @Output() copyAddress = new EventEmitter<void>();
  @Output() settingsRequested = new EventEmitter<void>();
  @Output() approved = new EventEmitter<PeerId>();
  @Output() rejected = new EventEmitter<PeerId>();
  @Output() disconnected = new EventEmitter<PeerId>();
  @Output() blockRequested = new EventEmitter<PeerId>();
  @Output() blockCancelled = new EventEmitter<void>();
  @Output() blocked = new EventEmitter<PeerId>();

  displayName(device: { username?: string | null; label: string }): string {
    return deviceDisplayName(device);
  }

  addrOf(device: { ip_address: string; port: number }): string {
    return deviceAddress(device);
  }
}
