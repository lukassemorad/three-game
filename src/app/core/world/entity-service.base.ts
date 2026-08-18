import * as THREE from 'three';
import { ThreeSceneService } from '../engine/three-scene.service';

export interface WorldEntity {
  readonly id: string;
  readonly group: THREE.Group;
  update?(delta: number): void;
  dispose?(): void;
}

export abstract class EntityServiceBase<TEntity extends WorldEntity> {
  protected readonly entities = new Map<string, TEntity>();
  private tickFn: ((delta: number) => void) | null = null;

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
      for (const entity of this.entities.values()) entity.update?.(delta);
    };
    this.scene.registerTickable(this.tickFn);
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
