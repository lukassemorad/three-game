import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-main-menu',
  imports: [RouterLink],
  template: `
    <h1>Main Menu</h1>
    <p>Placeholder — herní menu zatím bez obsahu.</p>
    <a routerLink="/game">Start</a>
  `
})
export class MainMenuComponent {}
