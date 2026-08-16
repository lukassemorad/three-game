import { Component, inject } from '@angular/core';
import { ThreeSceneService } from '../../core/engine/three-scene.service';
import { PlayerStateService } from '../../core/state/player-state.service';

@Component({
  selector: 'app-hud',
  templateUrl: './hud.component.html',
  styleUrl: './hud.component.scss'
})
export class HudComponent {
  private readonly threeScene = inject(ThreeSceneService);
  private readonly playerState = inject(PlayerStateService);

  protected readonly money = this.playerState.money;
  protected readonly lookTarget = this.threeScene.lookTarget;
}
