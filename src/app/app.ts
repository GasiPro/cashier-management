import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { initDisplaySettings } from './core/display/display-settings';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  ngOnInit(): void {
    void initDisplaySettings();
  }
}
