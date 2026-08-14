import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LoginComponent } from "./presentation/vews/login/login";
import { Cashier } from "./presentation/vews/cashier/cashier";
import { Counter } from "./presentation/vews/counter/counter";
import { Setting } from "./presentation/vews/setting/setting";

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LoginComponent, Cashier, Counter, Setting],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
