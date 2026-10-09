import { Component, output } from '@angular/core';

@Component({
  selector: 'app-role-picker',
  standalone: true,
  templateUrl: './role-picker.html',
})
export class RolePicker {
  readonly selectCashier = output<void>();
  readonly selectCounter = output<void>();
}
