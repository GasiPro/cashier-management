import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './settings.page.html',
})
export class AdminSettingsPage {}
