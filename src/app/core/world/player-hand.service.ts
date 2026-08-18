import { Injectable, effect } from '@angular/core';
import { HAND_ITEM, ItemDef } from '../../shared/models/item.model';
import { ThreeSceneService } from '../engine/three-scene.service';
import { InventoryService } from '../state/inventory.service';
import { loadItemModel } from './item-model-loader';
import { PlayerHandEntity } from './player-hand.entity';

@Injectable({ providedIn: 'root' })
export class PlayerHandService {
  private entity: PlayerHandEntity | null = null;
  private equipToken = 0;
  private readonly tick = (delta: number) => this.entity?.update(delta);
  private readonly onPrimaryAction = () => this.entity?.swing();
  private readonly onSecondaryAction = () => this.entity?.inspect();

  constructor(
    private readonly scene: ThreeSceneService,
    private readonly inventory: InventoryService
  ) {
    effect(() => this.onEquippedItemChange(this.inventory.activeItem()));
  }

  spawn(): void {
    this.entity = new PlayerHandEntity();
    this.scene.attachToCamera(this.entity.group);
    this.scene.registerTickable(this.tick);
    this.scene.onPrimaryAction(this.onPrimaryAction);
    this.scene.onSecondaryAction(this.onSecondaryAction);
    this.onEquippedItemChange(this.inventory.activeItem());
  }

  dispose(): void {
    if (this.entity) this.scene.detachFromCamera(this.entity.group);
    this.entity = null;
  }

  // Token zneplatní zastaralou odpověď GLTFLoaderu, pokud hráč přepne nástroj (kolečkem)
  // dřív, než se předchozí model stihl načíst - jinak by se mohl připojit "pozdě příchozí"
  // model, který už neodpovídá aktuálně vybavenému nástroji.
  private onEquippedItemChange(item: ItemDef): void {
    this.scene.setAutoFireInterval(item.autoFireInterval ?? null);
    const token = ++this.equipToken;
    if (item.id === HAND_ITEM.id || !item.modelUrl) {
      this.entity?.clearTool();
      return;
    }
    loadItemModel(item).then((model) => {
      if (token !== this.equipToken) return;
      // handRotation*/handOffset* přetíží rotaci/pozici jen pro pohled v ruce - model na
      // podstavci v obchodě (viz shop.entity.ts) používá stejnou cache/loader, ale s base
      // rotationX/Y/Z z ItemDef a bez posunu.
      if (item.handRotationX !== undefined || item.handRotationY !== undefined || item.handRotationZ !== undefined) {
        model.rotation.set(
          item.handRotationX ?? item.rotationX ?? 0,
          item.handRotationY ?? item.rotationY ?? 0,
          item.handRotationZ ?? item.rotationZ ?? 0
        );
      }
      if (item.handOffsetX !== undefined || item.handOffsetY !== undefined || item.handOffsetZ !== undefined) {
        model.position.set(item.handOffsetX ?? 0, item.handOffsetY ?? 0, item.handOffsetZ ?? 0);
      }
      this.entity?.attachTool(model);
    });
  }
}
