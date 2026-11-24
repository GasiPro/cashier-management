import { Injectable, signal } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class BilletageStore {
  /** Vrai quand le billetage du caissier est validé avec une caisse juste (écart nul). */
  readonly verified = signal(false);
}
