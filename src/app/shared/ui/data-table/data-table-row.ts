import { Directive, computed, input } from '@angular/core';
@Directive({
  selector: 'tr[app-data-row]',
  standalone: true,
  host: {
    '[class]': 'classes()',
    '[attr.tabindex]': 'interactive() ? 0 : null',
  },
})
export class DataRow {
  interactive = input<boolean>(false);
  readonly classes = computed(() => {
    const base = 'border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors';
    return this.interactive()
      ? `${base} cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#1E3A5F]`
      : base;
  });
}
