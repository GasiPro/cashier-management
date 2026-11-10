import { Component, computed, input } from '@angular/core';
export type EmptyStateVariant = 'text' | 'block';
@Component({
  selector: 'app-empty-state',
  standalone: true,
  templateUrl: './empty-state.html',
})
export class EmptyState {
  variant = input<EmptyStateVariant>('text');
  italic = input<boolean>(true);
  compact = input<boolean>(false);
  centered = input<boolean>(false);
  readonly wrapperClasses = computed(() => (this.variant() === 'block' ? 'text-center py-20 text-gray-400' : ''));
  readonly textClasses = computed(() => {
    if (this.variant() === 'block') {
      return 'text-sm';
    }
    const italic = this.italic() ? ' italic' : '';
    const padding = this.compact() ? ' py-3' : ' py-5';
    const centered = this.centered() ? ' text-center' : '';
    return `text-sm text-gray-400${italic}${padding}${centered}`;
  });
}
