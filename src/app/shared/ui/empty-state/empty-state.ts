import { Component, computed, input } from '@angular/core';

export type EmptyStateVariant = 'text' | 'block';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  templateUrl: './empty-state.html',
})
export class EmptyState {
  /** text = a single muted line (also used for "Chargement…"), block = icon + message. */
  variant = input<EmptyStateVariant>('text');
  italic = input<boolean>(true);
  /** Tighter vertical padding (py-2 instead of py-4). */
  compact = input<boolean>(false);
  centered = input<boolean>(false);

  readonly wrapperClasses = computed(() => (this.variant() === 'block' ? 'text-center py-16 text-gray-400' : ''));

  readonly textClasses = computed(() => {
    if (this.variant() === 'block') {
      return 'text-sm';
    }
    const italic = this.italic() ? ' italic' : '';
    const padding = this.compact() ? ' py-2' : ' py-4';
    const centered = this.centered() ? ' text-center' : '';
    return `text-sm text-gray-400${italic}${padding}${centered}`;
  });
}
