import { Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'danger' | 'outline' | 'ghost';
export type ButtonSize = 'md' | 'lg';

const CLASSES: Record<ButtonVariant, Record<ButtonSize, string>> = {
  primary: {
    md: 'bg-[#1E3A5F] text-white text-sm font-semibold px-4 py-2 rounded-md ' +
      'hover:bg-[#16304f] active:scale-95 transition-all motion-reduce:transition-none motion-reduce:active:scale-100 ' +
      'disabled:opacity-40 disabled:hover:bg-[#1E3A5F] disabled:active:scale-100 ' +
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E3A5F]',
    lg: 'bg-[#1E3A5F] text-white text-sm font-semibold py-3 rounded-lg ' +
      'hover:bg-[#16304f] active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed ' +
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A5F]',
  },
  danger: {
    md: 'bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-md ' +
      'hover:bg-red-700 active:scale-95 transition-all motion-reduce:transition-none motion-reduce:active:scale-100 ' +
      'disabled:opacity-40 disabled:hover:bg-red-600 disabled:active:scale-100 ' +
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600',
    lg: 'bg-red-600 text-white text-sm font-semibold py-3 rounded-lg ' +
      'hover:bg-red-700 active:scale-95 transition-all ' +
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400',
  },
  outline: {
    md: 'px-4 py-2 rounded-md text-sm font-semibold border border-gray-200 text-gray-600 ' +
      'hover:bg-gray-50 active:scale-95 transition-all ' +
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A5F]',
    lg: 'px-4 py-3 rounded-lg text-sm font-semibold border border-gray-200 text-gray-600 ' +
      'hover:bg-gray-50 active:scale-95 transition-all ' +
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A5F]',
  },
  ghost: {
    md: 'text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md transition-colors ' +
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E3A5F]',
    lg: 'text-sm text-gray-500 hover:text-gray-700 px-3 py-3 rounded-lg transition-colors ' +
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E3A5F]',
  },
};

/**
 * Applied on a native button so click, disabled, id and aria-* keep working as before:
 * <button type="button" app-button variant="danger" (click)="...">Supprimer</button>
 * Layout classes (w-full, flex-1) stay on the caller's element.
 */
@Component({
  selector: 'button[app-button]',
  standalone: true,
  template: '<ng-content />',
  host: { '[class]': 'classes()' },
})
export class Button {
  variant = input<ButtonVariant>('primary');
  size = input<ButtonSize>('md');

  readonly classes = computed(() => CLASSES[this.variant()][this.size()]);
}
