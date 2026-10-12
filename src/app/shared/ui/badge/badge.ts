import { Component, computed, input } from '@angular/core';

export type BadgeTone = 'brand' | 'success' | 'danger' | 'warning' | 'info';

const TONE_CLASSES: Record<BadgeTone, string> = {
  brand: 'text-[#1E3A5F] bg-[#EFF4FA] border-[#1E3A5F]/20',
  success: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  danger: 'text-red-700 bg-red-50 border-red-200',
  warning: 'text-amber-700 bg-amber-50 border-amber-200',
  info: 'text-sky-700 bg-sky-50 border-sky-200',
};

@Component({
  selector: 'app-badge',
  standalone: true,
  templateUrl: './badge.html',
  host: { class: 'inline-flex flex-shrink-0' },
})
export class Badge {
  /** warning = Remise / En attente / Suspendu, info = Majoration, success = Payée / Produit, danger = Refusée, brand = Service / Vous / user type. */
  tone = input<BadgeTone>('brand');
  uppercase = input<boolean>(false);
  tooltip = input<string>('');
  /** Extra text for screen readers only (e.g. "appliquée sur cette commande"). */
  srText = input<string>('');

  readonly classes = computed(() => {
    const base = 'inline-flex items-center gap-1 text-[10px] font-semibold border rounded-full px-1.5 py-0.5';
    const casing = this.uppercase() ? ' uppercase tracking-wide' : '';
    return `${base}${casing} ${TONE_CLASSES[this.tone()]}`;
  });
}
