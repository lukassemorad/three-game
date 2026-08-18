import * as THREE from 'three';
import { ThreeSceneService } from '../engine/three-scene.service';

export interface WorldEntity {
  readonly id: string;
  readonly group: THREE.Group;
  update?(delta: number): void;
  dispose?(): void;
}

const VISIBILITY_INTERVAL_SECONDS = 0.2;
// Zvířata jsou na rozdíl od trávy/stromů nápadná/řídká entita, ne plošný podklad - vyšší
// dosah než tráva (55/70, viz VegetationService), ale výrazně nižší než stromy (130/160,
// viz TreeService), ať nejsou vidět přes půl mapy (kamera vidí do 600 m bez mlhy). Jediné
// místo, kde je toto číslo definované - případné budoucí "draw distance" nastavení
// (SettingsService) by mělo měnit/předávat jen tuhle konstantu.
const HIDE_DISTANCE = 90;
const SHOW_DISTANCE = 75;
const HIDE_DISTANCE_SQ = HIDE_DISTANCE * HIDE_DISTANCE;
const SHOW_DISTANCE_SQ = SHOW_DISTANCE * SHOW_DISTANCE;

export abstract class EntityServiceBase<TEntity extends WorldEntity> {
  protected readonly entities = new Map<string, TEntity>();
  private tickFn: ((delta: number) => void) | null = null;
  private visibilityAccumulator = 0;

  constructor(protected readonly scene: ThreeSceneService) {}

  protected register(entity: TEntity): void {
    this.ensureTickableRegistered();
    this.entities.set(entity.id, entity);
    this.scene.addToScene(entity.group);
  }

  // Symetrické k register() - odstranění jedné entity (např. po zabití), na rozdíl od
  // dispose() níže, který strhne úplně všechny.
  protected unregister(entity: TEntity): void {
    this.scene.removeFromScene(entity.group);
    entity.dispose?.();
    this.entities.delete(entity.id);
  }

  private ensureTickableRegistered(): void {
    if (this.tickFn) return;
    this.tickFn = (delta) => {
      // Throttlováno stejně jako ChunkVisibilitySweep u trávy/stromů - kamera se čte a
      // vzdálenost počítá jen občas, ne každý frame. Na rozdíl od ChunkVisibilitySweep je to
      // ale per-entita, ne per-chunk: entity (zvířata) se na rozdíl od trávy/stromů hýbou,
      // takže statické seskupení do chunků by se muselo za běhu přepočítávat.
      this.visibilityAccumulator += delta;
      let cameraPosition: THREE.Vector3 | null = null;
      if (this.visibilityAccumulator >= VISIBILITY_INTERVAL_SECONDS) {
        this.visibilityAccumulator = 0;
        cameraPosition = this.scene.getCameraPosition();
      }
      for (const entity of this.entities.values()) {
        if (cameraPosition) this.updateEntityVisibility(entity, cameraPosition);
        // Skryté entity se dál needitují (animace/AI) - žádná aktivní honička/útok tím
        // nemůže být zasažena, AggroBehavior má leash/lose-interest poloměr (viz
        // stag.entity.ts) výrazně menší než SHOW_DISTANCE.
        if (entity.group.visible) entity.update?.(delta);
      }
    };
    this.scene.registerTickable(this.tickFn);
  }

  private updateEntityVisibility(entity: TEntity, cameraPosition: THREE.Vector3): void {
    const dx = entity.group.position.x - cameraPosition.x;
    const dz = entity.group.position.z - cameraPosition.z;
    const distSq = dx * dx + dz * dz;

    if (entity.group.visible && distSq > HIDE_DISTANCE_SQ) {
      entity.group.visible = false;
    } else if (!entity.group.visible && distSq < SHOW_DISTANCE_SQ) {
      entity.group.visible = true;
    }
  }

  dispose(): void {
    for (const entity of this.entities.values()) {
      this.scene.removeFromScene(entity.group);
      entity.dispose?.();
    }
    this.entities.clear();
    if (this.tickFn) {
      this.scene.unregisterTickable(this.tickFn);
      this.tickFn = null;
    }
  }
}
