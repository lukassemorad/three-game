import { Routes } from '@angular/router';
import { MainMenuComponent } from './features/main-menu/main-menu.component';
import { GameCanvasComponent } from './features/game-canvas/game-canvas.component';
import { InventoryComponent } from './features/inventory/inventory.component';

export const routes: Routes = [
  { path: '', component: MainMenuComponent },
  { path: 'game', component: GameCanvasComponent },
  { path: 'inventory', component: InventoryComponent }
];
