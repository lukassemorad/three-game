import { Injectable } from '@angular/core';
import { SaveGame, SAVE_SCHEMA_VERSION } from '../../shared/models/save-game.model';
import { HAND_ITEM } from '../../shared/models/item.model';
import { ThreeSceneService } from '../engine/three-scene.service';
import { TreeService } from '../world/tree.service';
import { InventoryService } from './inventory.service';
import { PlayerStateService } from './player-state.service';

const SAVE_STORAGE_KEY = 'three-game:save';

@Injectable({ providedIn: 'root' })
export class SaveGameService {
  constructor(
    private readonly threeScene: ThreeSceneService,
    private readonly playerState: PlayerStateService,
    private readonly inventory: InventoryService,
    private readonly treeService: TreeService
  ) {}

  hasSavedGame(): boolean {
    return this.readRaw() !== null;
  }

  getSaveSummary(): { treesChoppedCount: number; money: number } | null {
    const save = this.readRaw();
    return save && { treesChoppedCount: save.player.treesChoppedCount, money: save.player.money };
  }

  save(): void {
    const transform = this.threeScene.getPlayerTransform();
    const { intact, detailed } = this.treeService.getSerializableState();
    const saveGame: SaveGame = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      player: {
        money: this.playerState.money(),
        treesChoppedCount: this.playerState.treesChoppedCount(),
        position: transform.position,
        rotation: transform.quaternion,
        ownedItemIds: this.inventory.ownedIds(),
        equippedItemId: this.inventory.activeItem().id === HAND_ITEM.id ? null : this.inventory.activeItem().id
      },
      intactTrees: intact,
      trees: detailed
    };
    sessionStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(saveGame));
  }

  load(): SaveGame | null {
    return this.readRaw();
  }

  clear(): void {
    sessionStorage.removeItem(SAVE_STORAGE_KEY);
  }

  private readRaw(): SaveGame | null {
    try {
      const raw = sessionStorage.getItem(SAVE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SaveGame;
      return parsed.schemaVersion === SAVE_SCHEMA_VERSION ? parsed : null;
    } catch {
      return null;
    }
  }
}
