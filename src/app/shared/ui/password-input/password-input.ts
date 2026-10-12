import { Component, computed, input, model } from '@angular/core';

export type PasswordInputSize = 'sm' | 'md' | 'lg';
export type PasswordToggleStyle = 'icon' | 'text';

@Component({
  selector: 'app-password-input',
  standalone: true,
  templateUrl: './password-input.html',
  host: { class: 'block' },
})
export class PasswordInput {
  value = model<string>('');
  /** Shared by several fields (password + confirmation) with [(visible)]. */
  visible = model<boolean>(false);
  inputId = input.required<string>();
  name = input<string>('');
  placeholder = input<string>('••••••••');
  autocomplete = input<string>('current-password');
  describedBy = input<string>('');
  invalid = input<boolean>(false);
  required = input<boolean>(false);
  minLength = input<number | null>(null);
  size = input<PasswordInputSize>('md');
  showToggle = input<boolean>(true);
  toggleStyle = input<PasswordToggleStyle>('icon');

  readonly inputClasses = computed(() => {
    const padding = this.size() === 'lg' ? 'px-4 py-3' : this.size() === 'md' ? 'px-4 py-2.5' : 'px-3 py-2';
    return `flex-1 border border-gray-200 rounded-lg ${padding} text-sm text-[#1A1A1A] ` +
      'focus:outline-none focus:border-[#1E3A5F] transition-colors placeholder-gray-300';
  });

  readonly buttonClasses = computed(() => {
    const base = 'flex-shrink-0 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors ' +
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E3A5F]';
    if (this.toggleStyle() === 'text') {
      return `${base} px-3 py-2 text-xs font-medium text-gray-500`;
    }
    return `${base} ${this.size() === 'lg' ? 'p-3' : 'p-2.5'}`;
  });

  onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }

  toggleVisibility(): void {
    this.visible.update((v) => !v);
  }
}
