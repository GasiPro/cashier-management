import { Component, computed, input, output } from '@angular/core';
export type ModalVariant = 'dialog' | 'side-panel' | 'sheet' | 'fixed-dialog';
export type ModalSize = 'sm' | 'md';
export type ModalOverflow = 'auto' | 'hidden';
@Component({
  selector: 'app-modal',
  standalone: true,
  templateUrl: './modal.html',
})
export class Modal {
  variant = input<ModalVariant>('dialog');
  size = input<ModalSize>('md');
  panelOverflow = input<ModalOverflow>('auto');
  heading = input<string>('');
  subtitle = input<string>('');
  headingId = input<string>('');
  panelId = input<string>('');
  closeLabel = input<string>('Fermer');
  closed = output<void>();
  readonly overlayClasses = computed(() => {
    switch (this.variant()) {
      case 'side-panel':
        return 'absolute inset-0 z-30 flex items-start justify-end';
      case 'sheet':
        return 'fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-10 p-0 sm:p-6';
      case 'fixed-dialog':
        return 'fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-50';
      case 'dialog':
      default:
        return 'absolute inset-0 z-30 flex items-center justify-center px-4';
    }
  });
  readonly backdropClasses = computed(() => {
    switch (this.variant()) {
      case 'side-panel':
        return 'absolute inset-0 bg-black/20';
      case 'sheet':
        return 'absolute inset-0';
      case 'fixed-dialog':
        return '';
      case 'dialog':
      default:
        return 'absolute inset-0 bg-black/30';
    }
  });
  readonly panelClasses = computed(() => {
    switch (this.variant()) {
      case 'side-panel':
        return 'relative bg-white border-l border-gray-200 shadow-2xl w-full max-w-sm h-full flex flex-col ' +
          (this.panelOverflow() === 'hidden' ? 'overflow-hidden' : 'overflow-y-auto');
      case 'sheet':
        return 'relative bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-6 sm:p-7 max-h-[90vh] overflow-y-auto';
      case 'fixed-dialog':
        return 'w-full max-w-sm bg-white rounded-2xl shadow-xl p-7';
      case 'dialog':
      default:
        return 'relative bg-white rounded-2xl shadow-2xl w-full ' +
          (this.size() === 'sm' ? 'max-w-sm' : 'max-w-md max-h-[85vh]') +
          ' overflow-y-auto flex flex-col';
    }
  });
  readonly headerClasses = computed(() => {
    switch (this.variant()) {
      case 'sheet':
        return 'flex items-center justify-between mb-4';
      case 'fixed-dialog':
        return 'flex items-center justify-between mb-5';
      default:
        return 'flex items-center justify-between px-6 py-5 border-b border-gray-100 shrink-0';
    }
  });
  readonly headingClasses = computed(() =>
    this.variant() === 'fixed-dialog'
      ? 'text-xl font-semibold text-[#1A1A1A] tracking-tight'
      : 'text-lg font-semibold text-[#1A1A1A] tracking-tight',
  );
  readonly closeButtonClasses = computed(() => {
    switch (this.variant()) {
      case 'sheet':
        return 'text-gray-400 hover:text-gray-600 p-1.5 rounded-md transition-colors ' +
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E3A5F]';
      case 'fixed-dialog':
        return 'text-gray-400 hover:text-gray-600 transition-colors ' +
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E3A5F] rounded';
      default:
        return 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 transition-colors ' +
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E3A5F] rounded-md';
    }
  });
}
