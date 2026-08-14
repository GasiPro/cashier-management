import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LoginComponent } from "./presentation/views/login/login";
import { Cashier } from "./presentation/views/cashier/cashier";
import { Counter } from "./presentation/views/counter/counter";
import { Setting } from "./presentation/views/setting/setting";

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LoginComponent, Cashier, Counter, Setting],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}