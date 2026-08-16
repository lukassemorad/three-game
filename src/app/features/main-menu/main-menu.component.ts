import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SaveGameService } from '../../core/state/save-game.service';
import { SettingsService } from '../../core/state/settings.service';

type MainMenuView = 'main' | 'settings';

@Component({
  selector: 'app-main-menu',
  imports: [],
  templateUrl: './main-menu.component.html',
  styleUrl: './main-menu.component.scss'
})
export class MainMenuComponent {
  private readonly router = inject(Router);
  private readonly saveGame = inject(SaveGameService);
  protected readonly settings = inject(SettingsService);

  protected readonly view = signal<MainMenuView>('main');
  protected readonly hasSavedGame = this.saveGame.hasSavedGame();
  protected readonly saveSummary = this.saveGame.getSaveSummary();

  onNewGameClick(): void {
    this.saveGame.clear();
    this.router.navigate(['/game']);
  }

  onContinueClick(): void {
    this.router.navigate(['/game']);
  }

  onSettingsClick(): void {
    this.view.set('settings');
  }

  onBackClick(): void {
    this.view.set('main');
  }

  onSensitivityInput(event: Event): void {
    this.settings.setLookSensitivity((event.target as HTMLInputElement).valueAsNumber);
  }
}
