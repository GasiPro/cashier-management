import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SessionStore } from './core/auth/session.store';
import { initDisplaySettings } from './core/display/display-settings';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly session = inject(SessionStore);
  constructor() {
    effect(() => {
      this.session.role();
      void initDisplaySettings();
    });
  }
}
