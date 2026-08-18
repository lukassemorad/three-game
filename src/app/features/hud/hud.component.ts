import { Component, inject } from '@angular/core';
import { ThreeSceneService } from '../../core/engine/three-scene.service';
import { PlayerCombatFeedbackService } from '../../core/state/player-combat-feedback.service';
import { PlayerStateService } from '../../core/state/player-state.service';

@Component({
  selector: 'app-hud',
  templateUrl: './hud.component.html',
  styleUrl: './hud.component.scss'
})
export class HudComponent {
  private readonly threeScene = inject(ThreeSceneService);
  private readonly playerState = inject(PlayerStateService);
  private readonly combatFeedback = inject(PlayerCombatFeedbackService);

  protected readonly money = this.playerState.money;
  protected readonly lookTarget = this.threeScene.lookTarget;
  protected readonly flashOpacity = this.combatFeedback.flashOpacity;
}
