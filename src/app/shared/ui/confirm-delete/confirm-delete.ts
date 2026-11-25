import { Component, input, output } from '@angular/core';
import { Button } from '../button/button';
import { TranslatePipe } from '../../pipes/translate.pipe';
@Component({
  selector: 'app-confirm-delete',
  standalone: true,
  imports: [Button, TranslatePipe],
  templateUrl: './confirm-delete.html',
})
export class ConfirmDelete {
  panelId = input.required<string>();
  ariaLabel = input.required<string>();
  confirmButtonId = input<string>('');
  error = input<string>('');
  busy = input<boolean>(false);
  confirmLabel = input<string>('Supprimer définitivement');
  busyLabel = input<string>('Suppression…');
  cancelLabel = input<string>('Annuler');
  confirmed = output<void>();
  cancelled = output<void>();
}
