import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CollisionService } from '../engine/collision.service';
import { ThreeSceneService } from '../engine/three-scene.service';
import { InventoryService } from '../state/inventory.service';
import { PlayerCombatFeedbackService } from '../state/player-combat-feedback.service';
import { PlayerStateService } from '../state/player-state.service';
import { EntityServiceBase } from './entity-service.base';
import { StagEntity, StagTemplate, STAG_COLLIDER_RADIUS, STAG_HEIGHT_METERS } from './stag.entity';

const STAG_MODEL_URL = encodeURI('assets/models/Stag.glb');

// Peněžní odměna za zabití jelena - stejný princip jako WOOD_PRICE u dřeva, jen menší
// samostatná konstanta zatím bez vlastní ekonomiky (jelen nemá "resource amount").
const STAG_KILL_REWARD = 50;

// Sdílený loader + cache stejná technika jako u frog.service.ts - 3 jeleni čekají na
// jeden jediný fetch/parse GLTF, ne 3 samostatné.
const gltfLoader = new GLTFLoader();
let cachedTemplate: Promise<StagTemplate> | null = null;

function loadStagTemplate(): Promise<StagTemplate> {
  if (!cachedTemplate) {
    cachedTemplate = new Promise((resolve, reject) => {
      gltfLoader.load(
        STAG_MODEL_URL,
        (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
        undefined,
        reject
      );
    });
  }
  return cachedTemplate;
}

@Injectable({ providedIn: 'root' })
export class StagService extends EntityServiceBase<StagEntity> {
  constructor(
    scene: ThreeSceneService,
    private readonly collision: CollisionService,
    private readonly inventory: InventoryService,
    private readonly playerState: PlayerStateService,
    private readonly combatFeedback: PlayerCombatFeedbackService
  ) {
    super(scene);
  }

  async spawnStags(positions: THREE.Vector3[]): Promise<void> {
    const template = await loadStagTemplate();
    for (const position of positions) {
      // Callback čte `stag.id` až při pohybu (update()), ne synchronně během konstrukce -
      // v tu chvíli `stag` ještě není přiřazené (TDZ), ale entita si sama žádnou registraci
      // v konstruktoru nedělá, takže na to nedojde dřív, než je `stag` hotové.
      const stag = new StagEntity(
        position,
        template,
        (x, z) => this.scene.getGroundHeight(x, z),
        (x, z, groundY) =>
          this.collision.register(stag.id, {
            x,
            z,
            radius: STAG_COLLIDER_RADIUS,
            topY: groundY + STAG_HEIGHT_METERS
          }),
        () => this.scene.getCameraPosition(),
        () => this.combatFeedback.notifyHit(),
        () => this.unregister(stag),
        () => this.registerStag(stag)
      );
      this.collision.register(stag.id, {
        x: position.x,
        z: position.z,
        radius: STAG_COLLIDER_RADIUS,
        topY: position.y + STAG_HEIGHT_METERS
      });
      this.register(stag);
      this.registerStag(stag);
    }
  }

  private registerStag(stag: StagEntity, promptOverride?: string): void {
    this.scene.registerInteractable(stag.group, {
      id: stag.id,
      label: 'Jelen',
      interactPrompt: promptOverride ?? 'Klikni pro seknutí',
      onInteract: () => this.hit(stag)
    });
  }

  private hit(stag: StagEntity): void {
    const outcome = stag.registerHit(this.inventory.activeItem().damage);

    if (outcome === 'killed') {
      // Entita samotná (StagEntity) teď doběhne Death animaci a po
      // DEATH_DESPAWN_SECONDS zavolá `onDeath` -> `this.unregister(stag)` výše -
      // tady stačí hned zneviditelnit interakci/kolizi, ať mrtvého jelena nejde dál
      // sekat ani do něj nejde narazit.
      this.scene.unregisterInteractable(stag.group);
      this.collision.unregister(stag.id);
      this.playerState.addMoney(STAG_KILL_REWARD);
      return;
    }

    this.registerStag(stag, `Zásah! Jelen utíká (zbývá životů: ${stag.remainingHp})`);
  }

  override dispose(): void {
    for (const stag of this.entities.values()) this.collision.unregister(stag.id);
    super.dispose();
  }
}
